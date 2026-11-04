import type { PrismaClient, Prisma } from '../../generated/prisma/client';
import { AuthService, AuthError, type Viewer } from '../auth/service';
import { can } from '../auth/permissions';
import { uuid, integer } from '../masters/validation';
import { calendarDate, optionalId } from './validation';
import type { Input, HistoryItem, InventoryResult } from './types';
const transactionSelect={
 id:true,type:true,quantity:true,reason:true,created_at:true,reverses_id:true,
 tool_id_record:{select:{id:true,tool_code:true,name:true,unit:true,active:true}},
 location_id_record:{select:{id:true,location_code:true,name:true,active:true}},
 actor_user_id_record:{select:{id:true,employee_code:true,name:true,active:true}},
 machine_id_record:{select:{id:true,machine_code:true,name:true,active:true}},
 inventory_transactions_reverses_id_children:{select:{id:true}},
} as const satisfies Prisma.InventoryTransactionSelect;
type Row=Prisma.InventoryTransactionGetPayload<{select:typeof transactionSelect}>;
function dto(row:Row):HistoryItem {
 const {tool_id_record:tool,location_id_record:location,actor_user_id_record:actor,machine_id_record:machine,inventory_transactions_reverses_id_children:reversal,...fields}=row;
 return {...fields,tool,location,actor,machine,reversal_id:reversal?.id??null};
}
function scope(actor:Viewer):Prisma.InventoryTransactionWhereInput {
 return can(actor.role,'history:all')?{}:{OR:[{type:'ISSUE',actor_user_id:actor.id},{type:'REVERSAL',reverses_id_record:{type:'ISSUE',actor_user_id:actor.id}}]};
}
export async function listHistory(db:PrismaClient,auth:AuthService,token:string|undefined,query:Input={}){
 const actor=await auth.authenticate(token,'history:own'),tool_id=optionalId(query.tool_id),machine_id=optionalId(query.machine_id),actor_user_id=optionalId(query.actor_user_id);
 const from=calendarDate(query.from),to=calendarDate(query.to);
 if(from&&to&&from>to)throw new AuthError(400,'開始日と終了日を確認してください');
 const type=query.type===undefined||query.type===''?undefined:query.type;
 if(type!==undefined&&(typeof type!=='string'||!['ISSUE','RECEIVE','ADJUSTMENT','REVERSAL','RETURN'].includes(type)))throw new AuthError(400,'取引種別を確認してください');
 if(actor_user_id&&!can(actor.role,'history:all')&&actor_user_id!==actor.id)throw new AuthError(403,'他の利用者の履歴は参照できません');
 const page=query.page===undefined||query.page===''?1:integer(query.page,'ページ',1,Number.MAX_SAFE_INTEGER);
 const where:Prisma.InventoryTransactionWhereInput={AND:[scope(actor),{...(tool_id?{tool_id}:{}),...(machine_id?{machine_id}:{}),...(actor_user_id&&can(actor.role,'history:all')?{actor_user_id}:{}),...(type?{type:type as Prisma.EnumTransactionTypeFilter['equals']}:{}),...(from||to?{created_at:{...(from?{gte:from}:{}),...(to?{lt:new Date(to.getTime()+24*60*60_000)}:{})}}:{})}]};
 const total=await db.inventoryTransaction.count({where});
 const rows=page>Math.ceil(total/50)?[]:await db.inventoryTransaction.findMany({where,select:transactionSelect,orderBy:[{created_at:'desc'},{id:'desc'}],take:50,skip:(page-1)*50});
 return {items:rows.map(dto),total,page,pageSize:50};
}
export async function historyDetail(db:PrismaClient,auth:AuthService,token:string|undefined,id:string):Promise<HistoryItem&{confirmation?:InventoryResult}>{
 const actor=await auth.authenticate(token,'history:own');
 const row=await db.inventoryTransaction.findFirst({where:{AND:[{id:uuid(id)},scope(actor)]},select:transactionSelect});
 if(!row)throw new AuthError(404,'履歴が見つかりません');
 const log=await db.auditLog.findFirst({where:{action:'INVENTORY_MUTATION',entity_type:'inventory_transactions',entity_id:row.id}});
 const confirmation=(log?.details as unknown as {result?:InventoryResult}|undefined)?.result;
 return {...dto(row),...(confirmation?{confirmation}:{})};
}
export async function historyOptions(db:PrismaClient,auth:AuthService,token:string|undefined){
 const actor=await auth.authenticate(token,'history:own');
 const [tools,machines,actors]=await Promise.all([
  db.tool.findMany({select:{id:true,tool_code:true,name:true,active:true},orderBy:{tool_code:'asc'}}),
  db.machine.findMany({select:{id:true,machine_code:true,name:true,active:true},orderBy:{machine_code:'asc'}}),
  db.user.findMany({where:can(actor.role,'history:all')?{}:{id:actor.id},select:{id:true,employee_code:true,name:true,active:true},orderBy:{employee_code:'asc'}}),
 ]);
 return {tools,machines,actors};
}
