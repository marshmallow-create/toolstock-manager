import { WorkspaceShell } from '@/components/workspace-shell';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { pageUser } from '@/lib/auth/server';
import { can } from '@/lib/auth/permissions';
import { masters, pageTool, pageToken } from '@/lib/masters/server';
import { inventory } from '@/lib/inventory/server';
import { HistoryTable } from '@/components/inventory';
import { InventoryForm } from '@/components/inventory-form';
import { Messages, panelClass, queryText, type Search } from '@/components/masters';
export default async function ToolDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
 const actor = await pageUser('inventory:read'), { id } = await params, tool = await pageTool(id), editable = can(actor.role, 'masters:write');
 const token = await pageToken(), search = await searchParams;
 const allLocations = await masters().listMasters(token, 'locations');
 const automaticLocation = tool.stocks.find(stock => stock.location.location_code === '@tool/' + tool.id)?.location;
 const locationsFor = (mode: 'receive' | 'issue') => automaticLocation ? (automaticLocation.active ? [automaticLocation] : []) : allLocations.filter(location => location.active && !location.location_code.startsWith('@tool/') && (mode === 'receive' || tool.stocks.some(stock => stock.location_id === location.id)));
 const recent = (await inventory().listHistory(token, { tool_id: id })).items.slice(0, 5);
 return <WorkspaceShell user={actor} title={tool.tool_code + ' / ' + tool.name}>
  <Messages search={search} />
  <nav aria-label="在庫操作" className="mb-3 flex flex-wrap gap-3">
   <Link href={'/history?tool_id=' + tool.id} className="self-center underline">この工具の履歴</Link>
  </nav>
  <section className={'mb-3 ' + panelClass}>
   <dl className="mb-3"><dt className="text-sm">棚番</dt><dd>{tool.shelf_code || '—'}</dd></dl>
   <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-sm">分類 / メーカー / 型番</dt><dd>{tool.category} / {tool.manufacturer || '—'} / {tool.model || '—'}</dd></div><div><dt className="text-sm">数量単位 / 状態</dt><dd>{tool.unit} / {tool.active ? '有効' : '無効'}</dd></div></dl>
   <p className="mt-4">在庫方針（工具全体）：安全在庫 {tool.policy?.safety_stock ?? '未設定'} / 発注点 {tool.policy?.reorder_point ?? '未設定'} / 目標在庫 {tool.policy?.target_stock ?? '未設定'}</p>
   {editable && <Link href={'/tools/' + tool.id + '/edit'} className="mt-5 inline-block underline">工具・在庫方針を編集する</Link>}
  </section>
  <section className={'mb-3 ' + panelClass}><h2 className="mb-3 text-xl font-bold">保管場所別在庫</h2>
   {tool.stocks.length ? <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left"><thead><tr>{['保管場所', '実在庫', '引当', '出庫可能', '更新日時（日本時間）'].map(h => <th key={h} className="border-b p-3">{h}</th>)}</tr></thead><tbody>{tool.stocks.map(stock => <tr key={stock.id}>
    <td className="border-b p-3">{stock.location.location_code.startsWith('@tool/') ? tool.shelf_code || '—' : stock.location.location_code + ' / ' + stock.location.name}{!stock.location.active && '（無効）'}</td><td className="border-b p-3">{stock.on_hand} {tool.unit}</td><td className="border-b p-3">{stock.reserved}</td><td className="border-b p-3">{stock.available} {tool.unit}</td><td className="border-b p-3">{new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }).format(stock.updated_at)}</td>
   </tr>)}</tbody></table></div> : <p>保管場所別在庫は未登録です。</p>}
  </section>
  <section aria-label="入出庫" className="mb-3 space-y-4">
   {(['receive', 'issue'] as const).filter(mode => can(actor.role, 'inventory:' + mode)).map(mode => {
    const locations = locationsFor(mode), label = mode === 'receive' ? '入庫' : '出庫';
    return <details key={mode} id={'inventory-' + mode} name="inventory-operation" open={queryText(search.operation) === mode} className={panelClass}>
     <summary className="cursor-pointer rounded py-2 text-xl font-bold focus-visible:outline-2 focus-visible:outline-blue-700">{label}</summary>
     <div className="mt-5">{!tool.active ? <p>無効な工具には登録できません。</p> : !locations.length ? <p>選択できる有効な在庫の保管場所がありません。</p> :
      <InventoryForm key={tool.id + mode} mode={mode} tool={{ id: tool.id, unit: tool.unit, shelf_code: tool.shelf_code }} locations={locations.map(location => ({ id: location.id, location_code: location.location_code, name: location.name }))} stocks={tool.stocks.map(stock => ({ location_id: stock.location_id, on_hand: stock.on_hand, reserved: stock.reserved }))} requestKey={randomUUID()} />
     }</div>
    </details>;
   })}
  </section>
  <section className="mb-3"><h2 className="mb-3 text-xl font-bold">直近の履歴（最大5件）</h2><HistoryTable items={recent} /><Link href={'/history?tool_id=' + tool.id} className="mt-3 inline-block underline">履歴を検索する</Link></section>

 </WorkspaceShell>;
}
