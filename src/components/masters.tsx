import type { ComponentProps } from 'react';
import { CategoryField, DepartmentField } from './tool-option-fields';
export const inputClass = 'min-w-0 w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm';
export const buttonClass = 'ui-button w-fit max-w-full justify-self-start disabled:opacity-50';
export const panelClass = 'ui-panel rounded-xl bg-white p-3 shadow-sm';
export type Search = Record<string, string | string[] | undefined>;
export const queryText = (value: unknown) => typeof value === 'string' ? value : '';
export function Messages({ search }: { search: Search }) {
 return <>{queryText(search.error) && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-red-800">{queryText(search.error).slice(0, 200)}</p>}{queryText(search.saved) && <p role="status" className="mb-3 rounded bg-green-50 p-3 text-green-900">保存しました。</p>}</>;
}
export function Field({ label, ...props }: ComponentProps<'input'> & { label: string }) {
 return <label className="grid gap-1">{label}<input {...props} className={inputClass} /></label>;
}
export function NumberField(props: ComponentProps<'input'> & { label: string }) {
 return <Field type="number" min={0} max={2147483647} step={1} required inputMode="numeric" {...props} />;
}
export function Active({ value = true }: { value?: boolean }) {
 return <label className="grid gap-1">状態<select name="active" defaultValue={String(value)} className={inputClass}><option value="true">有効</option><option value="false">無効</option></select></label>;
}
type ToolValues = { tool_code: string; name: string; category: string; manufacturer: string; model: string; unit: string; active: boolean; on_hand: number; order_quantity: number; department?: string; shelf_code?: string; unit_price?: string | null; policy?: { safety_stock: number; reorder_point: number; target_stock: number } | null };
export function ToolForm({ action, tool }: { action: string; tool?: ToolValues }) {
 if (!tool) return <form action={action} method="post" className={'grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3 ' + panelClass}>
  <Field label="品目コード" name="tool_code" required maxLength={32} pattern="[A-Za-z0-9_\x2D]+" />
  <Field label="品目名" name="name" required maxLength={100} />
  <CategoryField required />
  <NumberField label="在庫" name="on_hand" defaultValue={0} />
  <label className="grid gap-1">発注済み<output className="rounded border border-slate-200 bg-slate-50 p-2 text-slate-600" title="発注データから自動集計します">0</output></label>
  <NumberField label="発注ライン" name="reorder_point" defaultValue={0} />
  <NumberField label="発注数" name="order_quantity" defaultValue={0} />
  <Field label="単価" name="unit_price" required inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" maxLength={15} defaultValue="0.00" />
  <DepartmentField />
  <Field label="棚番" name="shelf_code" maxLength={100} />
  <p className="text-sm text-slate-600 sm:col-span-2 lg:col-span-3">発注済みは自動集計されます。</p>
  <button className={buttonClass + ' sm:col-span-2 lg:col-span-3'}>工具を登録する</button>
 </form>;
 return <form action={action} method="post" className={'grid max-w-3xl gap-3 sm:grid-cols-2 ' + panelClass}>
  <Field label="品目コード" name="tool_code" required maxLength={32} pattern="[A-Za-z0-9_\x2D]+" defaultValue={tool?.tool_code} readOnly={!!tool} />
  <Field label="品目名" name="name" required maxLength={100} defaultValue={tool?.name} />
  <CategoryField required value={tool.category} />
  <NumberField label="在庫" name="on_hand" defaultValue={tool.on_hand} />
  <NumberField label="発注ライン" name="reorder_point" defaultValue={tool.policy?.reorder_point ?? 0} />
  <NumberField label="発注数" name="order_quantity" defaultValue={tool.order_quantity} />
  <input type="hidden" name="expected_on_hand" value={tool.on_hand} />
  <input type="hidden" name="manufacturer" value={tool.manufacturer} />
  <input type="hidden" name="model" value={tool.model} />
  <input type="hidden" name="unit" value={tool.unit} />
  {tool.unit_price !== undefined && <Field label="単価" name="unit_price" required inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" maxLength={15} defaultValue={tool.unit_price ?? '0.00'} />}
  <DepartmentField value={tool.department} />
  <Field label="棚番" name="shelf_code" maxLength={Math.max(100, tool.shelf_code?.length ?? 0)} defaultValue={tool.shelf_code ?? ''} />
  <Active value={tool?.active} />
  <button className={buttonClass + ' sm:col-span-2'}>{tool ? '変更を保存する' : '工具を登録する'}</button>
 </form>;
}
export type MasterRow = { id: string; name: string; active: boolean; location_code: string };
export const masterCode = (row: MasterRow) => row.location_code;
