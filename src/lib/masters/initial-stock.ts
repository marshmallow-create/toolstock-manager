import type { PrismaClient } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { uuid, integer, type Input } from './validation';
import { audit, conflict } from './write';
type InitialResult = { stock_balance_id: string; tool_id: string; location_id: string; quantity: number };

export async function registerInitialStock(db: PrismaClient, auth: AuthService, token: string | undefined, toolId: string, input: Input): Promise<InitialResult> {
 await auth.authenticate(token, 'masters:write');
 toolId = uuid(toolId);
 const locationId = uuid(input.location_id), quantity = integer(input.quantity, '初期在庫'), key = 'phase3-initial:' + uuid(input.request_key);
 return conflict(() => auth.authorized(token, ['masters:write', 'inventory:receive'], async (tx, actor) => {
  await tx.$executeRaw`LOCK TABLE stock_balances IN SHARE ROW EXCLUSIVE MODE`;
  const previous = await tx.auditLog.findFirst({ where: { action: 'INITIAL_STOCK_REGISTERED', entity_id: key } });
  if (previous) {
   const detail = previous.details as unknown as InitialResult;
   if (previous.actor_user_id !== actor.id || detail.tool_id !== toolId || detail.location_id !== locationId || detail.quantity !== quantity) throw new AuthError(409, '同じリクエストキーを別の登録へ使うことはできません');
   return detail;
  }
  const tool = await tx.tool.findUnique({ where: { id: toolId } }), location = await tx.location.findUnique({ where: { id: locationId } });
  if (!tool || !location) throw new AuthError(404, '工具・保管場所が見つかりません');
  if (!tool.active || !location.active) throw new AuthError(409, '有効な工具・保管場所を選択してください');
  if (await tx.stockBalance.findUnique({ where: { tool_id_location_id: { tool_id: toolId, location_id: locationId } } })) throw new AuthError(409, 'この保管場所の初期在庫は登録済みです');
  const stock = await tx.stockBalance.create({ data: { tool_id: toolId, location_id: locationId, on_hand: quantity, reserved: 0 } });
  if (quantity > 0) await tx.inventoryTransaction.create({ data: { tool_id: toolId, location_id: locationId, actor_user_id: actor.id, type: 'RECEIVE', quantity, on_hand_after: quantity, unit_price: tool.unit_price, idempotency_key: key, reason: '初期在庫登録' } });
  const result = { stock_balance_id: stock.id, tool_id: toolId, location_id: locationId, quantity };
  await audit(tx, actor.id, 'INITIAL_STOCK_REGISTERED', 'stock_balances', key, result);
  return result;
 }));
}
