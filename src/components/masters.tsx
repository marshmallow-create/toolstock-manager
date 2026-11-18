import type { ComponentProps } from 'react';
import { CategoryField, DepartmentField } from './tool-option-fields';
export const inputClass = 'min-w-0 w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm';
export const buttonClass = 'ui-button w-fit max-w-full justify-self-start disabled:opacity-50';
export const panelClass = 'ui-panel rounded-xl bg-white p-4 shadow-sm sm:p-5';
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
type ToolValues = { tool_code: string; name: string; category: string; units_per_order?:number; active: boolean; on_hand: number; order_quantity: number; department?: string; shelf_code?: string; unit_price?: string | null; policy?: { reorder_point: number } | null };
export function ToolForm({ action, tool }: { action: string; tool?: ToolValues }) {
 return <form action={action} method="post" className={'grid max-w-3xl gap-5 ' + panelClass}>
  <fieldset className="tool-fields">
   <legend>基本情報</legend>
   <Field label="品目コード" name="tool_code" required maxLength={32} pattern="[A-Za-z0-9_\x2D]+" defaultValue={tool?.tool_code} readOnly={!!tool} />
   <Field label="品目名" name="name" required maxLength={100} defaultValue={tool?.name} />
   <CategoryField required value={tool?.category} />
  </fieldset>
  <fieldset className="tool-fields">
   <legend>在庫・発注</legend>
   <NumberField label="在庫" name="on_hand" defaultValue={tool?.on_hand ?? 0} />
   <NumberField label="発注ライン" name="reorder_point" defaultValue={tool?.policy?.reorder_point ?? 0} />
   <NumberField label="発注数" name="order_quantity" defaultValue={tool?.order_quantity ?? 0} />
   <NumberField label="入数" name="units_per_order" min={1} defaultValue={tool?.units_per_order ?? 1} />
   {tool && <input type="hidden" name="expected_on_hand" value={tool.on_hand} />}
   {(!tool || tool.unit_price !== undefined) && <Field label="発注単価" name="unit_price" required inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" maxLength={15} defaultValue={tool?.unit_price?.replace(/\.0+$/, '') ?? '0'} />}
   {!tool && <>
    <label className="grid gap-1">発注済み<output className="rounded border border-slate-200 bg-slate-50 px-3 py-1.5" title="発注データから自動集計します">0</output></label>
    <p className="text-xs text-slate-600 sm:col-span-2">発注済みは自動集計されます。</p>
   </>}
  </fieldset>
  <fieldset className="tool-fields">
   <legend>管理情報</legend>
   <DepartmentField value={tool?.department} />
   <Field label="棚番" name="shelf_code" maxLength={Math.max(100, tool?.shelf_code?.length ?? 0)} defaultValue={tool?.shelf_code} />
   {tool && <Active value={tool.active} />}
  </fieldset>
  <button className={buttonClass}>{tool ? '変更を保存する' : '工具を登録する'}</button>
 </form>;
}
