import { translateError } from '../inventory/errors';
import type { PrismaClient, ToolOrder } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { uuid, integer, type Input } from '../masters/validation';
import { audit } from '../masters/write';
import { stockQuantity } from '../inventory/cost';

const result=(order:ToolOrder)=>({id:order.id,tool_id:order.tool_id,order_quantity:order.order_quantity,units_per_order:order.units_per_order,stock_quantity:order.stock_quantity,received_quantity:order.received_quantity,cancelled_quantity:order.cancelled_quantity,purchase_unit_price:order.purchase_unit_price?.toFixed(2)??null,created_at:order.created_at.toISOString()});
type Result=ReturnType<typeof result>;
export async function cancelOrderListEntry(db:PrismaClient,auth:AuthService,token:string|undefined,input:Input) {
 await auth.authenticate(token,'orders:confirm');
 const toolId=uuid(input.tool_id),entryId=uuid(input.entry_id),key='order-list-cancel:'+uuid(input.request_key);
 const signature=JSON.stringify([toolId,entryId]);
 return auth.inventoryAuthorized(token,['orders:confirm'],async(tx,actor)=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(${key}))`;
  const previous=await tx.auditLog.findFirst({where:{action:'ORDER_LIST_CANCELLED',entity_id:key}});
  if(previous){if(previous.actor_user_id!==actor.id||(previous.details as {signature:string}).signature!==signature)throw new AuthError(409,'同じリクエストキーを別の取消に使うことはできません');return {id:entryId,tool_id:toolId};}
  await tx.$queryRaw`SELECT id FROM tools WHERE id=${toolId}::uuid FOR UPDATE`;
  const entry=await tx.orderListEntry.findUnique({where:{id:entryId}});
  if(!entry||entry.tool_id!==toolId)throw new AuthError(409,'発注リストが変更されています。再読み込みしてください');
  await tx.orderListEntry.delete({where:{id:entryId}});
  await audit(tx,actor.id,'ORDER_LIST_CANCELLED','order_list_entries',key,{signature,entry_id:entryId,tool_id:toolId});
  return {id:entryId,tool_id:toolId};
 }).catch(translateError);
}
export async function registerOrder(db:PrismaClient,auth:AuthService,token:string|undefined,input:Input):Promise<Result> {
 await auth.authenticate(token,'orders:confirm');
 const toolId=uuid(input.tool_id),entryId=uuid(input.entry_id),quantity=integer(input.quantity,'発注数',1),pack=integer(input.expected_units_per_order,'入数',1),key='tool-order:'+uuid(input.request_key);
 const signature=JSON.stringify([toolId,entryId,quantity,pack]);
 return auth.inventoryAuthorized(token,['orders:confirm'],async(tx,actor)=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(${key}))`;
  const previous=await tx.auditLog.findFirst({where:{action:'TOOL_ORDER_REGISTERED',entity_id:key}});
  if(previous){const saved=previous.details as unknown as {signature:string;result:Result};if(previous.actor_user_id!==actor.id||saved.signature!==signature)throw new AuthError(409,'同じリクエストキーを別の発注に使うことはできません');return saved.result;}
  await tx.$queryRaw`SELECT id FROM tools WHERE id=${toolId}::uuid FOR UPDATE`;
  const tool=await tx.tool.findUnique({where:{id:toolId}}),entry=await tx.orderListEntry.findUnique({where:{id:entryId}});
  if(!tool||!entry||entry.tool_id!==toolId)throw new AuthError(409,'発注リストが変更されています。再読み込みしてください');
  if(!tool.active||tool.units_per_order!==pack)throw new AuthError(409,'工具の状態・入数が変更されています。再読み込みしてください');
  const order=await tx.toolOrder.create({data:{tool_id:toolId,created_by:actor.id,request_key:key,order_quantity:quantity,units_per_order:pack,stock_quantity:stockQuantity(quantity,pack),purchase_unit_price:tool.unit_price}});
  await tx.orderListEntry.delete({where:{id:entryId}});
  const saved=result(order);await audit(tx,actor.id,'TOOL_ORDER_REGISTERED','tool_orders',key,{signature,result:saved});return saved;
 }).catch(translateError);
}
export async function cancelOrder(db:PrismaClient,auth:AuthService,token:string|undefined,id:string,input:Input):Promise<Result> {
 await auth.authenticate(token,'orders:manage');id=uuid(id);const key='tool-order-cancel:'+uuid(input.request_key);
 return auth.inventoryAuthorized(token,['orders:manage'],async(tx,actor)=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(${key}))`;
  const previous=await tx.auditLog.findFirst({where:{action:'TOOL_ORDER_CANCELLED',entity_id:key}});
  if(previous){const saved=previous.details as unknown as {order_id:string;result:Result};if(previous.actor_user_id!==actor.id||saved.order_id!==id)throw new AuthError(409,'同じリクエストキーを別の発注に使うことはできません');return saved.result;}
  const found=await tx.toolOrder.findUnique({where:{id}});if(!found)throw new AuthError(404,'発注が見つかりません');
  await tx.$queryRaw`SELECT id FROM tools WHERE id=${found.tool_id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM tool_orders WHERE id=${id}::uuid FOR UPDATE`;
  const order=await tx.toolOrder.findUniqueOrThrow({where:{id}});
  const remainder=order.stock_quantity-order.received_quantity-order.cancelled_quantity;
  if(remainder<=0)throw new AuthError(409,'取消できる未入庫数がありません');
  const updated=await tx.toolOrder.update({where:{id},data:{cancelled_quantity:{increment:remainder}}});
  const saved=result(updated);await audit(tx,actor.id,'TOOL_ORDER_CANCELLED','tool_orders',key,{order_id:id,cancelled_quantity:remainder,result:saved});return saved;
 }).catch(translateError);
}
