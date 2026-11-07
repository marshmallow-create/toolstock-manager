import type { ComponentProps } from 'react';
export const inputClass = 'min-w-0 w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm';
export const buttonClass = 'rounded bg-blue-900 px-4 py-2 text-sm text-white disabled:opacity-50';
export const panelClass = 'rounded-xl bg-white p-3 shadow-sm';
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
type ToolValues = { tool_code: string; name: string; category: string; manufacturer: string; model: string; unit: string; active: boolean; department?: string; shelf_code?: string; unit_price?: string | null; policy?: { safety_stock: number; reorder_point: number; target_stock: number } | null };
export function ToolForm({ action, tool }: { action: string; tool?: ToolValues }) {
 if (!tool) return <form action={action} method="post" className={'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ' + panelClass}>
  <Field label="品目コード" name="tool_code" required maxLength={32} pattern="[A-Za-z0-9_\x2D]+" />
  <Field label="品目名" name="name" required maxLength={100} />
  <Field label="カテゴリー" name="category" required maxLength={64} />
  <NumberField label="在庫" name="on_hand" defaultValue={0} />
  <label className="grid gap-1">発注済み<output className="rounded border border-slate-200 bg-slate-50 p-2 text-slate-600" title="発注データから自動集計します">0</output></label>
  <NumberField label="発注ライン" name="reorder_point" defaultValue={0} />
  <NumberField label="発注数" name="order_quantity" defaultValue={0} />
  <Field label="単価" name="unit_price" required inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" maxLength={15} defaultValue="0.00" />
  <Field label="部門" name="department" maxLength={100} />
  <Field label="棚番" name="shelf_code" maxLength={100} />
  <p className="text-sm text-slate-600 sm:col-span-2 lg:col-span-3">発注済みは自動集計されます。発注数は発注候補として登録されます。</p>
  <button className={buttonClass + ' sm:col-span-2 lg:col-span-3'}>工具を登録する</button>
 </form>;
 return <form action={action} method="post" className={'grid gap-3 sm:grid-cols-2 ' + panelClass}>
  <Field label="品目コード" name="tool_code" required maxLength={32} pattern="[A-Za-z0-9_\x2D]+" defaultValue={tool?.tool_code} readOnly={!!tool} />
  <Field label="品目名" name="name" required maxLength={100} defaultValue={tool?.name} />
  <Field label="カテゴリー" name="category" required maxLength={64} defaultValue={tool?.category} />
  <Field label="メーカー（任意）" name="manufacturer" maxLength={100} defaultValue={tool?.manufacturer} />
  <Field label="型番（任意）" name="model" maxLength={100} defaultValue={tool?.model} />
  <Field label="数量単位（例：本、個）" name="unit" required maxLength={16} defaultValue={tool?.unit} />
  <Field label="単価" name="unit_price" required inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" maxLength={15} defaultValue={tool?.unit_price ?? '0.00'} />
  <Field label="部門" name="department" maxLength={100} defaultValue={tool?.department ?? ''} />
  <Field label="棚番" name="shelf_code" maxLength={Math.max(100, tool.shelf_code?.length ?? 0)} defaultValue={tool.shelf_code ?? ''} />
  <Active value={tool?.active} />
  <fieldset className="grid gap-3 rounded border p-3 sm:col-span-2 sm:grid-cols-3"><legend className="px-2 font-bold">工具全体の在庫方針</legend>
   <NumberField label="安全在庫" name="safety_stock" defaultValue={tool?.policy?.safety_stock ?? 0} />
   <NumberField label="発注点" name="reorder_point" defaultValue={tool?.policy?.reorder_point ?? 0} />
   <NumberField label="目標在庫" name="target_stock" defaultValue={tool?.policy?.target_stock ?? 0} />
   <p className="text-sm sm:col-span-3">安全在庫 ≦ 発注点 ≦ 目標在庫。保管場所を合計した工具全体の値です。</p>
  </fieldset>
  {tool && <p className="text-sm sm:col-span-2">工具番号は変更できません。在庫・履歴がある工具の単位変更は、別の工具として登録してください。</p>}
  <button className={buttonClass + ' sm:col-span-2'}>{tool ? '変更を保存する' : '工具を登録する'}</button>
 </form>;
}
export type MasterRow = { id: string; name: string; active: boolean; location_code: string };
export const masterCode = (row: MasterRow) => row.location_code;
