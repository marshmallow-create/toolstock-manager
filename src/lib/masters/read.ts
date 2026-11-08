import type { PrismaClient, Prisma } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { can } from '../auth/permissions';
import { kind, text, integer, uuid, categoryValue, type Input } from './validation';
import { categoryAliases } from '../tool-options';

export async function listTools(db: PrismaClient, auth: AuthService, token: string | undefined, input: Input = {}) {
 const actor = await auth.authenticate(token, 'inventory:read');
 const showPrice = can(actor.role, 'masters:write') || can(actor.role, 'orders:read');
 const q = text(input.q ?? '', '検索語', 100, true), category = categoryValue(input.category, true);
 const toolCode = text(input.tool_code ?? '', '品目コード', 100, true), name = text(input.name ?? '', '品目名', 100, true);
 const status = input.status ?? 'active';
 if (!['active', 'inactive', 'all'].includes(status as string)) throw new AuthError(400, '状態を確認してください');
 const page = input.page === undefined ? 1 : integer(input.page, 'ページ', 1, Number.MAX_SAFE_INTEGER);
 const where: Prisma.ToolWhereInput = { ...(status === 'all' ? {} : { active: status === 'active' }), ...(category ? { category: { in: categoryAliases(category), mode: 'insensitive' } } : {}), ...(toolCode ? { tool_code: { contains: toolCode, mode: 'insensitive' } } : {}), ...(name ? { name: { contains: name, mode: 'insensitive' } } : {}), ...(q ? { OR: ['tool_code', 'name'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}) };
 const total = await db.tool.count({ where });
 const rows = page > Math.ceil(total / 50) ? [] : await db.tool.findMany({ where, orderBy: { tool_code: 'asc' }, skip: (page - 1) * 50, take: 50, include: {
  stock_balances_tool_id_children: { select: { on_hand: true, reserved: true } },
  inventory_policies_tool_id_children: { select: { reorder_point: true } },
  purchase_order_items_tool_id_children: { where: { order_id_record: { status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] } } }, select: { ordered_quantity: true, received_quantity: true } },
  reorder_candidates_tool_id_children: { where: { status: 'OPEN' }, select: { quantity: true } },
  supplier_items_tool_id_children: { where: { preferred: true, supplier_id_record: { active: true }, ...(showPrice ? {} : { id: { in: [] } }) }, select: { unit_price: true }, take: 1 },
 } });
 const tools = rows.map(({ stock_balances_tool_id_children: stocks, inventory_policies_tool_id_children: policy, purchase_order_items_tool_id_children: orders, reorder_candidates_tool_id_children: candidates, supplier_items_tool_id_children: prices, unit_price: basePrice, ...tool }) => {
  const on_hand = stocks.reduce((sum, stock) => sum + stock.on_hand, 0), reserved = stocks.reduce((sum, stock) => sum + stock.reserved, 0);
  return { ...tool, on_hand, reserved, available: on_hand - reserved,
   shelf_codes: tool.shelf_code ? [tool.shelf_code] : [],
   reorder_point: policy?.reorder_point ?? null,
   on_order: orders.reduce((sum, order) => sum + Math.max(0, order.ordered_quantity - order.received_quantity), 0),
   order_quantity: candidates.reduce((sum, candidate) => sum + candidate.quantity, 0),
   unit_price: showPrice ? (basePrice ?? prices[0]?.unit_price)?.toFixed(2) ?? null : null,
  };
 });
 return { tools, total, page, pageSize: 50 };
}

export async function toolDetail(db: PrismaClient, auth: AuthService, token: string | undefined, id: string) {
 const actor = await auth.authenticate(token, 'inventory:read');
 const tool = await db.tool.findUnique({ where: { id: uuid(id) }, include: {
  inventory_policies_tool_id_children: true,
  stock_balances_tool_id_children: { include: { location_id_record: true }, orderBy: { location_id_record: { location_code: 'asc' } } },
  purchase_order_items_tool_id_children: { where: { order_id_record: { status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] } } }, select: { ordered_quantity: true, received_quantity: true } },
  reorder_candidates_tool_id_children: { where: { status: 'OPEN' }, select: { quantity: true } },
 } });
 if (!tool) throw new AuthError(404, '工具が見つかりません');
 const { inventory_policies_tool_id_children: policy, stock_balances_tool_id_children: balances, purchase_order_items_tool_id_children: orders, reorder_candidates_tool_id_children: candidates, unit_price: basePrice, ...basic } = tool;
 const stocks = balances.map(({ location_id_record: location, ...balance }) => ({ ...balance, location, available: balance.on_hand - balance.reserved }));
 const showPrice = can(actor.role, 'masters:write') || can(actor.role, 'orders:read');
 const legacyPrice = showPrice && basePrice === null ? await db.supplierItem.findFirst({
  where: { tool_id: tool.id, preferred: true, supplier_id_record: { active: true } },
  select: { unit_price: true },
 }) : null;
 return { ...basic, policy, stocks,
  on_hand: stocks.reduce((sum, stock) => sum + stock.on_hand, 0),
  on_order: orders.reduce((sum, order) => sum + Math.max(0, order.ordered_quantity - order.received_quantity), 0),
  order_quantity: candidates.reduce((sum, candidate) => sum + candidate.quantity, 0),
  ...(showPrice ? { unit_price: (basePrice ?? legacyPrice?.unit_price)?.toFixed(2) ?? null } : {}) };
}

export async function listMasters(db: PrismaClient, auth: AuthService, token: string | undefined, value: string) {
 await auth.authenticate(token, 'inventory:read');
 kind(value);
 return db.location.findMany({ orderBy: { location_code: 'asc' } });
}
