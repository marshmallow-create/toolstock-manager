import {randomUUID} from 'node:crypto';
import {OrderForm} from '@/components/order-form';
import {can} from '@/lib/auth/permissions';
import Link from 'next/link';
import {WorkspaceShell} from '@/components/workspace-shell';
import {inventoryTime} from '@/components/inventory';
import {Messages,panelClass,type Search} from '@/components/masters';
import {auth,pageUser} from '@/lib/auth/server';
import {AuthError} from '@/lib/auth/service';
import {pageToken} from '@/lib/masters/server';
import {getDb} from '@/lib/db';
import {listOrders} from '@/lib/orders/list';
import {categoryLabel} from '@/lib/tool-options';
import {formatPrice} from '@/lib/format-price';

export default async function Orders({searchParams}:{searchParams:Promise<Search>}){
 const actor=await pageUser('inventory:read');
 let result:Awaited<ReturnType<typeof listOrders>>={items:[],total:0,page:1,pageSize:50},error='';
 try{result=await listOrders(getDb(),auth(),await pageToken(),await searchParams);}
 catch(e){if(e instanceof AuthError&&e.status===400)error=e.message;else throw e;}
 const headers=['日時','品目コード','品目名','カテゴリー','発注数','操作者','単価','部門','発注'];
 return <WorkspaceShell title="発注リスト" user={actor} page="orders">
  <Messages search={await searchParams}/><p className="mb-3 text-sm text-slate-600">外部で発注した数量を登録します。仕入先への送信は行いません。発注済みの入庫・取消は工具詳細から行えます。</p>
  {error&&<p role="alert" className="mb-3 rounded bg-red-50 p-3 text-red-800">{error}</p>}
  <p className="mb-2 text-right">{result.total}件 / {result.page}ページ（1ページ50件）</p>
  {result.items.length?<div className="data-table overflow-x-auto rounded-xl bg-white"><table className="w-full whitespace-nowrap text-left text-sm leading-tight [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
   <caption className="sr-only">出庫時に発注ラインと発注済みの合計を在庫が下回った工具</caption>
   <thead><tr>{headers.map(label=><th key={label} scope="col" className="border-b">{label}</th>)}</tr></thead>
   <tbody>{result.items.map(item=><tr key={item.id} className="hover:bg-slate-50">
    <td className="border-b">{inventoryTime(item.created_at)}</td>
    <td className="border-b"><Link className="font-bold underline" href={'/tools/'+item.tool.id}>{item.tool.tool_code}</Link></td>
    <td className="border-b"><Link className="underline" href={'/tools/'+item.tool.id}>{item.tool.name}</Link></td>
    <td className="border-b">{categoryLabel(item.tool.category)}</td>
    <td className="border-b tabular-nums">{item.quantity.toLocaleString('ja-JP')} {item.tool.order_unit}（{(item.quantity*item.tool.units_per_order).toLocaleString('ja-JP')} {item.tool.unit}）</td>
    <td className="border-b">{item.actor.name}</td>
    <td className="border-b tabular-nums">{item.unit_price==null?'—':'¥'+formatPrice(item.unit_price)}</td>
    <td className="border-b">{item.tool.department||'—'}</td>
    <td className="border-b">{can(actor.role,'orders:manage')&&<OrderForm entryId={item.id} tool={item.tool} quantity={item.quantity} requestKey={randomUUID()}/>}</td>
   </tr>)}</tbody>
  </table></div>:<p className={panelClass}>発注リストに該当する工具はありません。</p>}
  <nav aria-label="発注リストのページ切り替え" className="mt-3 flex gap-4">
   {result.page>1&&<Link href={'/orders?page='+(result.page-1)} className="underline">前のページ</Link>}
   {result.page*result.pageSize<result.total&&<Link href={'/orders?page='+(result.page+1)} className="underline">次のページ</Link>}
   {result.page>1&&!result.items.length&&<Link href="/orders" className="underline">先頭へ戻る</Link>}
  </nav>
 </WorkspaceShell>;
}
