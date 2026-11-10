import type { PrismaClient } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { can } from '../auth/permissions';
import { categoryLabel } from '../tool-options';
import { uuid } from './validation';

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const display = (value: unknown) => value === undefined || value === null || value === '' ? '未設定' : String(value);
const comparablePrice = (value: unknown) => {
 const shown = display(value), parts = /^(\d+)(?:\.(\d+))?$/.exec(shown);
 return parts ? parts[1].replace(/^0+(?=\d)/, '') + '.' + (parts[2] ?? '').replace(/0+$/, '') : shown;
};

export async function toolChangeHistory(db: PrismaClient, auth: AuthService, token: string | undefined, toolId: string) {
 const actor = await auth.authenticate(token, 'inventory:read');
 const id = uuid(toolId);
 if (!await db.tool.findUnique({ where: { id }, select: { id: true } })) throw new AuthError(404, '工具が見つかりません');
 const logs = await db.auditLog.findMany({ where: { OR: [
  { entity_type: 'tools', entity_id: id, action: { in: ['TOOL_UPDATED', 'TOOL_ORDER_QUANTITY_UPDATED'] } },
  { entity_type: 'inventory_transactions', action: 'TOOL_STOCK_UPDATED', details: { path: ['transaction', 'tool_id'], equals: id } },
 ] }, select: { id: true, action: true, details: true, created_at: true, actor_user_id_record: { select: { employee_code: true, name: true } } }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
 const priceVisible = can(actor.role, 'masters:write');
 return logs.flatMap(log => {
  const detail = record(log.details), changes: string[] = [];
  if (log.action === 'TOOL_UPDATED') {
   const before = record(detail.before), after = record(detail.after);
   // Show changes to the tool-edit fields; full internal changes remain in the audit log.
   const fields = [['name', '品目名'], ['category', 'カテゴリー'], ['department', '部門'], ['shelf_code', '棚番'], ['active', '状態'], ['unit_price', '単価']];
   for (const [field, label] of fields) {
    const format = (value: unknown) => field === 'category' ? categoryLabel(String(value ?? '')) : field === 'active' ? value === true ? '有効' : '無効' : display(value);
    if (field === 'unit_price' ? comparablePrice(before[field]) === comparablePrice(after[field]) : format(before[field]) === format(after[field])) continue;
    changes.push(field === 'unit_price' && !priceVisible ? '単価を変更' : `${label}：${format(before[field])} → ${format(after[field])}`);
   }
   const previousPolicy = record(detail.previousPolicy), policy = record(detail.policy);
   for (const [field, label] of [['reorder_point', '発注ライン']]) {
    if (display(previousPolicy[field]) !== display(policy[field])) changes.push(`${label}：${display(previousPolicy[field])} → ${display(policy[field])}`);
   }
  } else if (log.action === 'TOOL_STOCK_UPDATED') {
   if (display(detail.before) !== display(detail.after)) changes.push(`在庫：${display(detail.before)} → ${display(detail.after)}`);
  } else {
   const before = Array.isArray(detail.before) ? detail.before.reduce((sum: number, candidate) => sum + Number(record(candidate).quantity ?? 0), 0) : 0;
   if (display(before) !== display(detail.after)) changes.push(`発注数：${before} → ${display(detail.after)}`);
  }
  return changes.length ? [{ id: log.id, created_at: log.created_at, changes, actor: log.actor_user_id_record }] : [];
 }).slice(0, 3);
}
