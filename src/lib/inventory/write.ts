import type { PrismaClient, TransactionType } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { audit } from '../masters/write';
import { mutationInput, fingerprint } from './validation';
import { operationPermissions, type Operation, type Input, type InventoryResult } from './types';
function translateError(error:unknown):never {
 if(error instanceof AuthError)throw error;
 const e=error as {code?:string;meta?:{code?:string;driverAdapterError?:{cause?:{originalCode?:string}}}};
 const codes=[e?.code,e?.meta?.code,e?.meta?.driverAdapterError?.cause?.originalCode];
 if(codes.some(code=>['55P03','40P01','57014','P2028','P2034'].includes(code??'')))throw new AuthError(409,'別の操作を処理中です。在庫を再確認して同じリクエストキーで再試行してください');
 if(e?.code==='P2002')throw new AuthError(409,'この操作は登録済みです。履歴を確認してください');
 throw error;
}
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
   const original=operation==='reverse'?await tx.inventoryTransaction.findUnique({where:{id:request.transaction_id!}}):null;
   if(operation==='reverse'&&!original)throw new AuthError(404,'元の履歴が見つかりません');
   const toolId=original?.tool_id??request.tool_id!,locationId=original?.location_id??request.location_id!;
   await tx.$queryRaw`SELECT id FROM tools WHERE id=${toolId}::uuid FOR UPDATE`;
   const tool=await tx.tool.findUnique({where:{id:toolId}}),location=await tx.location.findUnique({where:{id:locationId}});
   if(!tool||!location)throw new AuthError(404,'工具・保管場所が見つかりません');
   let machineId:string|null=original?.machine_id??request.machine_id??null;
   if(operation!=='reverse'){
    if(!tool.active||!location.active)throw new AuthError(409,'有効な工具・保管場所を選択してください');
    if(operation==='issue'){
     const machine=await tx.machine.findUnique({where:{id:machineId!}});
     if(!machine)throw new AuthError(404,'設備が見つかりません');
     if(!machine.active)throw new AuthError(409,'有効な設備を選択してください');
    }else machineId=null;
   }else{
    if(!['ISSUE','RECEIVE','ADJUSTMENT'].includes(original!.type))throw new AuthError(409,'この種別は取り消せません');
    if(await tx.inventoryTransaction.findUnique({where:{reverses_id:original!.id}}))throw new AuthError(409,'この履歴は取り消し済みです');
   }
   const stock=await tx.stockBalance.findUnique({where:{tool_id_location_id:{tool_id:toolId,location_id:locationId}}});
   if(!stock&&operation!=='receive')throw new AuthError(409,'保管場所の在庫が未登録です。初期在庫登録・手動入庫を確認してください');
   const before=stock?.on_hand??0,reserved=stock?.reserved??0;
   let delta:number,type:TransactionType;
   if(operation==='issue'){delta=-request.quantity!;type='ISSUE';}
   else if(operation==='receive'){delta=request.quantity!;type='RECEIVE';}
   else if(operation==='adjust'){
    if(before!==request.expected_on_hand||reserved!==request.expected_reserved)throw new AuthError(409,'表示後に在庫が変わりました。再読み込みして実棚数を確認してください');
    delta=request.counted_quantity!-before;type='ADJUSTMENT';
    if(!delta)throw new AuthError(409,'数量変更がありません');
   }else{delta=-original!.quantity;type='REVERSAL';}
   const after=before+delta;
   if(after<reserved)throw new AuthError(409,'出庫可能在庫が不足しています。実在庫と引当を確認してください');
   if(after>2147483647||after<0)throw new AuthError(409,'変更後の在庫が数量の上限・下限を超えます');
   if(stock){
    const updated=await tx.stockBalance.updateMany({where:{id:stock.id,on_hand:before,reserved},data:{on_hand:after}});
    if(updated.count!==1)throw new AuthError(409,'在庫が変わりました。再確認してください');
   }else await tx.stockBalance.create({data:{tool_id:toolId,location_id:locationId,on_hand:after,reserved:0}});
   const transaction=await tx.inventoryTransaction.create({data:{tool_id:toolId,location_id:locationId,actor_user_id:actor.id,machine_id:machineId,type,quantity:delta,idempotency_key:key,reverses_id:original?.id??null,reason:request.reason}});
   const result:InventoryResult={id:transaction.id,type,tool_id:toolId,location_id:locationId,actor_user_id:actor.id,machine_id:machineId,quantity:delta,on_hand_before:before,on_hand_after:after,reserved,reason:transaction.reason,reverses_id:transaction.reverses_id,created_at:transaction.created_at.toISOString()};
   await audit(tx,actor.id,'INVENTORY_MUTATION','inventory_transactions',transaction.id,{request,request_fingerprint:signature,result});
   return result;
  });
 }catch(error){return translateError(error);}
}
