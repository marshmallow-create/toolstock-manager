import { recordedUnitPrice } from '../inventory/snapshot';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { codeFields, kind, uuid, code, integer, toolData, policyData, masterData, unchangedCode, type Input } from './validation';

export async function audit(tx: Prisma.TransactionClient, actor: string, action: string, entity_type: string, entity_id: string, details: unknown) {
 // 日時・DecimalはJSON文字列に正規化する。呼び出し側で業務項目を限定する。
 await tx.auditLog.create({ data: { actor_user_id: actor, action, entity_type, entity_id, details: JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue } });
}
export async function conflict<T>(operation: () => Promise<T>) {
 try { return await operation(); }
 catch (error) {
  const code = (error as { code?: string }).code;
  if (code === 'P2002') throw new AuthError(409, 'コード・組み合わせは登録済みです');
  if (code === 'P2025') throw new AuthError(404, '対象が見つかりません');
  if (code === 'P2003') throw new AuthError(409, '参照先を確認してください');
  throw error;
 }
}
export async function createTool(db: PrismaClient, auth: AuthService, token: string | undefined, input: Input) {
 await auth.authenticate(token, 'masters:write');
 const data = { tool_code: code(input.tool_code), ...toolData(input, true) }, policy = policyData(input, true);
 const quantity = input.on_hand === undefined ? 0 : integer(input.on_hand, '在庫');
 const orderQuantity = input.order_quantity === undefined ? 0 : integer(input.order_quantity, '発注数');
 return conflict(() => auth.authorized(token, ['masters:write'], async (tx, actor) => {
  const tool = await tx.tool.create({ data });
  await tx.inventoryPolicy.create({ data: { tool_id: tool.id, ...policy } });
  if (orderQuantity > 0) {
   const candidate = await tx.reorderCandidate.create({ data: { tool_id: tool.id, status: 'OPEN', quantity: orderQuantity } });
   await audit(tx, actor.id, 'REORDER_CANDIDATE_CREATED', 'reorder_candidates', candidate.id, { after: candidate });
  }
  if (input.on_hand !== undefined || data.shelf_code) {
   // Internal ledger reference; the editable shelf label belongs to Tool.
   const location = await tx.location.create({ data: { location_code: '@tool/' + tool.id, name: '工具在庫' } });
   const stock = await tx.stockBalance.create({ data: { tool_id: tool.id, location_id: location.id, on_hand: quantity } });
   const key = 'tool-registration:' + tool.id;
   if (quantity > 0) await tx.inventoryTransaction.create({ data: { tool_id: tool.id, location_id: location.id, actor_user_id: actor.id, type: 'RECEIVE', quantity, on_hand_after: quantity, unit_price: await recordedUnitPrice(tx, tool), idempotency_key: key, reason: '工具登録時の初期在庫' } });
   await audit(tx, actor.id, 'INITIAL_STOCK_REGISTERED', 'stock_balances', key, { stock_balance_id: stock.id, tool_id: tool.id, location_id: location.id, quantity });
  }
  await audit(tx, actor.id, 'TOOL_CREATED', 'tools', tool.id, { after: data, policy });
  return tool;
 }));
}
export async function updateTool(db: PrismaClient, auth: AuthService, token: string | undefined, id: string, input: Input) {
 await auth.authenticate(token, 'masters:write');
 id = uuid(id); const policy = policyData(input, false);
 return conflict(() => auth.authorized(token, ['masters:write'], async (tx, actor) => {
  const before = await tx.tool.findUnique({ where: { id } });
  if (!before) throw new AuthError(404, '工具が見つかりません');
  const data = toolData(input, false, before.shelf_code);
  unchangedCode(input, 'tool_code', before.tool_code);
  if (data.unit !== before.unit && (await tx.stockBalance.count({ where: { tool_id: id } }) || await tx.inventoryTransaction.count({ where: { tool_id: id } }))) throw new AuthError(409, '在庫・履歴がある工具の単位は変更できません。別の工具として登録してください');
  const previousPolicy = await tx.inventoryPolicy.findUnique({ where: { tool_id: id } });
  const tool = await tx.tool.update({ where: { id }, data });
  await tx.inventoryPolicy.upsert({ where: { tool_id: id }, create: { tool_id: id, ...policy }, update: policy });
  await audit(tx, actor.id, 'TOOL_UPDATED', 'tools', id, { before, after: tool, previousPolicy, policy });
  return tool;
 }));
}
export async function createMaster(db: PrismaClient, auth: AuthService, token: string | undefined, value: string, input: Input) {
 await auth.authenticate(token, 'masters:write');
 const type = kind(value), normalized = code(input[codeFields[type]]), basic = masterData(input, true);
 return conflict(() => auth.authorized(token, ['masters:write'], async (tx, actor) => {
  const item = await tx.location.create({ data: { ...basic, location_code: normalized } });
  await audit(tx, actor.id, 'MASTER_CREATED', type, item.id, { after: item });
  return item;
 }));
}
export async function updateMaster(db: PrismaClient, auth: AuthService, token: string | undefined, value: string, id: string, input: Input) {
 await auth.authenticate(token, 'masters:write');
 const type = kind(value), data = masterData(input, false); id = uuid(id);
 return conflict(() => auth.authorized(token, ['masters:write'], async (tx, actor) => {
  const before = await tx.location.findUnique({ where: { id } });
  if (!before) throw new AuthError(404, '対象が見つかりません');
  unchangedCode(input, codeFields[type], (before as unknown as Record<string, string>)[codeFields[type]]);
  const item = await tx.location.update({ where: { id }, data });
  await audit(tx, actor.id, 'MASTER_UPDATED', type, id, { before, after: item });
  return item;
 }));
}
