import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
export const inputClass = 'w-full rounded border border-slate-300 bg-white p-2';
export const buttonClass = 'rounded bg-blue-900 px-5 py-3 text-white disabled:opacity-50';
export const panelClass = 'rounded-xl bg-white p-5 shadow-sm';
export type Search = Record<string, string | string[] | undefined>;
export const queryText = (value: unknown) => typeof value === 'string' ? value : '';
export function Shell({ title, children }: { title: string; children: ReactNode }) {
 return <main className="mx-auto max-w-6xl p-5 md:p-10"><nav aria-label="メインナビゲーション" className="mb-6 flex flex-wrap gap-5 text-sm underline"><Link href="/dashboard">ダッシュボード</Link><Link href="/tools">工具一覧</Link></nav><h1 className="mb-6 text-3xl font-bold">{title}</h1>{children}</main>;
}
export function Messages({ search }: { search: Search }) {
 return <>{queryText(search.error) && <p role="alert" className="mb-5 rounded bg-red-50 p-4 text-red-800">{queryText(search.error).slice(0, 200)}</p>}{queryText(search.saved) && <p role="status" className="mb-5 rounded bg-green-50 p-4 text-green-900">保存しました。</p>}</>;
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
type ToolValues = { tool_code: string; name: string; category: string; manufacturer: string; model: string; unit: string; active: boolean; policy?: { safety_stock: number; reorder_point: number; target_stock: number } | null };
export function ToolForm({ action, tool }: { action: string; tool?: ToolValues }) {
 return <form action={action} method="post" className={'grid gap-4 sm:grid-cols-2 ' + panelClass}>
  <Field label="工具番号" name="tool_code" required maxLength={32} pattern="[A-Za-z0-9_\x2D]+" defaultValue={tool?.tool_code} readOnly={!!tool} />
  <Field label="工具名" name="name" required maxLength={100} defaultValue={tool?.name} />
  <Field label="分類" name="category" required maxLength={64} defaultValue={tool?.category} />
  <Field label="メーカー（任意）" name="manufacturer" maxLength={100} defaultValue={tool?.manufacturer} />
  <Field label="型番（任意）" name="model" maxLength={100} defaultValue={tool?.model} />
  <Field label="数量単位（例：本、個）" name="unit" required maxLength={16} defaultValue={tool?.unit} />
  <Active value={tool?.active} />
  <fieldset className="grid gap-4 rounded border p-4 sm:col-span-2 sm:grid-cols-3"><legend className="px-2 font-bold">工具全体の在庫方針</legend>
   <NumberField label="安全在庫" name="safety_stock" defaultValue={tool?.policy?.safety_stock ?? 0} />
   <NumberField label="発注点" name="reorder_point" defaultValue={tool?.policy?.reorder_point ?? 0} />
   <NumberField label="目標在庫" name="target_stock" defaultValue={tool?.policy?.target_stock ?? 0} />
   <p className="text-sm sm:col-span-3">安全在庫 ≦ 発注点 ≦ 目標在庫。保管場所を合計した工具全体の値です。</p>
  </fieldset>
  {tool && <p className="text-sm sm:col-span-2">工具番号は変更できません。在庫・履歴がある工具の単位変更は、別の工具として登録してください。</p>}
  <button className={buttonClass + ' sm:col-span-2'}>{tool ? '変更を保存する' : '工具を登録する'}</button>
 </form>;
}
export type MasterRow = { id: string; name: string; active: boolean; machine_code?: string; location_code?: string; supplier_code?: string; email?: string | null };
export const masterCode = (row: MasterRow) => row.machine_code ?? row.location_code ?? row.supplier_code ?? '';
export function SupplierForm({ action, suppliers, item }: { action: string; suppliers: MasterRow[]; item?: { supplier_id: string; supplier_model: string | null; unit_price: string; order_multiple: number; lead_time_days: number; preferred: boolean } }) {
 return <form method="post" action={action} className="grid gap-3 sm:grid-cols-2">
  <label className="grid gap-1">仕入先<select name="supplier_id" required defaultValue={item?.supplier_id ?? ''} className={inputClass}>
   <option value="" disabled>選択してください</option>{suppliers.filter(s => s.active && (!item || s.id === item.supplier_id)).map(s => <option key={s.id} value={s.id}>{masterCode(s)} / {s.name}</option>)}
  </select></label>
  <Field label="発注先型番（任意）" name="supplier_model" maxLength={100} defaultValue={item?.supplier_model ?? ''} />
  <Field label="単価（円）" name="unit_price" required inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" maxLength={15} defaultValue={item?.unit_price ?? '0.00'} />
  <NumberField label="発注単位" name="order_multiple" min={1} defaultValue={item?.order_multiple ?? 1} />
  <NumberField label="納期（日）" name="lead_time_days" defaultValue={item?.lead_time_days ?? 0} />
  <label className="grid gap-1">優先仕入先<select name="preferred" defaultValue={String(item?.preferred ?? false)} className={inputClass}><option value="false">優先しない</option><option value="true">優先する</option></select></label>
  <button className={buttonClass + ' sm:col-span-2'}>{item ? '購買条件を保存する' : '購買条件を登録する'}</button>
 </form>;
}
