import Link from 'next/link';
import { categoryLabel } from '@/lib/tool-options';
import { formatPrice } from '@/lib/format-price';
import { needsReorder } from '@/lib/inventory/reorder-point';

type ToolStockRow = {
 id: string; tool_code: string; name: string; category: string;
 on_hand: number; on_order: number; reorder_point: number | null; order_quantity: number;
 units_per_order?:number;stock_unit_price?:string|null;unit_price?: string | null; department: string; shelf_code: string;
};

export function ToolStockTable({ tools }: { tools: ToolStockRow[] }) {
 return <div className="data-table overflow-x-auto rounded-xl bg-white"><table className="w-full whitespace-nowrap text-left text-sm leading-tight [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
  <caption className="sr-only">工具の在庫・発注情報と棚番。発注済みは未入荷数、発注数は未処理の発注候補数、発注単価は工具に登録した価格。</caption>
  <thead><tr>{['品目コード', '品目名', 'カテゴリー', '在庫', '発注済み', '発注ライン', '発注数', '発注単価', '部門', '棚番'].map((h,index) => <th key={h} scope="col" className={'border-b p-4'+(index>=3&&index<=7?' numeric':'')+(index===3?' tool-stock-heading':index===4?' tool-pending-heading':'')}>{h}</th>)}</tr></thead>
  <tbody>{tools.map(tool => <tr key={tool.id} className="hover:bg-slate-50" data-needs-order={needsReorder(tool.on_hand,tool.on_order,tool.reorder_point??0)}>
   <td className="border-b p-4"><Link href={'/tools/' + tool.id} className="font-bold underline">{tool.tool_code}</Link></td>
   <td className="border-b p-4"><Link href={'/tools/' + tool.id} className="underline">{tool.name}</Link></td>
   <td className="border-b p-4">{categoryLabel(tool.category)}</td>
   <td className={'border-b p-4 tabular-nums tool-stock'+(tool.on_hand===0?' tool-stock--zero':needsReorder(tool.on_hand,tool.on_order,tool.reorder_point??0)?' tool-stock--low':'')}>{tool.on_hand.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums tool-pending" title="発注済みの未入荷数">{tool.on_order.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums text-slate-500">{tool.reorder_point?.toLocaleString('ja-JP') ?? '—'}</td>
   <td className="border-b p-4 tabular-nums" title="未処理の発注候補数">{tool.order_quantity.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums font-semibold">{tool.unit_price == null ? '—' : '¥' + formatPrice(tool.unit_price)}</td>
   <td className="border-b p-4 text-slate-600">{tool.department || '—'}</td>
   <td className="border-b p-4 text-slate-600">{tool.shelf_code || '—'}</td>
  </tr>)}</tbody>
 </table></div>;
}
