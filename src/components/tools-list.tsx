import Link from 'next/link';
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
  <form method="get" action="/dashboard" className="mb-3 grid gap-3 rounded-xl bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
   <label className="grid gap-1 text-sm">品目コード<input name="tool_code" maxLength={100} defaultValue={queryText(search.tool_code)} className={searchInputClass} /></label>
   <label className="grid gap-1 text-sm">品目名<input name="name" maxLength={100} defaultValue={queryText(search.name)} className={searchInputClass} /></label>
   <label className="grid gap-1 text-sm">カテゴリー<input name="category" maxLength={64} defaultValue={queryText(search.category)} className={searchInputClass} /></label>
   <button className="self-end rounded bg-blue-900 px-4 py-2 text-sm text-white">検索する</button>
  </form>
  <p className="mb-2 text-right text-sm">{result.total}件 / {result.page}ページ（1ページ50件）</p>
  {result.tools.length ? <div className="overflow-x-auto rounded-xl bg-white"><table className="w-full whitespace-nowrap text-left text-sm leading-tight [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2"><caption className="sr-only">工具の在庫・発注情報と棚番。発注済みは未入荷数、発注数は未処理の発注候補数、単価は工具に登録した価格。</caption><thead><tr>{['品目コード', '品目名', 'カテゴリー', '在庫', '発注済み', '発注ライン', '発注数', '単価', '部門', '棚番'].map(h => <th key={h} scope="col" className="border-b p-4">{h}</th>)}</tr></thead><tbody>{result.tools.map(tool => <tr key={tool.id} className="hover:bg-slate-50">
   <td className="border-b p-4"><Link href={'/tools/' + tool.id} className="font-bold underline">{tool.tool_code}</Link></td>
   <td className="border-b p-4"><Link href={'/tools/' + tool.id} className="underline">{tool.name}</Link></td>
   <td className="border-b p-4">{tool.category || '—'}</td>
   <td className="border-b p-4 tabular-nums">{tool.on_hand.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums" title="発注済みの未入荷数">{tool.on_order.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums">{tool.reorder_point?.toLocaleString('ja-JP') ?? '—'}</td>
   <td className="border-b p-4 tabular-nums" title="未処理の発注候補数">{tool.order_quantity.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums" title="工具の単価">{tool.unit_price === null ? '—' : '¥' + Number(tool.unit_price).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
   <td className="border-b p-4">{tool.department || '—'}</td>
   <td className="border-b p-4">{tool.shelf_code || '—'}</td>
  </tr>)}</tbody></table></div> : <p className={panelClass}>該当する工具はありません。</p>}
  <nav aria-label="ページ切り替え" className="mt-3 flex gap-4 text-sm">{result.page > 1 && <Link href={pageLink(result.page - 1)} className="underline">前のページ</Link>}{result.page * 50 < result.total && <Link href={pageLink(result.page + 1)} className="underline">次のページ</Link>}{result.page > 1 && !result.tools.length && <Link href={pageLink(1)} className="underline">先頭ページへ</Link>}</nav>
 </>;
}
