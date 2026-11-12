import type { PrismaClient, Prisma } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { can } from '../auth/permissions';
import { text, integer, uuid, categoryValue, type Input } from './validation';
import { categoryAliases } from '../tool-options';
import { inventoryCost } from '../inventory/cost';

function toolWhere(input: Input): Prisma.ToolWhereInput {
 const q = text(input.q ?? '', '検索語', 100, true), category = categoryValue(input.category, true);
 const toolCode = text(input.tool_code ?? '', '品目コード', 100, true), name = text(input.name ?? '', '品目名', 100, true);
 const status = input.status ?? 'active';
 if (!['active', 'inactive', 'all'].includes(status as string)) throw new AuthError(400, '状態を確認してください');
 const where: Prisma.ToolWhereInput = { ...(status === 'all' ? {} : { active: status === 'active' }), ...(category ? { category: { in: categoryAliases(category), mode: 'insensitive' } } : {}), ...(toolCode ? { tool_code: { contains: toolCode, mode: 'insensitive' } } : {}), ...(name ? { name: { contains: name, mode: 'insensitive' } } : {}), ...(q ? { OR: ['tool_code', 'name'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}) };
 return where;
}

export async function exportTools(db: PrismaClient, auth: AuthService, token: string | undefined, input: Input = {}) {
 const actor = await auth.authenticate(token, 'tools:export');
 const rows = await db.tool.findMany({where:toolWhere({...input,status:'active'}),orderBy:{tool_code:'asc'},select:{
  tool_code:true,name:true,category:true,unit_price:true,department:true,shelf_code:true,unit:true,order_unit:true,units_per_order:true,
  stock_balances_tool_id_children:{select:{on_hand:true}},
  inventory_policies_tool_id_children:{select:{reorder_point:true}},
  reorder_candidates_tool_id_children:{where:{status:'OPEN'},select:{quantity:true}},
 }});
 return rows.map(({stock_balances_tool_id_children:stocks,inventory_policies_tool_id_children:policy,reorder_candidates_tool_id_children:candidates,unit_price,...tool})=>({
  ...tool,on_hand:stocks.reduce((sum,stock)=>sum+stock.on_hand,0),reorder_point:policy?.reorder_point??0,
  order_quantity:candidates.reduce((sum,candidate)=>sum+candidate.quantity,0),
  unit_price:can(actor.role,'prices:read')?unit_price?.toFixed(2)??null:null,
 }));
}

export async function listTools(db: PrismaClient, auth: AuthService, token: string | undefined, input: Input = {}) {
 const actor = await auth.authenticate(token, 'inventory:read');
 const showPrice = can(actor.role, 'prices:read');
 const where = toolWhere(input);
 const page = input.page === undefined ? 1 : integer(input.page, 'ページ', 1, Number.MAX_SAFE_INTEGER);
 const total = await db.tool.count({ where });
 const rows = page > Math.ceil(total / 50) ? [] : await db.tool.findMany({ where, orderBy: { tool_code: 'asc' }, skip: (page - 1) * 50, take: 50, include: {
  stock_balances_tool_id_children: { select: { on_hand: true, reserved: true } },
  tool_orders:{select:{stock_quantity:true,received_quantity:true,cancelled_quantity:true}},
  inventory_policies_tool_id_children: { select: { reorder_point: true } },
  purchase_order_items_tool_id_children: { where: { order_id_record: { status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] } } }, select: { ordered_quantity: true, received_quantity: true } },
  reorder_candidates_tool_id_children: { where: { status: 'OPEN' }, select: { quantity: true } },
 } });
 const tools = rows.map(({ tool_orders:newOrders, stock_balances_tool_id_children: stocks, inventory_policies_tool_id_children: policy, purchase_order_items_tool_id_children: orders, reorder_candidates_tool_id_children: candidates, unit_price: basePrice, ...tool }) => {
  const on_hand = stocks.reduce((sum, stock) => sum + stock.on_hand, 0), reserved = stocks.reduce((sum, stock) => sum + stock.reserved, 0);
  return { ...tool, on_hand, reserved, available: on_hand - reserved,
   shelf_codes: tool.shelf_code ? [tool.shelf_code] : [],
   reorder_point: policy?.reorder_point ?? null,
   on_order:newOrders.reduce((sum,item)=>sum+item.stock_quantity-item.received_quantity-item.cancelled_quantity,0)+orders.reduce((sum, order) => sum + Math.max(0, order.ordered_quantity - order.received_quantity), 0),
   order_quantity: candidates.reduce((sum, candidate) => sum + candidate.quantity, 0),
   unit_price: showPrice ? basePrice?.toFixed(2) ?? null : null,
   stock_unit_price:showPrice?inventoryCost(basePrice,tool.units_per_order,1).unit_price?.toFixed(8)??null:null,
  };
 });
 return { tools, total, page, pageSize: 50 };
}

export async function toolDetail(db: PrismaClient, auth: AuthService, token: string | undefined, id: string) {
 const actor = await auth.authenticate(token, 'inventory:read');
 const tool = await db.tool.findUnique({ where: { id: uuid(id) }, include: {
  inventory_policies_tool_id_children: true,
  tool_orders:{orderBy:{created_at:'asc'}},
  stock_balances_tool_id_children: { include: { location_id_record: true }, orderBy: { location_id_record: { location_code: 'asc' } } },
  purchase_order_items_tool_id_children: { where: { order_id_record: { status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] } } }, select: { ordered_quantity: true, received_quantity: true } },
  reorder_candidates_tool_id_children: { where: { status: 'OPEN' }, select: { quantity: true } },
 } });
 if (!tool) throw new AuthError(404, '工具が見つかりません');
 const { tool_orders:newOrders, inventory_policies_tool_id_children: policy, stock_balances_tool_id_children: balances, purchase_order_items_tool_id_children: orders, reorder_candidates_tool_id_children: candidates, unit_price: basePrice, ...basic } = tool;
 const stocks = balances.map(({ location_id_record: location, ...balance }) => ({ ...balance, location, available: balance.on_hand - balance.reserved }));
 const showPrice = can(actor.role, 'prices:read');
 return { ...basic, policy, stocks, orders:newOrders.filter(item=>item.stock_quantity>item.received_quantity+item.cancelled_quantity).map(item=>({...item,purchase_unit_price:can(actor.role,'prices:read')?item.purchase_unit_price?.toFixed(2)??null:null})),
  on_hand: stocks.reduce((sum, stock) => sum + stock.on_hand, 0),
  on_order:newOrders.reduce((sum,item)=>sum+item.stock_quantity-item.received_quantity-item.cancelled_quantity,0)+orders.reduce((sum, order) => sum + Math.max(0, order.ordered_quantity - order.received_quantity), 0),
  order_quantity: candidates.reduce((sum, candidate) => sum + candidate.quantity, 0),
  ...(showPrice ? { unit_price: basePrice?.toFixed(2) ?? null, stock_unit_price:inventoryCost(basePrice,basic.units_per_order,1).unit_price?.toFixed(8)??null } : {}) };
}
