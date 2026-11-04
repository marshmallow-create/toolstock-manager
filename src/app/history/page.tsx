import Link from 'next/link';
import { pageUser } from '@/lib/auth/server';
import { AuthError } from '@/lib/auth/service';
import { can } from '@/lib/auth/permissions';
import { pageToken } from '@/lib/masters/server';
import { inventory } from '@/lib/inventory/server';
import { Shell, Messages, Field, inputClass, buttonClass, panelClass, queryText, type Search } from '@/components/masters';
import { HistoryTable, transactionLabels } from '@/components/inventory';
export default async function History({ searchParams }: { searchParams: Promise<Search> }) {
 const actor = await pageUser('history:own'), search = await searchParams, token = await pageToken(), service = inventory();
 const options = await service.historyOptions(token);
 let result: Awaited<ReturnType<typeof service.listHistory>> = { items: [], total: 0, page: 1, pageSize: 50 }, error = '';
 try { result = await service.listHistory(token, search); } catch (e) { if (e instanceof AuthError && [400, 403].includes(e.status)) error = e.message; else throw e; }
 const pageLink = (page: number) => { const q = new URLSearchParams(); for (const key of ['from', 'to', 'tool_id', 'machine_id', 'actor_user_id', 'type']) if (queryText(search[key])) q.set(key, queryText(search[key])); q.set('page', String(page)); return '/history?' + q; };
 return <Shell title="入出庫履歴"><Messages search={search} />
  {!can(actor.role, 'history:all') && <p className="mb-5">本人の出庫と、その出庫を取り消した履歴を表示します。</p>}
  {error && <p role="alert" className="mb-5 rounded bg-red-50 p-4 text-red-800">{error}</p>}
  <form method="get" action="/history" className={'mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ' + panelClass}>
   <Field label="開始日（日本時間）" type="date" name="from" defaultValue={queryText(search.from)} /><Field label="終了日（日本時間）" type="date" name="to" defaultValue={queryText(search.to)} />
   <label className="grid gap-1">工具<select name="tool_id" defaultValue={queryText(search.tool_id)} className={inputClass}><option value="">すべて</option>{options.tools.map(tool => <option key={tool.id} value={tool.id}>{tool.tool_code} / {tool.name}{!tool.active && '（無効）'}</option>)}</select></label>
   <label className="grid gap-1">設備<select name="machine_id" defaultValue={queryText(search.machine_id)} className={inputClass}><option value="">すべて</option>{options.machines.map(machine => <option key={machine.id} value={machine.id}>{machine.machine_code} / {machine.name}{!machine.active && '（無効）'}</option>)}</select></label>
   {can(actor.role, 'history:all') && <label className="grid gap-1">操作者<select name="actor_user_id" defaultValue={queryText(search.actor_user_id)} className={inputClass}><option value="">すべて</option>{options.actors.map(user => <option key={user.id} value={user.id}>{user.employee_code} / {user.name}{!user.active && '（無効）'}</option>)}</select></label>}
   <label className="grid gap-1">取引種別<select name="type" defaultValue={queryText(search.type)} className={inputClass}><option value="">すべて</option>{Object.entries(transactionLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label>
   <button className={buttonClass}>検索する</button><Link href="/history" className="self-center underline">条件をクリア</Link>
  </form>
  <p className="mb-3">{result.total}件 / {result.page}ページ（1ページ50件）</p><HistoryTable items={result.items} />
  <nav aria-label="履歴のページ切り替え" className="mt-5 flex gap-5">{result.page > 1 && <Link href={pageLink(result.page - 1)} className="underline">前のページ</Link>}{result.page * result.pageSize < result.total && <Link href={pageLink(result.page + 1)} className="underline">次のページ</Link>}{result.page > 1 && !result.items.length && <Link href={pageLink(1)} className="underline">先頭ページへ</Link>}</nav>
 </Shell>;
}
