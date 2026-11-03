import Link from 'next/link';
import { pageUser } from '@/lib/auth/server';
import { AuthError } from '@/lib/auth/service';
import { can } from '@/lib/auth/permissions';
import { masters, pageToken } from '@/lib/masters/server';
import { Shell, Messages, inputClass, buttonClass, panelClass, queryText, type Search } from '@/components/masters';
export default async function Tools({ searchParams }: { searchParams: Promise<Search> }) {
 const actor = await pageUser('inventory:read'), search = await searchParams;
 let result: Awaited<ReturnType<ReturnType<typeof masters>['listTools']>> = { tools: [], total: 0, page: 1, pageSize: 50 }, error = '';
 try { result = await masters().listTools(await pageToken(), search); }
 catch (e) { if (e instanceof AuthError && e.status === 400) error = e.message; else throw e; }
 const pageLink = (page: number) => { const q = new URLSearchParams(); for (const key of ['q', 'category', 'status']) if (queryText(search[key])) q.set(key, queryText(search[key])); q.set('page', String(page)); return '/tools?' + q.toString(); };
 return <Shell title="工具一覧">
  <Messages search={search} />{error && <p role="alert" className="mb-4 text-red-800">{error}</p>}
  {can(actor.role, 'masters:write') && <div className="mb-5 flex flex-wrap gap-4"><Link href="/tools/new" className={buttonClass}>工具を登録</Link><Link href="/admin/masters" className="rounded border bg-white px-5 py-3">設備・保管場所・仕入先の管理</Link></div>}
  <form method="get" action="/tools" className={'mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ' + panelClass}>
   <label className="grid gap-1">工具番号・工具名・型番<input name="q" maxLength={100} defaultValue={queryText(search.q)} className={inputClass} /></label>
   <label className="grid gap-1">分類<input name="category" maxLength={64} defaultValue={queryText(search.category)} className={inputClass} /></label>
   <label className="grid gap-1">状態<select name="status" defaultValue={queryText(search.status) || 'active'} className={inputClass}><option value="active">有効</option><option value="inactive">無効</option><option value="all">すべて</option></select></label>
   <button className={buttonClass + ' self-end'}>検索する</button>
  </form>
  <p className="mb-3">{result.total}件 / {result.page}ページ（1ページ50件）</p>
  {result.tools.length ? <div className="overflow-x-auto rounded-xl bg-white"><table className="w-full whitespace-nowrap text-left"><caption className="sr-only">工具と保管場所を合計した在庫</caption><thead><tr>{['工具番号 / 名称', '分類 / 型番', '実在庫', '引当', '出庫可能', '状態'].map(h => <th key={h} className="border-b p-4">{h}</th>)}</tr></thead><tbody>{result.tools.map(tool => <tr key={tool.id}>
   <td className="border-b p-4"><Link href={'/tools/' + tool.id} className="font-bold underline">{tool.tool_code} / {tool.name}</Link></td><td className="border-b p-4">{tool.category}<br />{tool.model || '—'}</td><td className="border-b p-4">{tool.on_hand} {tool.unit}</td><td className="border-b p-4">{tool.reserved}</td><td className="border-b p-4">{tool.available} {tool.unit}</td><td className="border-b p-4">{tool.active ? '有効' : '無効'}</td>
  </tr>)}</tbody></table></div> : <p className={panelClass}>該当する工具はありません。</p>}
  <nav aria-label="ページ切り替え" className="mt-5 flex gap-5">{result.page > 1 && <Link href={pageLink(result.page - 1)} className="underline">前のページ</Link>}{result.page * 50 < result.total && <Link href={pageLink(result.page + 1)} className="underline">次のページ</Link>}{result.page > 1 && !result.tools.length && <Link href={pageLink(1)} className="underline">先頭ページへ</Link>}</nav>
 </Shell>;
}
