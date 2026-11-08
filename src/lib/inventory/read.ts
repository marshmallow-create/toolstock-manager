import type { PrismaClient, Prisma } from '../../generated/prisma/client';
import { AuthService, AuthError, type Viewer } from '../auth/service';
import { can } from '../auth/permissions';
import { uuid, integer, price, text, categoryValue } from '../masters/validation';
import { categoryAliases } from '../tool-options';
import { calendarDate, optionalId } from './validation';
import type { Input, HistoryItem, InventoryResult } from './types';
const transactionSelect={
 id:true,type:true,quantity:true,reason:true,created_at:true,reverses_id:true,idempotency_key:true,on_hand_after:true,unit_price:true,
 tool_id_record:{select:{id:true,tool_code:true,name:true,category:true,unit:true,active:true}},
 location_id_record:{select:{id:true,location_code:true,name:true,active:true}},
 actor_user_id_record:{select:{id:true,employee_code:true,name:true,active:true}},
 inventory_transactions_reverses_id_children:{select:{id:true}},
} as const satisfies Prisma.InventoryTransactionSelect;
type Row=Prisma.InventoryTransactionGetPayload<{select:typeof transactionSelect}>;
const showPrice=(actor:Viewer)=>can(actor.role,'masters:write')||can(actor.role,'orders:read');
async function dtos(db:PrismaClient,rows:Row[],visiblePrice:boolean):Promise<HistoryItem[]> {
 const legacy=rows.filter(row=>row.on_hand_after===null);
 const logs=legacy.length?await db.auditLog.findMany({where:{OR:[
  {action:'INVENTORY_MUTATION',entity_type:'inventory_transactions',entity_id:{in:legacy.map(row=>row.id)}},
  {action:'INITIAL_STOCK_REGISTERED',entity_id:{in:legacy.map(row=>row.idempotency_key)}},
 ]},select:{entity_id:true,details:true}}):[];
 const audits=new Map(logs.map(log=>[log.entity_id,log.details as unknown as {result?:{on_hand_after?:unknown};quantity?:unknown}]));
 return rows.map(row=>{
  const {tool_id_record:tool,location_id_record:location,actor_user_id_record:actor,inventory_transactions_reverses_id_children:reversal,idempotency_key,unit_price,on_hand_after,...fields}=row;
  const previous=audits.get(row.id)?.result?.on_hand_after??audits.get(idempotency_key)?.quantity;
  const recorded=typeof previous==='number'&&Number.isInteger(previous)&&previous>=0&&previous<=2147483647?previous:null;
  return {...fields,tool,location,actor,reversal_id:reversal?.id??null,on_hand_after:on_hand_after??recorded,...(visiblePrice?{unit_price:unit_price?.toFixed(2)??null}:{})};
 });
}
function scope(actor:Viewer):Prisma.InventoryTransactionWhereInput {
 return can(actor.role,'history:all')?{}:{OR:[{type:{in:['ISSUE','RECEIVE']},actor_user_id:actor.id},{type:'REVERSAL',reverses_id_record:{type:{in:['ISSUE','RECEIVE']},actor_user_id:actor.id}}]};
}
function priceBound(value:unknown):string|undefined {
 if(value===undefined||value==='')return undefined;
 return price(typeof value==='string'?value.trim():value);
}
function cents(value:string){const [whole,fraction='']=value.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));}
export async function listHistory(db:PrismaClient,auth:AuthService,token:string|undefined,query:Input={}){
 const actor=await auth.authenticate(token,'history:own'),tool_id=optionalId(query.tool_id),actor_user_id=optionalId(query.actor_user_id);
 const toolCode=text(query.tool_code ?? '', '品目コード', 100, true), category=categoryValue(query.category, true);
 if(query.machine_id!==undefined&&query.machine_id!=='')throw new AuthError(400,'設備の検索は廃止されました');
 const from=calendarDate(query.from),to=calendarDate(query.to);
 if(from&&to&&from>to)throw new AuthError(400,'開始日と終了日を確認してください');
 const type=query.type===undefined||query.type===''?undefined:query.type;
 if(type!==undefined&&(typeof type!=='string'||!['ISSUE','RECEIVE','ADJUSTMENT','REVERSAL','RETURN'].includes(type)))throw new AuthError(400,'取引種別を確認してください');
 const movement=query.movement===undefined||query.movement===''?undefined:query.movement;
 if(movement!==undefined&&!['ISSUE','RECEIVE'].includes(movement as string))throw new AuthError(400,'入出庫を確認してください');
 const min=priceBound(query.unit_price_min),max=priceBound(query.unit_price_max);
 if((min!==undefined||max!==undefined)&&!showPrice(actor))throw new AuthError(403,'単価を検索する権限がありません');
 if(min!==undefined&&max!==undefined&&cents(min)>cents(max))throw new AuthError(400,'単価の下限と上限を確認してください');
 if(actor_user_id&&!can(actor.role,'history:all')&&actor_user_id!==actor.id)throw new AuthError(403,'他の利用者の履歴は参照できません');
 const page=query.page===undefined||query.page===''?1:integer(query.page,'ページ',1,Number.MAX_SAFE_INTEGER);
 const where:Prisma.InventoryTransactionWhereInput={AND:[scope(actor),{
  ...(tool_id?{tool_id}:{}),...(actor_user_id?{actor_user_id}:{}),
  ...(toolCode||category?{tool_id_record:{...(toolCode?{tool_code:{contains:toolCode,mode:'insensitive'}}:{}),...(category?{category:{in:categoryAliases(category),mode:'insensitive'}}:{})}}:{}),
  ...(type?{type:type as Prisma.EnumTransactionTypeFilter['equals']}:{}),
  ...(movement?{quantity:movement==='RECEIVE'?{gt:0}:{lt:0}}:{}),
  ...(min!==undefined||max!==undefined?{unit_price:{...(min!==undefined?{gte:min}:{}),...(max!==undefined?{lte:max}:{})}}:{}),
  ...(from||to?{created_at:{...(from?{gte:from}:{}),...(to?{lt:new Date(to.getTime()+24*60*60_000)}:{})}}:{}),
 }]};
 const total=await db.inventoryTransaction.count({where});
 const rows=page>Math.ceil(total/50)?[]:await db.inventoryTransaction.findMany({where,select:transactionSelect,orderBy:[{created_at:'desc'},{id:'desc'}],take:50,skip:(page-1)*50});
 return {items:await dtos(db,rows,showPrice(actor)),total,page,pageSize:50};
}
export async function historyDetail(db:PrismaClient,auth:AuthService,token:string|undefined,id:string):Promise<HistoryItem&{confirmation?:InventoryResult}>{
 const actor=await auth.authenticate(token,'history:own');
 const row=await db.inventoryTransaction.findFirst({where:{AND:[{id:uuid(id)},scope(actor)]},select:transactionSelect});
 if(!row)throw new AuthError(404,'履歴が見つかりません');
 const log=await db.auditLog.findFirst({where:{action:'INVENTORY_MUTATION',entity_type:'inventory_transactions',entity_id:row.id}});
 const confirmation=(log?.details as unknown as {result?:InventoryResult}|undefined)?.result;
 return {...(await dtos(db,[row],showPrice(actor)))[0],...(confirmation?{confirmation}:{})};
}
export async function historyOptions(db:PrismaClient,auth:AuthService,token:string|undefined){
 const actor=await auth.authenticate(token,'history:own');
 const [tools,actors]=await Promise.all([
  db.tool.findMany({select:{id:true,tool_code:true,name:true,active:true},orderBy:{tool_code:'asc'}}),
  db.user.findMany({where:can(actor.role,'history:all')?{}:{id:actor.id},select:{id:true,employee_code:true,name:true,active:true},orderBy:{employee_code:'asc'}}),
 ]);
 return {tools,actors};
}
