import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AuthService } from '../auth/service';
import { can } from '../auth/permissions';
import { integer, type Input } from '../masters/validation';

const entrySelect = {
 id: true,
 tool_id_record: { select: { id: true, tool_code: true, name: true, category: true, department: true, unit_price: true, unit:true, order_unit:true, units_per_order:true } },
 trigger_transaction_id_record: { select: {
  created_at: true,
  actor_user_id_record: { select: { name: true, employee_code: true } },
 } },
} as const satisfies Prisma.OrderListEntrySelect;

export async function listOrders(db: PrismaClient, auth: AuthService, token: string | undefined, query: Input = {}) {
 const actor = await auth.authenticate(token, 'inventory:read');
 const page = query.page === undefined || query.page === '' ? 1 : integer(query.page, 'ページ', 1, Number.MAX_SAFE_INTEGER);
 const total = await db.orderListEntry.count();
 const rows = page > Math.ceil(total / 50) ? [] : await db.orderListEntry.findMany({
  select: entrySelect,
  orderBy: [{ trigger_transaction_id_record: { created_at: 'desc' } }, { trigger_transaction_id: 'desc' }],
  take: 50, skip: (page - 1) * 50,
 });
 const quantities = rows.length ? await db.reorderCandidate.groupBy({
  by: ['tool_id'], where: { tool_id: { in: rows.map(row => row.tool_id_record.id) }, status: 'OPEN' }, _sum: { quantity: true },
 }) : [];
 const quantityByTool = new Map(quantities.map(row => [row.tool_id, row._sum.quantity ?? 0]));
 const items = rows.map(row => {
  const { unit_price, ...tool } = row.tool_id_record;
  return {
   id: row.id, tool, quantity: quantityByTool.get(tool.id) ?? 0,
   created_at: row.trigger_transaction_id_record.created_at,
   actor: row.trigger_transaction_id_record.actor_user_id_record,
   ...(can(actor.role, 'prices:read') ? { unit_price: unit_price?.toFixed(2) ?? null } : {}),
  };
 });
 return { items, total, page, pageSize: 50 };
}
