import { AuthError } from '../auth/service';
import { integer, text, uuid } from '../masters/validation';
import type { Operation, Input } from './types';
export type Normalized = {
 operation:Operation; request_key:string; reason:string|null;
 tool_id?:string; location_id?:string; quantity?:number; machine_id?:string;
 transaction_id?:string;
};
export function mutationInput(operation:Operation,input:Input):Normalized {
 const request_key=uuid(input.request_key), reason=text(input.reason,'理由',500,operation!=='reverse')||null;
 if(operation==='reverse')return {operation,request_key,reason,transaction_id:uuid(input.transaction_id)};
 const common={operation,request_key,reason,tool_id:uuid(input.tool_id),location_id:uuid(input.location_id)};
 if(operation==='receive'&&['order_id','order_item_id','purchase_order_id','purchase_order_item_id'].some(field=>Object.hasOwn(input,field)))throw new AuthError(400,'発注書にひも付く入荷は未対応です。入庫を利用してください');
 return {...common,quantity:integer(input.quantity,'数量',1),...(operation==='issue'&&input.machine_id!==undefined&&input.machine_id!==''?{machine_id:uuid(input.machine_id)}:{})};
}
export function fingerprint(input:Normalized) {
 return JSON.stringify(Object.keys(input).sort().map(key=>[key,input[key as keyof Normalized]]));
}
export function optionalId(value:unknown) {
 return value===undefined||value===''?undefined:uuid(value);
}
export function calendarDate(value:unknown):Date|undefined {
 if(value===undefined||value==='')return undefined;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))throw new AuthError(400,'日付はYYYY-MM-DD形式で入力してください');
 const utc=new Date(value+'T00:00:00.000Z');
 if(!Number.isFinite(utc.getTime())||utc.toISOString().slice(0,10)!==value)throw new AuthError(400,'実在する日付を入力してください');
 return new Date(utc.getTime()-9*60*60_000);
}
