import { WorkspaceShell } from '@/components/workspace-shell';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { pageUser } from '@/lib/auth/server';
import { can } from '@/lib/auth/permissions';
import { masters, pageTool, pageToken } from '@/lib/masters/server';
import { inventory } from '@/lib/inventory/server';
import { HistoryTable, inventoryTime } from '@/components/inventory';
import { InventoryForm } from '@/components/inventory-form';
import { Messages, panelClass, type Search } from '@/components/masters';
import { ToolStockTable } from '@/components/tool-stock-table';
export default async function ToolDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
 const actor = await pageUser('inventory:read'), { id } = await params, tool = await pageTool(id), editable = can(actor.role, 'tools:update');
 const token = await pageToken(), search = await searchParams;
 const activeStocks = tool.stocks.filter(stock => stock.location.active);
 const stock = activeStocks.find(stock => stock.location.location_code === '@tool/' + tool.id)
  ?? activeStocks.find(stock => stock.location.location_code === tool.shelf_code)
  ?? (activeStocks.length === 1 ? activeStocks[0] : undefined);
 const recent = (await inventory().listHistory(token, { tool_id: id })).items.slice(0, 5);
 const changes = await masters().toolChangeHistory(token, id);
 return <WorkspaceShell user={actor} title={tool.tool_code + ' / ' + tool.name}>
  <Messages search={search} />
  <section aria-label="入出庫" className="mb-3 grid max-w-3xl items-start gap-3 sm:grid-cols-2">
   {(['receive', 'issue'] as const).filter(mode => can(actor.role, 'inventory:' + mode)).map(mode => {
    const label = mode === 'receive' ? '入庫' : '出庫';
    return <section key={mode} id={'inventory-' + mode} aria-labelledby={'inventory-title-' + mode} className={'min-w-0 ' + panelClass}>
     <h2 id={'inventory-title-' + mode} className="mb-2 text-xl font-bold">{label}</h2>
     <div>{!tool.active ? <p>無効な工具には登録できません。</p> : !stock ? <p>入出庫する棚を特定できません。工具情報の棚番と在庫を確認してください。</p> :
      <InventoryForm key={tool.id + mode} mode={mode} tool={{ id: tool.id, unit: tool.unit }} stock={{ location_id: stock.location_id, on_hand: stock.on_hand, reserved: stock.reserved }} requestKey={randomUUID()} />
     }</div>
    </section>;
   })}
  </section>
  <section aria-labelledby="tool-information" className={'mb-3 ' + panelClass}>
   <h2 id="tool-information" className="mb-3 text-xl font-bold">工具情報</h2>
   <ToolStockTable tools={[{ ...tool, reorder_point: tool.policy?.reorder_point ?? null }]} />
   {editable && <Link href={'/tools/' + tool.id + '/edit'} className="mt-3 inline-block underline">工具情報変更</Link>}
  </section>
  <section aria-labelledby="tool-change-history" className={'mb-3 ' + panelClass}>
   <h2 id="tool-change-history" className="mb-3 text-xl font-bold">工具情報変更履歴（最大3件）</h2>
   {changes.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2">
    <thead><tr>{['変更日時', '変更内容', '操作者'].map(label => <th key={label} scope="col" className="whitespace-nowrap border-b">{label}</th>)}</tr></thead>
    <tbody>{changes.map(change => <tr key={change.id} className="align-top hover:bg-slate-50">
     <td className="whitespace-nowrap border-b">{inventoryTime(change.created_at)}</td>
     <td className="min-w-56 border-b break-words"><ul className="space-y-1">{change.changes.map((content, index) => <li key={index}>{content}</li>)}</ul></td>
     <td className="whitespace-nowrap border-b">{change.actor.name}<span className="ml-2 text-slate-500">{change.actor.employee_code}</span></td>
    </tr>)}</tbody>
   </table></div> : <p className="text-slate-500">工具の変更履歴はありません。</p>}
  </section>
  <section className="mb-3"><h2 className="mb-3 text-xl font-bold">直近の履歴（最大5件）</h2><HistoryTable items={recent} /></section>
  <nav aria-label="入出庫履歴" className="mt-3 text-sm"><Link href="/history" className="underline">入出庫履歴へ</Link></nav>

 </WorkspaceShell>;
}
