'use client';
import { useState } from 'react';
import { inputClass, buttonClass } from './masters';

type Location = { id: string; location_code: string; name: string };
type Stock = { location_id: string; on_hand: number; reserved: number };
type Machine = { id: string; machine_code: string; name: string };
export function InventoryForm({ mode, tool, locations, stocks, machines, requestKey }: {
 mode: 'issue' | 'receive' | 'adjust'; tool: { id: string; unit: string }; locations: Location[]; stocks: Stock[]; machines: Machine[]; requestKey: string;
}) {
 const initialLocation = locations.length === 1 ? locations[0].id : '';
 const [locationId, setLocationId] = useState(initialLocation), [quantity, setQuantity] = useState(mode === 'adjust' ? String(stocks.find(stock => stock.location_id === initialLocation)?.on_hand ?? 0) : '1');
 const stock = stocks.find(value => value.location_id === locationId), onHand = stock?.on_hand ?? 0, reserved = stock?.reserved ?? 0;
 const numeric = /^\d+$/.test(quantity) ? Number(quantity) : NaN;
 const after = mode === 'adjust' ? numeric : mode === 'issue' ? onHand - numeric : onHand + numeric;
 const invalid = !locationId || !Number.isInteger(numeric) || numeric < (mode === 'adjust' ? 0 : 1) || numeric > 2147483647 || after < reserved || after > 2147483647;
 const labels = { issue: '出庫を確定する', receive: '手動入庫を確定する', adjust: '棚卸結果を反映する' };
 return <form action={'/api/inventory/' + mode} method="post" className="grid gap-5 sm:grid-cols-2">
  <input type="hidden" name="request_key" value={requestKey} /><input type="hidden" name="tool_id" value={tool.id} />
  <label className="grid gap-1">保管場所<select name="location_id" required value={locationId} onChange={event => { const id = event.target.value; setLocationId(id); if (mode === 'adjust') setQuantity(String(stocks.find(value => value.location_id === id)?.on_hand ?? 0)); }} className={inputClass}>
   <option value="" disabled>選択してください</option>{locations.map(location => <option key={location.id} value={location.id}>{location.location_code} / {location.name}</option>)}
  </select></label>
  {mode === 'issue' && <label className="grid gap-1">使用設備（必須）<select name="machine_id" required defaultValue="" className={inputClass}><option value="" disabled>選択してください</option>{machines.map(machine => <option key={machine.id} value={machine.id}>{machine.machine_code} / {machine.name}</option>)}</select></label>}
  <fieldset className="grid gap-2"><legend>{mode === 'adjust' ? '実棚数' : '数量'}（{tool.unit}）</legend><div className="flex items-center gap-2">
   <button type="button" aria-label="数量を1減らす" className="rounded border px-4 py-3" onClick={() => setQuantity(String(Math.max(mode === 'adjust' ? 0 : 1, (Number.isFinite(numeric) ? numeric : 1) - 1)))}>−</button>
   <input aria-label={mode === 'adjust' ? '実棚数' : '数量'} name={mode === 'adjust' ? 'counted_quantity' : 'quantity'} type="number" min={mode === 'adjust' ? 0 : 1} max={2147483647} step={1} inputMode="numeric" required value={quantity} onChange={event => setQuantity(event.target.value)} className={inputClass} />
   <button type="button" aria-label="数量を1増やす" className="rounded border px-4 py-3" onClick={() => setQuantity(String(Math.min(2147483647, (Number.isFinite(numeric) ? numeric : 0) + 1)))}>＋</button>
  </div></fieldset>
  {mode === 'adjust' && <><input type="hidden" name="expected_on_hand" value={onHand} /><input type="hidden" name="expected_reserved" value={reserved} /></>}
  <div aria-live="polite" className="rounded bg-slate-50 p-4 sm:col-span-2">{locationId ? <><p>現在の実在庫 {onHand} {tool.unit} / 引当 {reserved} / 出庫可能 {onHand - reserved} {tool.unit}</p><p className="mt-2 font-bold">{mode === 'issue' ? '出庫後の見込み' : mode === 'receive' ? '入庫後の見込み' : '棚卸後の見込み'}：{Number.isInteger(after) ? after : '—'} {tool.unit}{mode === 'adjust' && Number.isInteger(after) && `（差分 ${after - onHand >= 0 ? '+' : ''}${after - onHand}）`}</p>{invalid && <p className="mt-2 text-red-800">数量と出庫可能数を確認してください。</p>}</> : '保管場所を選択すると現在庫と変更後の見込みを表示します。'}</div>
  <label className="grid gap-1 sm:col-span-2">理由{mode === 'issue' ? '（任意）' : '（必須・500文字以内）'}<textarea name="reason" required={mode !== 'issue'} maxLength={500} rows={3} className={inputClass} /></label>
  {mode === 'adjust' && <p className="text-sm sm:col-span-2">表示後に在庫が変わると反映できません。最新の在庫を再読込し、実棚数を確認してください。数量の変更がない場合は登録できません。</p>}
  <p className="text-sm sm:col-span-2">見込みは参考値です。確定時に最新の在庫を確認します。</p>
  <button disabled={invalid || (mode === 'issue' && !machines.length)} className={buttonClass + ' sm:col-span-2'}>{labels[mode]}</button>
 </form>;
}
