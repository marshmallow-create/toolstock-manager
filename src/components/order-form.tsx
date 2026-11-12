'use client';
import { useState } from 'react';
import { buttonClass, inputClass } from './masters';

export function OrderForm({entryId,tool,quantity,requestKey}:{entryId:string;tool:{id:string;unit:string;order_unit:string;units_per_order:number};quantity:number;requestKey:string}) {
 const [value,setValue]=useState(String(quantity||1));
 const count=/^\d+$/.test(value)?Number(value):NaN,total=count*tool.units_per_order;
 const invalid=!Number.isInteger(count)||count<1||!Number.isSafeInteger(total)||total>2147483647;
 return <form action="/api/orders" method="post" className="grid gap-2">
  <input type="hidden" name="entry_id" value={entryId}/><input type="hidden" name="tool_id" value={tool.id}/>
  <input type="hidden" name="expected_units_per_order" value={tool.units_per_order}/><input type="hidden" name="request_key" value={requestKey}/>
  <label>発注数（{tool.order_unit}）<input aria-label="発注する数量" name="quantity" type="number" min={1} max={Math.floor(2147483647/tool.units_per_order)} step={1} required className={inputClass} value={value} onChange={event=>setValue(event.target.value)}/></label>
  <output aria-live="polite">在庫換算：{invalid?'—':total.toLocaleString('ja-JP')} {tool.unit}</output>
  <button disabled={invalid} className={buttonClass}>発注済みに登録</button>
 </form>;
}
