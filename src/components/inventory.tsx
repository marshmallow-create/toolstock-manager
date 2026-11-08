import Link from 'next/link';
import { categoryLabel } from '@/lib/tool-options';
import { randomUUID } from 'node:crypto';
import { panelClass, inputClass } from './masters';

export const transactionLabels: Record<string, string> = { ISSUE: '出庫', RECEIVE: '入庫', ADJUSTMENT: '在庫調整（旧履歴）', REVERSAL: '取消（逆取引）', RETURN: '返品' };
export const inventoryTime = (value: Date | string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
type HistoryRow = { id: string; type: string; quantity: number; created_at: Date | string; reversal_id: string | null; on_hand_after: number | null; unit_price?: string | null; tool: { id: string; tool_code: string; name: string; category: string; unit: string; active: boolean }; actor: { name: string; active: boolean } };
export const historyColumns = ['日時', '品目コード', '品目名', 'カテゴリー', '入出庫履歴', '数量', '操作者', '在庫数', '単価'];
export function HistoryTable({ items, canReverse = false }: { items: HistoryRow[]; canReverse?: boolean }) {
 return items.length ? <div className="data-table overflow-x-auto rounded-xl bg-white"><table className="w-full whitespace-nowrap text-left text-sm leading-tight [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
  <caption className="sr-only">左から日時・品目コード・品目名・カテゴリー・入出庫履歴・数量・操作者・在庫数・単価。数量は取引時の数、在庫数は取引直後の値。</caption>
  <thead><tr>{historyColumns.map(label => <th key={label} scope="col" className="border-b">{label}</th>)}</tr></thead><tbody>{items.map(item => <tr key={item.id} className="hover:bg-slate-50">
   <td className="border-b">{inventoryTime(item.created_at)}</td>
   <td className="border-b"><Link href={'/tools/' + item.tool.id} className="font-bold underline">{item.tool.tool_code}</Link></td>
   <td className="border-b"><Link href={'/tools/' + item.tool.id} className="underline">{item.tool.name}</Link>{!item.tool.active && '（無効）'}</td>
   <td className="border-b">{categoryLabel(item.tool.category)}</td>
   <td className="border-b"><span title={(transactionLabels[item.type] ?? item.type) + (item.reversal_id ? '（取消済み）' : '')}>{item.quantity > 0 ? '入庫' : '出庫'}</span>
    {canReverse && ['ISSUE', 'RECEIVE', 'ADJUSTMENT'].includes(item.type) && !item.reversal_id && <details className="ml-2 inline-block align-top whitespace-normal text-xs"><summary className="ui-link cursor-pointer underline">取消</summary>
     <form method="post" action="/api/inventory/reverse" className="mt-2 grid w-64 gap-2 rounded border bg-slate-50 p-3">
      <input type="hidden" name="request_key" value={randomUUID()} /><input type="hidden" name="transaction_id" value={item.id} />
      <p>元の記録を残して全量を取り消します。</p>
      <label className="grid gap-1">取消理由<textarea name="reason" required maxLength={500} rows={2} className={inputClass} /></label>
      <button className="ui-button w-fit">この入出庫を取り消す</button>
     </form>
    </details>}
   </td>
   <td className="border-b tabular-nums">{Math.abs(item.quantity).toLocaleString('ja-JP')} {item.tool.unit}</td>
   <td className="border-b">{item.actor.name}{!item.actor.active && '（無効）'}</td>
   <td className="border-b tabular-nums">{item.on_hand_after?.toLocaleString('ja-JP') ?? '—'}</td>
   <td className="border-b tabular-nums">{item.unit_price == null ? '—' : '¥' + Number(item.unit_price).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
  </tr>)}</tbody>
 </table></div> : <p className={panelClass}>該当する履歴はありません。</p>;
}
