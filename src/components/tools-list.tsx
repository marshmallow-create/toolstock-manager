import Link from 'next/link';
import { ToolStockTable } from './tool-stock-table';
import { CategoryField } from './tool-option-fields';
import { AuthError } from '@/lib/auth/service';
import { masters, pageToken } from '@/lib/masters/server';
import { Messages, inputClass, queryText, type Search } from '@/components/masters';
export async function ToolsList({ search, canExport = false }: { search: Search; canExport?: boolean }) {
 let result: Awaited<ReturnType<ReturnType<typeof masters>['listTools']>> = { tools: [], total: 0, page: 1, pageSize: 50 }, error = '';
 try { result = await masters().listTools(await pageToken(), { q: search.q, tool_code: search.tool_code, name: search.name, category: search.category, page: search.page }); }
 catch (e) { if (e instanceof AuthError && e.status === 400) error = e.message; else throw e; }
 const pageLink = (page: number) => { const q = new URLSearchParams(); for (const key of ['q', 'tool_code', 'name', 'category']) if (queryText(search[key])) q.set(key, queryText(search[key])); q.set('page', String(page)); return '/dashboard?' + q.toString(); };
 const exportQuery = new URLSearchParams();
 for (const key of ['q', 'tool_code', 'name', 'category']) if (queryText(search[key])) exportQuery.set(key, queryText(search[key]));
 const exportHref = '/api/tools/export' + (exportQuery.size ? '?' + exportQuery.toString() : '');
 return <>
  <Messages search={search} />{error && <p role="alert" className="mb-4 text-red-800">{error}</p>}
  <section aria-labelledby="tools-heading" className="tool-directory">
  <div className="directory-header">
   <h2 id="tools-heading" className="flex items-center gap-3 text-xl font-bold">
    <span className="section-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M4 10h16M10 10v9"/></svg></span>工具一覧
   </h2>
   {canExport && !error && <a href={exportHref} className="ui-secondary">
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4"><path d="M12 3v12m-4-4 4 4 4-4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>Excelダウンロード
   </a>}
  </div>
  <form method="get" action="/dashboard" className="directory-filters grid items-end gap-3 min-[360px]:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
   <label className="grid gap-1 text-sm">品目コード<input name="tool_code" maxLength={100} defaultValue={queryText(search.tool_code)} className={inputClass} /></label>
   <label className="grid gap-1 text-sm">品目名<input name="name" maxLength={100} defaultValue={queryText(search.name)} className={inputClass} /></label>
   <CategoryField value={queryText(search.category)} />
   <button className="ui-button"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/></svg>検索する</button>
  </form>
  <div className="directory-results">
   <p className="flex flex-wrap items-baseline gap-x-2"><strong className="text-lg tabular-nums">{result.total.toLocaleString('ja-JP')}件</strong><span className="text-xs text-slate-600">{result.page}ページ（1ページ50件）</span></p>
   {canExport && <p className="text-xs text-slate-500">検索結果全件を一括変更用の形式で出力します。200件を超える場合は、200件ずつのExcelをZIPにまとめます。</p>}
  </div>
  {result.tools.length ? <ToolStockTable tools={result.tools} /> : <p className="directory-empty">該当する工具はありません。</p>}
  </section>
  <nav aria-label="ページ切り替え" className="mt-3 flex gap-4 text-sm">{result.page > 1 && <Link href={pageLink(result.page - 1)} className="underline">前のページ</Link>}{result.page * 50 < result.total && <Link href={pageLink(result.page + 1)} className="underline">次のページ</Link>}{result.page > 1 && !result.tools.length && <Link href={pageLink(1)} className="underline">先頭ページへ</Link>}</nav>
 </>;
}
