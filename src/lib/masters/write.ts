import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { codeFields, kind, uuid, code, text, integer, toolData, policyData, masterData, email, conditionData, unchangedCode, type Input } from './validation';

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
 const shelfText = text(input.shelf_code, '棚番', 32, true), shelfCode = shelfText ? code(shelfText) : '';
 if (quantity > 0 && !shelfCode) throw new AuthError(400, '在庫を登録する場合は棚番を入力してください');
 return conflict(() => auth.authorized(token, ['masters:write'], async (tx, actor) => {
  const tool = await tx.tool.create({ data });
  await tx.inventoryPolicy.create({ data: { tool_id: tool.id, ...policy } });
  if (orderQuantity > 0) {
   const candidate = await tx.reorderCandidate.create({ data: { tool_id: tool.id, status: 'OPEN', quantity: orderQuantity } });
   await audit(tx, actor.id, 'REORDER_CANDIDATE_CREATED', 'reorder_candidates', candidate.id, { after: candidate });
  }
  if (shelfCode) {
   const existing = await tx.location.findUnique({ where: { location_code: shelfCode } });
   if (existing && !existing.active) throw new AuthError(409, '有効な棚番を入力してください');
   const location = existing ?? await tx.location.create({ data: { location_code: shelfCode, name: shelfCode } });
   if (!existing) await audit(tx, actor.id, 'MASTER_CREATED', 'locations', location.id, { after: location });
   const stock = await tx.stockBalance.create({ data: { tool_id: tool.id, location_id: location.id, on_hand: quantity } });
   const key = 'tool-registration:' + tool.id;
   if (quantity > 0) await tx.inventoryTransaction.create({ data: { tool_id: tool.id, location_id: location.id, actor_user_id: actor.id, type: 'RECEIVE', quantity, idempotency_key: key, reason: '工具登録時の初期在庫' } });
   await audit(tx, actor.id, 'INITIAL_STOCK_REGISTERED', 'stock_balances', key, { stock_balance_id: stock.id, tool_id: tool.id, location_id: location.id, quantity });
  }
  await audit(tx, actor.id, 'TOOL_CREATED', 'tools', tool.id, { after: data, policy });
  return tool;
 }));
}
export async function updateTool(db: PrismaClient, auth: AuthService, token: string | undefined, id: string, input: Input) {
 await auth.authenticate(token, 'masters:write');
 id = uuid(id); const data = toolData(input, false), policy = policyData(input, false);
 return conflict(() => auth.authorized(token, ['masters:write'], async (tx, actor) => {
  const before = await tx.tool.findUnique({ where: { id } });
  if (!before) throw new AuthError(404, '工具が見つかりません');
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
 const supplierEmail = type === 'suppliers' ? email(input.email) : null;
 return conflict(() => auth.authorized(token, ['masters:write'], async (tx, actor) => {
  const item = type === 'machines' ? await tx.machine.create({ data: { ...basic, machine_code: normalized } }) : type === 'locations' ? await tx.location.create({ data: { ...basic, location_code: normalized } }) : await tx.supplier.create({ data: { ...basic, supplier_code: normalized, email: supplierEmail } });
  await audit(tx, actor.id, 'MASTER_CREATED', type, item.id, { after: item });
  return item;
 }));
}
export async function updateMaster(db: PrismaClient, auth: AuthService, token: string | undefined, value: string, id: string, input: Input) {
 await auth.authenticate(token, 'masters:write');
 const type = kind(value), data = masterData(input, false); id = uuid(id);
 const supplierEmail = type === 'suppliers' ? email(input.email) : null;
 return conflict(() => auth.authorized(token, ['masters:write'], async (tx, actor) => {
  const before = type === 'machines' ? await tx.machine.findUnique({ where: { id } }) : type === 'locations' ? await tx.location.findUnique({ where: { id } }) : await tx.supplier.findUnique({ where: { id } });
  if (!before) throw new AuthError(404, '対象が見つかりません');
  unchangedCode(input, codeFields[type], (before as unknown as Record<string, string>)[codeFields[type]]);
  const item = type === 'machines' ? await tx.machine.update({ where: { id }, data }) : type === 'locations' ? await tx.location.update({ where: { id }, data }) : await tx.supplier.update({ where: { id }, data: { ...data, email: supplierEmail } });
  await audit(tx, actor.id, 'MASTER_UPDATED', type, id, { before, after: item });
  return item;
 }));
}
export async function saveSupplierItem(db: PrismaClient, auth: AuthService, token: string | undefined, toolId: string, conditionId: string | undefined, input: Input) {
 await auth.authenticate(token, 'masters:write');
 toolId = uuid(toolId); if (conditionId) conditionId = uuid(conditionId);
 const data = conditionData(input);
 return conflict(() => auth.authorized(token, ['masters:write'], async (tx, actor) => {
  await tx.$queryRaw`SELECT id FROM tools WHERE id=${toolId}::uuid FOR UPDATE`;
  const tool = await tx.tool.findUnique({ where: { id: toolId } });
  const supplier = await tx.supplier.findUnique({ where: { id: data.supplier_id } });
  if (!tool || !supplier) throw new AuthError(404, '工具・仕入先が見つかりません');
  if (!tool.active || !supplier.active) throw new AuthError(409, '有効な工具・仕入先を選択してください');
  const before = conditionId ? await tx.supplierItem.findFirst({ where: { id: conditionId, tool_id: toolId } }) : null;
  if (conditionId && !before) throw new AuthError(404, '購買条件が見つかりません');
  if (before && before.supplier_id !== data.supplier_id) throw new AuthError(400, '登録済み購買条件の仕入先は変更できません');
  const previousPreferred = data.preferred ? await tx.supplierItem.findMany({ where: { tool_id: toolId, preferred: true, ...(conditionId ? { id: { not: conditionId } } : {}) } }) : [];
  if (previousPreferred.length) await tx.supplierItem.updateMany({ where: { id: { in: previousPreferred.map(item => item.id) } }, data: { preferred: false } });
  const item = conditionId ? await tx.supplierItem.update({ where: { id: conditionId }, data }) : await tx.supplierItem.create({ data: { tool_id: toolId, ...data } });
  await audit(tx, actor.id, 'SUPPLIER_ITEM_SAVED', 'supplier_items', item.id, { before, after: item, preference_changes: previousPreferred.map(previous => ({ before: previous, after: { ...previous, preferred: false } })) });
  return { ...item, unit_price: item.unit_price.toFixed(2) };
 }));
}
