import type { PrismaClient, Prisma } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { can } from '../auth/permissions';
import { kind, text, integer, uuid, type Input } from './validation';

export async function listTools(db: PrismaClient, auth: AuthService, token: string | undefined, input: Input = {}) {
 await auth.authenticate(token, 'inventory:read');
 const q = text(input.q ?? '', '検索語', 100, true), category = text(input.category ?? '', '分類', 64, true);
 const status = input.status ?? 'active';
 if (!['active', 'inactive', 'all'].includes(status as string)) throw new AuthError(400, '状態を確認してください');
 const page = input.page === undefined ? 1 : integer(input.page, 'ページ', 1, Number.MAX_SAFE_INTEGER);
 const where: Prisma.ToolWhereInput = { ...(status === 'all' ? {} : { active: status === 'active' }), ...(category ? { category } : {}), ...(q ? { OR: ['tool_code', 'name', 'model'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}) };
 const total = await db.tool.count({ where });
 const rows = page > Math.ceil(total / 50) ? [] : await db.tool.findMany({ where, orderBy: { tool_code: 'asc' }, skip: (page - 1) * 50, take: 50, include: { stock_balances_tool_id_children: { select: { on_hand: true, reserved: true } } } });
 const tools = rows.map(({ stock_balances_tool_id_children: stocks, ...tool }) => {
  const on_hand = stocks.reduce((sum, stock) => sum + stock.on_hand, 0), reserved = stocks.reduce((sum, stock) => sum + stock.reserved, 0);
  return { ...tool, on_hand, reserved, available: on_hand - reserved };
 });
 return { tools, total, page, pageSize: 50 };
}

export async function toolDetail(db: PrismaClient, auth: AuthService, token: string | undefined, id: string) {
 const actor = await auth.authenticate(token, 'inventory:read');
 const tool = await db.tool.findUnique({ where: { id: uuid(id) }, include: {
  inventory_policies_tool_id_children: true,
  stock_balances_tool_id_children: { include: { location_id_record: true }, orderBy: { location_id_record: { location_code: 'asc' } } },
 } });
 if (!tool) throw new AuthError(404, '工具が見つかりません');
 const { inventory_policies_tool_id_children: policy, stock_balances_tool_id_children: balances, ...basic } = tool;
 const stocks = balances.map(({ location_id_record: location, ...balance }) => ({ ...balance, location, available: balance.on_hand - balance.reserved }));
 let supplier_items;
 if (can(actor.role, 'masters:write') || can(actor.role, 'orders:read')) {
  const conditions = await db.supplierItem.findMany({ where: { tool_id: tool.id }, include: { supplier_id_record: true }, orderBy: { supplier_id_record: { supplier_code: 'asc' } } });
  supplier_items = conditions.map(({ unit_price, supplier_id_record: supplier, ...condition }) => ({ ...condition, unit_price: unit_price.toFixed(2), supplier }));
 }
 return { ...basic, policy, stocks, ...(supplier_items ? { supplier_items } : {}) };
}

export async function listMasters(db: PrismaClient, auth: AuthService, token: string | undefined, value: string) {
 const actor = await auth.authenticate(token, 'inventory:read');
 const type = kind(value);
 if (type === 'suppliers' && !can(actor.role, 'masters:write') && !can(actor.role, 'orders:read')) throw new AuthError(403, 'この操作を行う権限がありません');
 if (type === 'machines') return db.machine.findMany({ orderBy: { machine_code: 'asc' } });
 if (type === 'locations') return db.location.findMany({ orderBy: { location_code: 'asc' } });
 return db.supplier.findMany({ orderBy: { supplier_code: 'asc' } });
}
