import Link from 'next/link';
import { pageUser } from '@/lib/auth/server';
import { AuthError } from '@/lib/auth/service';
import { can } from '@/lib/auth/permissions';
import { pageToken } from '@/lib/masters/server';
import { inventory } from '@/lib/inventory/server';
import { Messages, queryText, type Search } from '@/components/masters';
import { WorkspaceShell } from '@/components/workspace-shell';
import { HistoryTable } from '@/components/inventory';
import { CategoryField } from '@/components/tool-option-fields';
const inputClass = 'w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm';
export default async function History({ searchParams }: { searchParams: Promise<Search> }) {
 const actor = await pageUser('history:own'), search = await searchParams, token = await pageToken(), service = inventory();
 const options = await service.historyOptions(token), priceVisible = can(actor.role, 'masters:write');
 let result: Awaited<ReturnType<typeof service.listHistory>> = { items: [], total: 0, page: 1, pageSize: 50 }, error = '';
 try { result = await service.listHistory(token, search); } catch (e) { if (e instanceof AuthError && [400, 403].includes(e.status)) error = e.message; else throw e; }
 const pageLink = (page: number) => { const q = new URLSearchParams(); for (const key of ['from', 'to', 'tool_id', 'tool_code', 'category', 'actor_user_id', 'type', 'movement', 'unit_price_min', 'unit_price_max']) if (queryText(search[key])) q.set(key, queryText(search[key])); q.set('page', String(page)); return '/history?' + q; };
 return <WorkspaceShell title="入出庫履歴" user={actor} page="history"><section>
  <Messages search={search} />
  {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  <form method="get" action="/history" className="ui-panel mb-3 grid gap-3 rounded-xl bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
   <label className="grid gap-1 text-sm">品目コード<input name="tool_code" maxLength={100} defaultValue={queryText(search.tool_code) || options.tools.find(tool => tool.id === queryText(search.tool_id))?.tool_code || ''} className={inputClass} /></label>
   <CategoryField value={queryText(search.category)} />
   <label className="grid gap-1 text-sm">入出庫履歴<select name="movement" defaultValue={queryText(search.movement)} className={inputClass}><option value="">すべて</option><option value="RECEIVE">入庫</option><option value="ISSUE">出庫</option></select></label>
   <label className="grid gap-1 text-sm">操作者<select name="actor_user_id" defaultValue={queryText(search.actor_user_id)} className={inputClass}><option value="">すべて</option>{options.actors.map(user => <option key={user.id} value={user.id}>{user.employee_code} / {user.name}{!user.active && '（無効）'}</option>)}</select></label>
   <label className="grid gap-1 text-sm">開始日（日本時間）<input type="date" name="from" defaultValue={queryText(search.from)} className={inputClass} /></label>
   <label className="grid gap-1 text-sm">終了日（日本時間）<input type="date" name="to" defaultValue={queryText(search.to)} className={inputClass} /></label>
   {priceVisible && <>
    <label className="grid gap-1 text-sm">単価の下限（円）<input name="unit_price_min" type="number" min="0" max="999999999999.99" step="0.01" inputMode="decimal" defaultValue={queryText(search.unit_price_min)} className={inputClass} /></label>
    <label className="grid gap-1 text-sm">単価の上限（円）<input name="unit_price_max" type="number" min="0" max="999999999999.99" step="0.01" inputMode="decimal" defaultValue={queryText(search.unit_price_max)} className={inputClass} /></label>
   </>}
   <div className="flex items-end gap-4"><button className="ui-button">検索する</button><Link href="/history" className="py-2 text-sm underline">条件をクリア</Link></div>
  </form>
  <p className="mb-2 text-right text-sm">{result.total}件 / {result.page}ページ（1ページ50件）</p><HistoryTable items={result.items} canReverse={can(actor.role, 'inventory:reverse')} returnTo={pageLink(result.page)} />
  <nav aria-label="履歴のページ切り替え" className="mt-3 flex gap-4 text-sm">{result.page > 1 && <Link href={pageLink(result.page - 1)} className="underline">前のページ</Link>}{result.page * result.pageSize < result.total && <Link href={pageLink(result.page + 1)} className="underline">次のページ</Link>}{result.page > 1 && !result.items.length && <Link href={pageLink(1)} className="underline">先頭ページへ</Link>}</nav>
 </section></WorkspaceShell>;
}
