import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { pageUser } from '@/lib/auth/server';
import { can } from '@/lib/auth/permissions';
import { masters, pageTool, pageToken } from '@/lib/masters/server';
import { Shell, Messages, SupplierForm, NumberField, inputClass, buttonClass, panelClass, masterCode, type Search } from '@/components/masters';
export default async function ToolDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
 const actor = await pageUser('inventory:read'), { id } = await params, tool = await pageTool(id), editable = can(actor.role, 'masters:write');
 const token = await pageToken(), service = masters();
 const locations = editable ? await service.listMasters(token, 'locations') : [];
 const suppliers = editable ? await service.listMasters(token, 'suppliers') : [];
 const unregistered = locations.filter(location => location.active && !tool.stocks.some(stock => stock.location_id === location.id));
 const availableSuppliers = suppliers.filter(supplier => supplier.active && !tool.supplier_items?.some(item => item.supplier_id === supplier.id));
 return <Shell title={tool.tool_code + ' / ' + tool.name}>
  <Messages search={await searchParams} />
  <section className={'mb-6 ' + panelClass}>
   <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-sm">分類 / メーカー / 型番</dt><dd>{tool.category} / {tool.manufacturer || '—'} / {tool.model || '—'}</dd></div><div><dt className="text-sm">数量単位 / 状態</dt><dd>{tool.unit} / {tool.active ? '有効' : '無効'}</dd></div></dl>
   <p className="mt-4">在庫方針（工具全体）：安全在庫 {tool.policy?.safety_stock ?? '未設定'} / 発注点 {tool.policy?.reorder_point ?? '未設定'} / 目標在庫 {tool.policy?.target_stock ?? '未設定'}</p>
   {editable && <Link href={'/tools/' + tool.id + '/edit'} className="mt-5 inline-block underline">工具・在庫方針を編集する</Link>}
  </section>
  <section className={'mb-6 ' + panelClass}><h2 className="mb-4 text-xl font-bold">保管場所別在庫</h2>
   {tool.stocks.length ? <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left"><thead><tr>{['保管場所', '実在庫', '引当', '出庫可能', '更新日時（日本時間）'].map(h => <th key={h} className="border-b p-3">{h}</th>)}</tr></thead><tbody>{tool.stocks.map(stock => <tr key={stock.id}>
    <td className="border-b p-3">{stock.location.location_code} / {stock.location.name}{!stock.location.active && '（無効）'}</td><td className="border-b p-3">{stock.on_hand} {tool.unit}</td><td className="border-b p-3">{stock.reserved}</td><td className="border-b p-3">{stock.available} {tool.unit}</td><td className="border-b p-3">{new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }).format(stock.updated_at)}</td>
   </tr>)}</tbody></table></div> : <p>保管場所別在庫は未登録です。</p>}
  </section>
  {editable && can(actor.role, 'inventory:receive') && <section className={'mb-6 ' + panelClass}><h2 className="mb-3 text-xl font-bold">初期在庫登録</h2><p className="mb-4 text-sm">未登録の保管場所へ一度だけ登録できます。0も登録済みになります。</p>
   {tool.active && unregistered.length ? <form action={'/api/tools/' + tool.id + '/initial-stock'} method="post" className="grid gap-4 sm:grid-cols-2">
    <input type="hidden" name="request_key" value={randomUUID()} />
    <label className="grid gap-1">保管場所<select name="location_id" required className={inputClass} defaultValue=""><option value="" disabled>選択してください</option>{unregistered.map(location => <option key={location.id} value={location.id}>{masterCode(location)} / {location.name}</option>)}</select></label>
    <NumberField label={'初期数量（' + tool.unit + '）'} name="quantity" defaultValue={0} />
    <button className={buttonClass + ' sm:col-span-2'}>初期在庫を登録する</button>
   </form> : <p>{tool.active ? '登録可能な保管場所がありません。' : '無効な工具には登録できません。'} <Link href="/admin/masters" className="underline">保管場所の管理へ</Link></p>}
  </section>}
  {tool.supplier_items && <section className={'mb-6 ' + panelClass}><h2 className="mb-4 text-xl font-bold">購買条件</h2>
   {!tool.supplier_items.length && <p className="mb-4">購買条件は未登録です。</p>}
   <div className="grid gap-5">{tool.supplier_items.map(item => <article key={item.id} className="rounded border p-4"><h3 className="mb-3 font-bold">{item.supplier.supplier_code} / {item.supplier.name}{!item.supplier.active && '（無効）'}</h3>
    {editable && tool.active && item.supplier.active ? <SupplierForm action={'/api/tools/' + tool.id + '/supplier-items/' + item.id} suppliers={suppliers} item={item} /> : <p>単価 {item.unit_price} 円 / 発注単位 {item.order_multiple} / 納期 {item.lead_time_days}日 / 発注先型番 {item.supplier_model || '—'} / {item.preferred ? '優先仕入先' : '優先なし'}</p>}
   </article>)}</div>
   {editable && tool.active && <div className="mt-6 border-t pt-5"><h3 className="mb-4 font-bold">購買条件を追加</h3>{availableSuppliers.length ? <SupplierForm action={'/api/tools/' + tool.id + '/supplier-items'} suppliers={availableSuppliers} /> : <p>追加できる有効な仕入先がありません。<Link href="/admin/masters" className="underline">仕入先の管理へ</Link></p>}</div>}
  </section>}
 </Shell>;
}
