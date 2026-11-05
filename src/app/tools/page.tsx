import Link from 'next/link';
import { pageUser } from '@/lib/auth/server';
import { AuthError } from '@/lib/auth/service';
import { can } from '@/lib/auth/permissions';
import { masters, pageToken } from '@/lib/masters/server';
import { Shell, Messages, inputClass, buttonClass, panelClass, queryText, type Search } from '@/components/masters';
export default async function Tools({ searchParams }: { searchParams: Promise<Search> }) {
 const actor = await pageUser('inventory:read'), search = await searchParams;
 let result: Awaited<ReturnType<ReturnType<typeof masters>['listTools']>> = { tools: [], total: 0, page: 1, pageSize: 50 }, error = '';
 try { result = await masters().listTools(await pageToken(), { q: search.q, tool_code: search.tool_code, name: search.name, page: search.page }); }
 catch (e) { if (e instanceof AuthError && e.status === 400) error = e.message; else throw e; }
 const pageLink = (page: number) => { const q = new URLSearchParams(); for (const key of ['q', 'tool_code', 'name']) if (queryText(search[key])) q.set(key, queryText(search[key])); q.set('page', String(page)); return '/tools?' + q.toString(); };
 return <Shell title="工具一覧" navigation={<Link href="/dashboard">マイページ</Link>}>
  <Messages search={search} />{error && <p role="alert" className="mb-4 text-red-800">{error}</p>}
  {can(actor.role, 'masters:write') && <div className="mb-5 flex flex-wrap gap-4"><Link href="/tools/new" className={buttonClass}>工具を登録</Link></div>}
  <form method="get" action="/tools" className={'mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] ' + panelClass}>
   <label className="grid gap-1">品目コード<input name="tool_code" maxLength={100} defaultValue={queryText(search.tool_code)} className={inputClass} /></label>
   <label className="grid gap-1">品目名<input name="name" maxLength={100} defaultValue={queryText(search.name)} className={inputClass} /></label>
   <button className={buttonClass + ' self-end'}>検索する</button>
  </form>
  <p className="mb-3">{result.total}件 / {result.page}ページ（1ページ50件）</p>
  {result.tools.length ? <div className="overflow-x-auto rounded-xl bg-white"><table className="w-full whitespace-nowrap text-left"><caption className="sr-only">工具の在庫・発注情報と棚番。発注済みは未入荷数、発注数は未処理の発注候補数、単価は優先仕入先の価格。</caption><thead><tr>{['品目コード', '品目名', '在庫', '発注済み', '発注ライン', '発注数', '単価', '部門', '棚番'].map(h => <th key={h} scope="col" className="border-b p-4">{h}</th>)}</tr></thead><tbody>{result.tools.map(tool => <tr key={tool.id} className="hover:bg-slate-50">
   <td className="border-b p-4"><Link href={'/tools/' + tool.id} className="font-bold underline">{tool.tool_code}</Link></td>
   <td className="border-b p-4"><Link href={'/tools/' + tool.id} className="underline">{tool.name}</Link></td>
   <td className="border-b p-4 tabular-nums">{tool.on_hand.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums" title="発注済みの未入荷数">{tool.on_order.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums">{tool.reorder_point?.toLocaleString('ja-JP') ?? '—'}</td>
   <td className="border-b p-4 tabular-nums" title="未処理の発注候補数">{tool.order_quantity.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums" title="優先仕入先の単価">{tool.unit_price === null ? '—' : '¥' + Number(tool.unit_price).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
   <td className="border-b p-4">{tool.department || '—'}</td>
   <td className="border-b p-4">{tool.shelf_codes.join(' / ') || '—'}</td>
  </tr>)}</tbody></table></div> : <p className={panelClass}>該当する工具はありません。</p>}
  <nav aria-label="ページ切り替え" className="mt-5 flex gap-5">{result.page > 1 && <Link href={pageLink(result.page - 1)} className="underline">前のページ</Link>}{result.page * 50 < result.total && <Link href={pageLink(result.page + 1)} className="underline">次のページ</Link>}{result.page > 1 && !result.tools.length && <Link href={pageLink(1)} className="underline">先頭ページへ</Link>}</nav>
 </Shell>;
}
