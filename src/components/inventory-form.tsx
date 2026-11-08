'use client';
import { useState } from 'react';
import { inputClass, buttonClass } from './masters';

type Stock = { location_id: string; on_hand: number; reserved: number };
export function InventoryForm({ mode, tool, stock, requestKey }: {
 mode: 'issue' | 'receive'; tool: { id: string; unit: string }; stock: Stock; requestKey: string;
}) {
 const [quantity, setQuantity] = useState('1');
 const { location_id: locationId, on_hand: onHand, reserved } = stock;
 const numeric = /^\d+$/.test(quantity) ? Number(quantity) : NaN;
 const after = mode === 'issue' ? onHand - numeric : onHand + numeric;
 const invalid = !locationId || !Number.isInteger(numeric) || numeric < 1 || numeric > 2147483647 || after < reserved || after > 2147483647;
 const labels = { issue: '出庫を確定する', receive: '入庫を確定する' };
 return <form action={'/api/inventory/' + mode} method="post" className="grid gap-3">
  <input type="hidden" name="request_key" value={requestKey} /><input type="hidden" name="tool_id" value={tool.id} />
  <input type="hidden" name="location_id" value={locationId} />
  <fieldset className="grid min-w-0 gap-2"><legend>数量（{tool.unit}）</legend><div className="flex max-w-64 items-center gap-2">
   <button type="button" aria-label="数量を1減らす" className="ui-secondary shrink-0" onClick={() => setQuantity(String(Math.max(1, (Number.isFinite(numeric) ? numeric : 1) - 1)))}>−</button>
   <input aria-label="数量" name="quantity" type="number" min={1} max={2147483647} step={1} inputMode="numeric" required value={quantity} onChange={event => setQuantity(event.target.value)} className={inputClass} />
   <button type="button" aria-label="数量を1増やす" className="ui-secondary shrink-0" onClick={() => setQuantity(String(Math.min(2147483647, (Number.isFinite(numeric) ? numeric : 0) + 1)))}>＋</button>
  </div></fieldset>
  <div aria-live="polite" className="rounded bg-slate-50 px-3 py-2"><p className="font-bold">{mode === 'issue' ? '出庫後の見込み' : '入庫後の見込み'}：{Number.isInteger(after) ? after : '—'} {tool.unit}</p>{invalid && <p className="mt-2 text-red-800">数量と出庫可能数を確認してください。</p>}</div>
  <button disabled={invalid} className={buttonClass}>{labels[mode]}</button>
 </form>;
}
