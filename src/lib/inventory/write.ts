import { translateError } from './errors';
import type { PrismaClient, TransactionType } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { audit } from '../masters/write';
import { costSnapshot, stockQuantity } from './cost';
import { needsReorder } from './reorder-point';
import { mutationInput, fingerprint } from './validation';
import { operationPermissions, type Operation, type Input, type InventoryResult } from './types';
export async function mutateInventory(db:PrismaClient,auth:AuthService,token:string|undefined,operation:Operation,input:Input):Promise<InventoryResult> {
 const permissions=operationPermissions[operation];
 await auth.authenticate(token,permissions[0]);
 const request=mutationInput(operation,input), key='phase4:'+request.request_key, signature=fingerprint(request);
 try {
  return await auth.inventoryAuthorized(token,permissions,async(tx,actor)=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(${key}))`;
   const previous=await tx.inventoryTransaction.findUnique({where:{idempotency_key:key}});
   if(previous){
    const log=await tx.auditLog.findFirst({where:{action:'INVENTORY_MUTATION',entity_type:'inventory_transactions',entity_id:previous.id}});
    const saved=log?.details as unknown as {request_fingerprint?:string;result?:InventoryResult}|undefined;
    if(previous.actor_user_id!==actor.id||saved?.request_fingerprint!==signature||!saved.result)throw new AuthError(409,'同じリクエストキーを別の操作へ使うことはできません');
    return saved.result;
   }
   if(request.machine_id)throw new AuthError(400,'設備の指定は廃止されました');
   const original=operation==='reverse'?await tx.inventoryTransaction.findUnique({where:{id:request.transaction_id!}}):null;
   if(operation==='reverse'&&!original)throw new AuthError(404,'元の履歴が見つかりません');
   const toolId=original?.tool_id??request.tool_id!,locationId=original?.location_id??request.location_id!;
   await tx.$queryRaw`SELECT id FROM tools WHERE id=${toolId}::uuid FOR UPDATE`;
   const tool=await tx.tool.findUnique({where:{id:toolId}}),location=await tx.location.findUnique({where:{id:locationId}});
   if(!tool||!location)throw new AuthError(404,'工具・保管場所が見つかりません');
   if(operation!=='reverse'){
    if(!tool.active||!location.active)throw new AuthError(409,'有効な工具・保管場所を選択してください');
   }else{
    if(!['ISSUE','RECEIVE','ADJUSTMENT'].includes(original!.type))throw new AuthError(409,'この種別は取り消せません');
    if(await tx.inventoryTransaction.findUnique({where:{reverses_id:original!.id}}))throw new AuthError(409,'この履歴は取り消し済みです');
   }
   const stock=await tx.stockBalance.findUnique({where:{tool_id_location_id:{tool_id:toolId,location_id:locationId}}});
   if(!stock&&operation!=='receive')throw new AuthError(409,'保管場所の在庫が未登録です。初期在庫登録・入庫を確認してください');
   const before=stock?.on_hand??0,reserved=stock?.reserved??0;
   const orderId=original?.tool_order_id??request.tool_order_id;
   if(orderId)await tx.$queryRaw`SELECT id FROM tool_orders WHERE id=${orderId}::uuid FOR UPDATE`;
   const order=orderId?await tx.toolOrder.findUnique({where:{id:orderId}}):null;
   if(orderId&&(!order||order.tool_id!==toolId))throw new AuthError(409,'この工具の発注を選択してください');
   const receiptPack=original?.receipt_units_per_order??order?.units_per_order??tool.units_per_order;
   if(request.expected_units_per_order!==undefined&&request.expected_units_per_order!==receiptPack)throw new AuthError(409,'入数が変更されています。再読み込みしてください');
   let delta:number,type:TransactionType;
   if(operation==='issue'){delta=-request.quantity!;type='ISSUE';}
   else if(operation==='receive'){delta=request.quantity_unit==='order'?stockQuantity(request.quantity!,receiptPack):request.quantity!;type='RECEIVE';}
   else{delta=-original!.quantity;type='REVERSAL';}
   if(order){
    const received=order.received_quantity+delta;
    if(received<0||received+order.cancelled_quantity>order.stock_quantity)throw new AuthError(409,'発注の未入庫数を超えています。数量を確認してください');
    await tx.toolOrder.update({where:{id:order.id},data:{received_quantity:received}});
   }
   const orderReceipts:{order_id:string;quantity:number}[]=[];
   if(operation==='receive'&&!order){
    const orders=await tx.toolOrder.findMany({where:{tool_id:toolId},orderBy:[{created_at:'asc'},{id:'asc'}]});
    let remaining=delta;
    for(const pending of orders){
     const quantity=Math.min(remaining,pending.stock_quantity-pending.received_quantity-pending.cancelled_quantity);
     if(quantity<=0)continue;
     await tx.toolOrder.update({where:{id:pending.id},data:{received_quantity:{increment:quantity}}});
     orderReceipts.push({order_id:pending.id,quantity});remaining-=quantity;
     if(remaining===0)break;
    }
   }else if(operation==='reverse'&&original!.type==='RECEIVE'&&!order){
    const log=await tx.auditLog.findFirst({where:{action:'INVENTORY_MUTATION',entity_type:'inventory_transactions',entity_id:original!.id}});
    const allocations=(log?.details as unknown as {order_receipts?:{order_id:string;quantity:number}[]}|undefined)?.order_receipts??[];
    for(const allocation of allocations){
     const updated=await tx.toolOrder.updateMany({where:{id:allocation.order_id,tool_id:toolId,received_quantity:{gte:allocation.quantity}},data:{received_quantity:{decrement:allocation.quantity}}});
     if(updated.count!==1)throw new AuthError(409,'発注の入庫数が変更されています。再確認してください');
    }
   }
   const after=before+delta;
   if(after<reserved)throw new AuthError(409,'出庫可能在庫が不足しています。実在庫と引当を確認してください');
   if(after>2147483647||after<0)throw new AuthError(409,'変更後の在庫が数量の上限・下限を超えます');
   if(stock){
    const updated=await tx.stockBalance.updateMany({where:{id:stock.id,on_hand:before,reserved},data:{on_hand:after}});
    if(updated.count!==1)throw new AuthError(409,'在庫が変わりました。再確認してください');
   }else await tx.stockBalance.create({data:{tool_id:toolId,location_id:locationId,on_hand:after,reserved:0}});
   const cost=original?{unit_price:original.unit_price,amount:original.amount?.negated()??null,purchase_unit_price:original.purchase_unit_price,cost_units_per_order:original.cost_units_per_order,cost_basis:original.cost_basis}:costSnapshot(tool,delta);
   const transaction=await tx.inventoryTransaction.create({data:{tool_id:toolId,location_id:locationId,actor_user_id:actor.id,type,quantity:delta,idempotency_key:key,reverses_id:original?.id??null,reason:operation==='reverse'?(request.reason??'入出庫履歴から取消'):request.reason,on_hand_after:after,...cost,tool_order_id:orderId??null,receipt_units_per_order:operation==='issue'?null:receiptPack}});
   const result:InventoryResult={id:transaction.id,type,tool_id:toolId,location_id:locationId,actor_user_id:actor.id,machine_id:null,quantity:delta,on_hand_before:before,on_hand_after:after,reserved,reason:transaction.reason,reverses_id:transaction.reverses_id,created_at:transaction.created_at.toISOString()};
   await audit(tx,actor.id,'INVENTORY_MUTATION','inventory_transactions',transaction.id,{request,request_fingerprint:signature,result,...(orderReceipts.length?{order_receipts:orderReceipts}:{})});
   if(operation==='issue'){
    const [balance,policy,newOrders]=await Promise.all([
     tx.stockBalance.aggregate({where:{tool_id:toolId},_sum:{on_hand:true}}),
     tx.inventoryPolicy.findUnique({where:{tool_id:toolId},select:{reorder_point:true}}),
     tx.toolOrder.findMany({where:{tool_id:toolId},select:{stock_quantity:true,received_quantity:true,cancelled_quantity:true}}),
    ]);
    const onOrder=newOrders.reduce((sum,item)=>sum+item.stock_quantity-item.received_quantity-item.cancelled_quantity,0);
    if(needsReorder(balance._sum.on_hand??0,onOrder,policy?.reorder_point??0)){
     const entry=await tx.orderListEntry.upsert({where:{tool_id:toolId},create:{tool_id:toolId,trigger_transaction_id:transaction.id},update:{trigger_transaction_id:transaction.id}});
     await audit(tx,actor.id,'ORDER_LIST_UPDATED','order_list_entries',entry.id,{tool_id:toolId,trigger_transaction_id:transaction.id});
    }
   }
   return result;
  });
 }catch(error){return translateError(error);}
}
