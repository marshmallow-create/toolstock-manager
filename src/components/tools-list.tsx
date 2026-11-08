import Link from 'next/link';
import { ToolStockTable } from './tool-stock-table';
import { CategoryField } from './tool-option-fields';
import { AuthError } from '@/lib/auth/service';
import { masters, pageToken } from '@/lib/masters/server';
import { Messages, panelClass, queryText, type Search } from '@/components/masters';
const searchInputClass = 'w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm';
export async function ToolsList({ search }: { search: Search }) {
 let result: Awaited<ReturnType<ReturnType<typeof masters>['listTools']>> = { tools: [], total: 0, page: 1, pageSize: 50 }, error = '';
 try { result = await masters().listTools(await pageToken(), { q: search.q, tool_code: search.tool_code, name: search.name, category: search.category, page: search.page }); }
 catch (e) { if (e instanceof AuthError && e.status === 400) error = e.message; else throw e; }
 const pageLink = (page: number) => { const q = new URLSearchParams(); for (const key of ['q', 'tool_code', 'name', 'category']) if (queryText(search[key])) q.set(key, queryText(search[key])); q.set('page', String(page)); return '/dashboard?' + q.toString(); };
 return <>
  <Messages search={search} />{error && <p role="alert" className="mb-4 text-red-800">{error}</p>}
  <form method="get" action="/dashboard" className="ui-panel mb-3 grid gap-3 rounded-xl bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
   <label className="grid gap-1 text-sm">品目コード<input name="tool_code" maxLength={100} defaultValue={queryText(search.tool_code)} className={searchInputClass} /></label>
   <label className="grid gap-1 text-sm">品目名<input name="name" maxLength={100} defaultValue={queryText(search.name)} className={searchInputClass} /></label>
   <CategoryField value={queryText(search.category)} />
   <button className="ui-button w-fit justify-self-start self-end">検索する</button>
  </form>
  <p className="mb-2 text-right text-sm">{result.total}件 / {result.page}ページ（1ページ50件）</p>
  {result.tools.length ? <ToolStockTable tools={result.tools} /> : <p className={panelClass}>該当する工具はありません。</p>}
  <nav aria-label="ページ切り替え" className="mt-3 flex gap-4 text-sm">{result.page > 1 && <Link href={pageLink(result.page - 1)} className="underline">前のページ</Link>}{result.page * 50 < result.total && <Link href={pageLink(result.page + 1)} className="underline">次のページ</Link>}{result.page > 1 && !result.tools.length && <Link href={pageLink(1)} className="underline">先頭ページへ</Link>}</nav>
 </>;
}
