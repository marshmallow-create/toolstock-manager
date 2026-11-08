import Link from 'next/link';
import { categoryLabel } from '@/lib/tool-options';

type ToolStockRow = {
 id: string; tool_code: string; name: string; category: string;
 on_hand: number; on_order: number; reorder_point: number | null; order_quantity: number;
 unit_price?: string | null; department: string; shelf_code: string;
};

export function ToolStockTable({ tools }: { tools: ToolStockRow[] }) {
 return <div className="data-table overflow-x-auto rounded-xl bg-white"><table className="w-full whitespace-nowrap text-left text-sm leading-tight [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
  <caption className="sr-only">工具の在庫・発注情報と棚番。発注済みは未入荷数、発注数は未処理の発注候補数、単価は工具に登録した価格。</caption>
  <thead><tr>{['品目コード', '品目名', 'カテゴリー', '在庫', '発注済み', '発注ライン', '発注数', '単価', '部門', '棚番'].map(h => <th key={h} scope="col" className="border-b p-4">{h}</th>)}</tr></thead>
  <tbody>{tools.map(tool => <tr key={tool.id} className="hover:bg-slate-50">
   <td className="border-b p-4"><Link href={'/tools/' + tool.id} className="font-bold underline">{tool.tool_code}</Link></td>
   <td className="border-b p-4"><Link href={'/tools/' + tool.id} className="underline">{tool.name}</Link></td>
   <td className="border-b p-4">{categoryLabel(tool.category)}</td>
   <td className="border-b p-4 tabular-nums">{tool.on_hand.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums" title="発注済みの未入荷数">{tool.on_order.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums">{tool.reorder_point?.toLocaleString('ja-JP') ?? '—'}</td>
   <td className="border-b p-4 tabular-nums" title="未処理の発注候補数">{tool.order_quantity.toLocaleString('ja-JP')}</td>
   <td className="border-b p-4 tabular-nums" title="工具の単価">{tool.unit_price == null ? '—' : '¥' + Number(tool.unit_price).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
   <td className="border-b p-4">{tool.department || '—'}</td>
   <td className="border-b p-4">{tool.shelf_code || '—'}</td>
  </tr>)}</tbody>
 </table></div>;
}
