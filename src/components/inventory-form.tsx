'use client';
import { useState } from 'react';
import { inputClass, buttonClass } from './masters';

type Location = { id: string; location_code: string; name: string };
type Stock = { location_id: string; on_hand: number; reserved: number };
export function InventoryForm({ mode, tool, locations, stocks, requestKey }: {
 mode: 'issue' | 'receive'; tool: { id: string; unit: string; shelf_code?: string }; locations: Location[]; stocks: Stock[]; requestKey: string;
}) {
 const [locationId, setLocationId] = useState(locations.length === 1 ? locations[0].id : ''), [quantity, setQuantity] = useState('1');
 const stock = stocks.find(value => value.location_id === locationId), onHand = stock?.on_hand ?? 0, reserved = stock?.reserved ?? 0;
 const numeric = /^\d+$/.test(quantity) ? Number(quantity) : NaN;
 const after = mode === 'issue' ? onHand - numeric : onHand + numeric;
 const invalid = !locationId || !Number.isInteger(numeric) || numeric < 1 || numeric > 2147483647 || after < reserved || after > 2147483647;
 const labels = { issue: '出庫を確定する', receive: '入庫を確定する' };
 return <form action={'/api/inventory/' + mode} method="post" className="grid gap-3 sm:grid-cols-2">
  <input type="hidden" name="request_key" value={requestKey} /><input type="hidden" name="tool_id" value={tool.id} />
  {locations.length === 1 && locations[0].location_code.startsWith('@tool/') ? <div><input type="hidden" name="location_id" value={locationId} /><p>棚番</p><p className="mt-1 rounded bg-slate-50 p-2">{tool.shelf_code || '—'}</p></div> : <label className="grid gap-1">保管場所<select name="location_id" required value={locationId} onChange={event => setLocationId(event.target.value)} className={inputClass}>
   <option value="" disabled>選択してください</option>{locations.map(location => <option key={location.id} value={location.id}>{location.location_code} / {location.name}</option>)}
  </select></label>}
  <fieldset className="grid min-w-0 gap-2"><legend>数量（{tool.unit}）</legend><div className="flex items-center gap-2">
   <button type="button" aria-label="数量を1減らす" className="rounded border px-3 py-2 text-sm" onClick={() => setQuantity(String(Math.max(1, (Number.isFinite(numeric) ? numeric : 1) - 1)))}>−</button>
   <input aria-label="数量" name="quantity" type="number" min={1} max={2147483647} step={1} inputMode="numeric" required value={quantity} onChange={event => setQuantity(event.target.value)} className={inputClass} />
   <button type="button" aria-label="数量を1増やす" className="rounded border px-3 py-2 text-sm" onClick={() => setQuantity(String(Math.min(2147483647, (Number.isFinite(numeric) ? numeric : 0) + 1)))}>＋</button>
  </div></fieldset>
  <div aria-live="polite" className="rounded bg-slate-50 p-3 sm:col-span-2">{locationId ? <><p>現在の実在庫 {onHand} {tool.unit} / 引当 {reserved} / 出庫可能 {onHand - reserved} {tool.unit}</p><p className="mt-2 font-bold">{mode === 'issue' ? '出庫後の見込み' : '入庫後の見込み'}：{Number.isInteger(after) ? after : '—'} {tool.unit}</p>{invalid && <p className="mt-2 text-red-800">数量と出庫可能数を確認してください。</p>}</> : '保管場所を選択すると現在庫と変更後の見込みを表示します。'}</div>
  <p className="text-sm sm:col-span-2">見込みは参考値です。確定時に最新の在庫を確認します。</p>
  <button disabled={invalid} className={buttonClass + ' sm:col-span-2'}>{labels[mode]}</button>
 </form>;
}
