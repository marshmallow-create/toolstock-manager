import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { code, text, integer, price, categoryValue, departmentValue } from './validation';
import { conflict, updateToolInTransaction } from './write';
import { MAX_IMPORT_ROWS, type ImportRow, type ImportPreviewRow } from './tool-import';
import { categoryCode } from '../tool-options';

export type UpdatePreviewRow = ImportPreviewRow & { before: Record<string,string>; changes: string[] };
const validators: Record<string,(value:unknown)=>string|number> = {
 units_per_order:value=>integer(value,'入数',1),
 name:value=>text(value,'品目名',100), category:categoryValue,
 on_hand:value=>integer(value,'在庫'), reorder_point:value=>integer(value,'発注ライン'),
 order_quantity:value=>integer(value,'発注数'), unit_price:price,
 department:departmentValue, shelf_code:value=>text(value,'棚番',100,true),
};

async function inspectUpdate(db: Pick<Prisma.TransactionClient,'tool'>, rows:ImportRow[]) {
 if(!rows.length || rows.length>MAX_IMPORT_ROWS)throw new AuthError(400,'変更する行は1〜200件にしてください。');
 const codes=rows.map(row=>{try{return code(row.values.tool_code);}catch{return '';}});
 const tools=await db.tool.findMany({where:{tool_code:{in:codes}},orderBy:{id:'asc'},include:{
  stock_balances_tool_id_children:{orderBy:{id:'asc'}},inventory_policies_tool_id_children:true,
  reorder_candidates_tool_id_children:{where:{status:'OPEN'},orderBy:{id:'asc'}},
 }});
 const byCode=new Map(tools.map(tool=>[tool.tool_code,tool]));
 const result:UpdatePreviewRow[]=rows.map((row,index)=>{
  const tool=byCode.get(codes[index]),errors:string[]=[],before:Record<string,string>=tool?{
   units_per_order:String(tool.units_per_order),
   tool_code:tool.tool_code,name:tool.name,category:tool.category,department:tool.department,shelf_code:tool.shelf_code,
   unit_price:tool.unit_price?.toString()??'',on_hand:String(tool.stock_balances_tool_id_children.reduce((sum,stock)=>sum+stock.on_hand,0)),
   reorder_point:String(tool.inventory_policies_tool_id_children?.reorder_point??0),
   order_quantity:String(tool.reorder_candidates_tool_id_children.reduce((sum,item)=>sum+item.quantity,0)),
  }:{};
  const values:Record<string,string>={...before,tool_code:codes[index]},changes:string[]=[];
  if(!codes[index])errors.push('品目コードを確認してください。');
  else if(!tool)errors.push('品目コード：登録されていません。');
  if(codes.filter(value=>value===codes[index]).length>1)errors.push('品目コード：ファイル内で重複しています。');
  let supplied=0;
  for(const [field,validate] of Object.entries(validators)){
   const value=row.values[field];
   if(value===undefined || value===null || value==='')continue;
   supplied++;
   // Migrated shelves can exceed the new-input limit; retain an unchanged value.
   if(field==='shelf_code' && value===before[field])continue;
   try{
    values[field]=String(validate(value));
    const equal=field==='unit_price'?before[field]!=='' && Number(before[field])===Number(values[field]):field==='category'?categoryCode(before[field])===values[field]:before[field]===values[field];
    if(!equal)changes.push(field);
   }catch(error){if(!(error instanceof AuthError))throw error;errors.push(error.message);}
  }
  if(!supplied)errors.push('変更する項目を入力してください。');
  if(tool && changes.includes('on_hand') && Number(values.on_hand)<tool.stock_balances_tool_id_children.reduce((sum,stock)=>sum+stock.reserved,0))errors.push('在庫は引当数以上で入力してください。');
  return {rowNumber:row.rowNumber,values,before,changes,errors};
 });
 const previewToken=createHash('sha256').update(JSON.stringify({rows,tools})).digest('hex');
 return {rows:result,count:result.length,valid:result.every(row=>!row.errors.length),previewToken};
}

export async function previewToolUpdate(db:PrismaClient,auth:AuthService,token:string|undefined,rows:ImportRow[]) {
 await auth.authenticate(token,'tools:import');
 await auth.authenticate(token,'tools:update');
 return inspectUpdate(db,rows);
}
export async function commitToolUpdate(db:PrismaClient,auth:AuthService,token:string|undefined,rows:ImportRow[],previewToken:string) {
 await auth.authenticate(token,'tools:import');
 await auth.authenticate(token,'tools:update');
 return conflict(()=>auth.authorized(token,['tools:import','tools:update'],async(tx,actor)=>{
  if(!rows.length || rows.length>MAX_IMPORT_ROWS)throw new AuthError(400,'変更する行は1〜200件にしてください。');
  // Lock in a stable order, matching the locks used by single-tool edits and stock operations.
  const codes=[...new Set(rows.map(row=>code(row.values.tool_code)))].sort();
  for(const value of codes)await tx.$queryRaw`SELECT id FROM tools WHERE tool_code=${value} FOR UPDATE`;
  const preview=await inspectUpdate(tx,rows);
  if(!preview.valid)throw new AuthError(400,'変更できない行があります。内容を確認し直してください。');
  if(!previewToken || preview.previewToken!==previewToken)throw new AuthError(409,'確認後に工具情報・在庫またはファイルが変更されています。内容を再確認してください。');
  let count=0;
  for(const row of preview.rows){
   if(!row.changes.length)continue;
   const tool=await tx.tool.findUniqueOrThrow({where:{tool_code:row.values.tool_code}});
   const patch=Object.fromEntries(row.changes.map(field=>[field,row.values[field]]));
   await updateToolInTransaction(tx,actor,tool.id,{
    name:row.before.name,category:row.before.category,active:tool.active,
    reorder_point:row.before.reorder_point,
    ...patch,
    ...(row.changes.includes('on_hand')?{expected_on_hand:row.before.on_hand}:{}),
   });
   count++;
  }
  return {count};
 }));
}
