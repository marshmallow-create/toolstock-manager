'use client';
import { buttonClass } from './masters';

export function OrderForm({entryId,tool,quantity,requestKey}:{entryId:string;tool:{id:string;units_per_order:number};quantity:number;requestKey:string}) {
 const total=quantity*tool.units_per_order;
 const invalid=!Number.isInteger(quantity)||quantity<1||!Number.isSafeInteger(total)||total>2147483647;
 return <form action="/api/orders" method="post" className="flex gap-2">
  <input type="hidden" name="entry_id" value={entryId}/><input type="hidden" name="tool_id" value={tool.id}/>
  <input type="hidden" name="expected_units_per_order" value={tool.units_per_order}/><input type="hidden" name="request_key" value={requestKey}/>
  <input type="hidden" name="quantity" value={quantity}/>
  <button disabled={invalid} className={buttonClass}>発注済みへ登録</button>
  <button formAction="/api/orders/cancel" className="ui-secondary">取消</button>
 </form>;
}
