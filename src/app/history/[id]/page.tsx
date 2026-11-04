import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { pageUser } from '@/lib/auth/server';
import { can } from '@/lib/auth/permissions';
import { pageHistoryDetail } from '@/lib/inventory/server';
import { Shell, Messages, inputClass, buttonClass, panelClass, type Search } from '@/components/masters';
import { transactionLabels, inventoryTime } from '@/components/inventory';
export default async function HistoryDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
 const actor = await pageUser('history:own'), { id } = await params, transaction = await pageHistoryDetail(id), confirmation = transaction.confirmation;
 const reversible = ['ISSUE', 'RECEIVE', 'ADJUSTMENT'].includes(transaction.type) && !transaction.reversal_id;
 return <Shell title="入出庫履歴の詳細"><Messages search={await searchParams} />
  <section className={'mb-6 ' + panelClass}><h2 className="mb-5 text-xl font-bold">{transactionLabels[transaction.type] ?? transaction.type} / {inventoryTime(transaction.created_at)}（日本時間）</h2>
   <dl className="grid gap-4 sm:grid-cols-2">
    <div><dt className="text-sm">工具</dt><dd><Link href={'/tools/' + transaction.tool.id} className="underline">{transaction.tool.tool_code} / {transaction.tool.name}</Link>{!transaction.tool.active && '（無効）'}</dd></div>
    <div><dt className="text-sm">保管場所</dt><dd>{transaction.location.location_code} / {transaction.location.name}{!transaction.location.active && '（無効）'}</dd></div>
    <div><dt className="text-sm">数量</dt><dd className="text-xl font-bold">{transaction.quantity > 0 ? '+' : ''}{transaction.quantity} {transaction.tool.unit}</dd></div>
    <div><dt className="text-sm">操作者</dt><dd>{transaction.actor.employee_code} / {transaction.actor.name}{!transaction.actor.active && '（無効）'}</dd></div>
    <div><dt className="text-sm">設備</dt><dd>{transaction.machine ? transaction.machine.machine_code + ' / ' + transaction.machine.name : '—'}{transaction.machine && !transaction.machine.active && '（無効）'}</dd></div>
    <div><dt className="text-sm">理由</dt><dd className="whitespace-pre-wrap break-words">{transaction.reason || '—'}</dd></div>
   </dl>
   {transaction.reverses_id && <p className="mt-5">元の取引：<Link className="underline" href={'/history/' + transaction.reverses_id}>取消対象の履歴を確認</Link></p>}
   {transaction.reversal_id && <p className="mt-5">取消済み：<Link className="underline" href={'/history/' + transaction.reversal_id}>逆取引と取消理由を確認</Link></p>}
  </section>
  {confirmation && <section className={'mb-6 ' + panelClass}><h2 className="mb-3 text-xl font-bold">確定時の記録</h2><p>{transaction.type === 'ISSUE' ? '出庫前' : '変更前'} {confirmation.on_hand_before} {transaction.tool.unit} → {transaction.type === 'ISSUE' ? '出庫後' : '変更後'} {confirmation.on_hand_after} {transaction.tool.unit} / 引当 {confirmation.reserved}</p><p className="mt-3 text-sm">この値は確定時の記録です。現在の在庫は工具詳細で確認できます。</p></section>}
  {can(actor.role, 'inventory:adjust') && reversible && <section className={'mb-6 ' + panelClass}><h2 className="mb-3 text-xl font-bold">理由を付けて取り消す（逆取引）</h2><p className="mb-5">元の記録を残したまま、数量 {transaction.quantity > 0 ? '-' : '+'}{Math.abs(transaction.quantity)} {transaction.tool.unit} を同じ棚へ反映します。正しい工具・設備・数量は取消後に新しい取引として登録してください。</p>
   <form method="post" action="/api/inventory/reverse" className="grid gap-4"><input type="hidden" name="request_key" value={randomUUID()} /><input type="hidden" name="transaction_id" value={transaction.id} /><label className="grid gap-1">取消理由（必須・500文字以内）<textarea name="reason" required maxLength={500} rows={3} className={inputClass} /></label><button className={buttonClass}>全量を取り消す（逆取引を確定）</button></form>
  </section>}
  <div className="flex flex-wrap gap-5"><Link href="/history" className="underline">履歴一覧へ</Link><Link href={'/history?' + new URLSearchParams({ tool_id: transaction.tool.id })} className="underline">この工具の履歴</Link><Link href={'/tools/' + transaction.tool.id} className="underline">最新の在庫へ</Link></div>
 </Shell>;
}
