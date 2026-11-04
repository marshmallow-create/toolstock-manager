import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { pageUser } from '@/lib/auth/server';
import { AuthError } from '@/lib/auth/service';
import { masters, pageToken, pageTool } from '@/lib/masters/server';
import { Shell, Messages, inputClass, buttonClass, panelClass, queryText, masterCode, type Search } from './masters';
import { InventoryForm } from './inventory-form';

export const transactionLabels: Record<string, string> = { ISSUE: '出庫', RECEIVE: '入庫', ADJUSTMENT: '棚卸調整', REVERSAL: '取消（逆取引）', RETURN: '返品' };
export const inventoryTime = (value: Date | string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
type HistoryRow = { id: string; type: string; quantity: number; created_at: Date | string; reversal_id: string | null; tool: { tool_code: string; name: string; unit: string; active: boolean }; location: { name: string; active: boolean }; actor: { name: string; active: boolean }; machine: { name: string; active: boolean } | null };
export function HistoryTable({ items }: { items: HistoryRow[] }) {
 return items.length ? <div className="overflow-x-auto rounded-xl bg-white"><table className="w-full whitespace-nowrap text-left"><thead><tr>{['日時（日本時間） / 種別', '工具', '保管場所 / 設備', '数量', '操作者'].map(label => <th key={label} className="border-b p-3">{label}</th>)}</tr></thead><tbody>{items.map(item => <tr key={item.id}>
  <td className="border-b p-3"><Link href={'/history/' + item.id} className="underline">{inventoryTime(item.created_at)}<br />{transactionLabels[item.type] ?? item.type}{item.reversal_id && '（取消済み）'}</Link></td>
  <td className="border-b p-3">{item.tool.tool_code} / {item.tool.name}{!item.tool.active && '（無効）'}</td><td className="border-b p-3">{item.location.name}{!item.location.active && '（無効）'}<br />{item.machine?.name ?? '—'}{item.machine && !item.machine.active && '（無効）'}</td>
  <td className="border-b p-3">{item.quantity > 0 ? '+' : ''}{item.quantity} {item.tool.unit}</td><td className="border-b p-3">{item.actor.name}{!item.actor.active && '（無効）'}</td>
 </tr>)}</tbody></table></div> : <p className={panelClass}>該当する履歴はありません。</p>;
}

export async function InventoryPage({ mode, search }: { mode: 'issue' | 'receive' | 'adjust'; search: Search }) {
 const permission = 'inventory:' + mode;
 await pageUser(permission);
 const token = await pageToken(), service = masters(), selectedId = queryText(search.tool_id);
 const tool = selectedId ? await pageTool(selectedId) : undefined;
 let result: Awaited<ReturnType<typeof service.listTools>> = { tools: [], total: 0, page: 1, pageSize: 50 }, error = '';
 try { result = await service.listTools(token, { q: queryText(search.q), page: queryText(search.page) || '1' }); }
 catch (e) { if (e instanceof AuthError && e.status === 400) error = e.message; else throw e; }
 const allLocations = tool ? await service.listMasters(token, 'locations') : [];
 const locations = allLocations.filter(location => location.active && (mode === 'receive' || tool?.stocks.some(stock => stock.location_id === location.id)));
 const machines = mode === 'issue' && tool ? (await service.listMasters(token, 'machines')).filter(machine => machine.active) : [];
 const titles = { issue: '手動出庫', receive: '理由付き手動入庫', adjust: '棚卸・実棚数の反映' }, path = '/inventory/' + mode;
 const pageLink = (page: number) => { const query = new URLSearchParams({ page: String(page) }); if (queryText(search.q)) query.set('q', queryText(search.q)); if (selectedId) query.set('tool_id', selectedId); return path + '?' + query; };
 return <Shell title={titles[mode]}><Messages search={search} />
  <p className="mb-5"><Link href="/history" className="underline">入出庫履歴</Link></p>
  {error && <p role="alert" className="mb-4 text-red-800">{error}</p>}
  <section className={'mb-6 ' + panelClass}><h2 className="mb-4 text-xl font-bold">工具を検索・選択</h2>
   <form method="get" action={path} className="flex flex-wrap items-end gap-3"><label className="grid grow gap-1">工具番号・工具名・型番<input name="q" defaultValue={queryText(search.q)} maxLength={100} className={inputClass} /></label><button className={buttonClass}>検索する</button></form>
   <p className="my-3 text-sm">{result.total}件 / {result.page}ページ（1ページ50件）</p>
   <ul className="grid gap-2 sm:grid-cols-2">{result.tools.map(item => <li key={item.id}><Link href={path + '?' + new URLSearchParams({ tool_id: item.id, ...(queryText(search.q) ? { q: queryText(search.q) } : {}) })} className="block rounded border p-3 underline">{item.tool_code} / {item.name}（出庫可能 {item.available} {item.unit}）</Link></li>)}</ul>
   {!result.tools.length && <p>該当する工具はありません。</p>}
   <nav aria-label="工具検索のページ切り替え" className="mt-4 flex gap-5">{result.page > 1 && <Link href={pageLink(result.page - 1)} className="underline">前のページ</Link>}{result.page * 50 < result.total && <Link href={pageLink(result.page + 1)} className="underline">次のページ</Link>}</nav>
  </section>
  {tool && <section className={panelClass}><h2 className="mb-2 text-xl font-bold">{tool.tool_code} / {tool.name}</h2><p className="mb-5"><Link href={'/tools/' + tool.id} className="underline">工具詳細・最新の在庫を確認</Link></p>
   {!tool.active ? <p>無効な工具には登録できません。</p> : !locations.length ? <p>選択できる有効な保管場所がありません。{mode !== 'receive' && '未登録の棚は、初期在庫登録または手動入庫から開始してください。'}</p> : <>
    {mode === 'receive' && <p className="mb-5 text-sm">発注書にひも付かない手動入庫です。補充した理由を記録してください。</p>}
    {mode === 'issue' && !machines.length && <p role="alert" className="mb-4 text-red-800">有効な設備がありません。在庫管理者に設備登録を依頼してください。</p>}
    <InventoryForm key={tool.id + mode} mode={mode} tool={{ id: tool.id, unit: tool.unit }} locations={locations.map(location => ({ id: location.id, location_code: masterCode(location), name: location.name }))} stocks={tool.stocks.map(stock => ({ location_id: stock.location_id, on_hand: stock.on_hand, reserved: stock.reserved }))} machines={machines.map(machine => ({ id: machine.id, machine_code: masterCode(machine), name: machine.name }))} requestKey={randomUUID()} />
   </>}
  </section>}
 </Shell>;
}
