import { createHmac } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AuthError, AuthService, type Viewer } from '../auth/service';
import { hashPassword, tokenHash } from '../auth/crypto';
import { audit } from '../masters/write';
import { boolean, integer, price, text, toolData, uuid } from '../masters/validation';
import { recordedUnitPrice } from '../inventory/snapshot';
import { delegate, record, redact, versionOf, type RecordData } from './common';
import { authenticationRows } from './read';
import type { Change, Definition } from './definitions';

type Tx = Prisma.TransactionClient;
function parseValues(table: Definition, input: unknown) {
 const values = record(input), parsed: Record<string, unknown> = {};
 if (!Object.keys(values).length) throw new AuthError(400, '変更内容がありません');
 for (const [key, value] of Object.entries(values)) {
  const field = table.fields.find(field => field.key === key);
  if (!field || field.readonly) throw new AuthError(400, '編集できない列が含まれています');
  if (field.kind === 'number') parsed[key] = integer(typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value, field.label, field.min ?? 0);
  else if (field.kind === 'price') parsed[key] = field.nullable && (value === '' || value === null) ? null : price(value);
  else if (field.kind === 'boolean') parsed[key] = boolean(value);
  else if (field.kind === 'select') {
   if (typeof value !== 'string' || !field.options?.some(option => option.value === value)) throw new AuthError(400, field.label + 'を選択してください');
   parsed[key] = value;
  } else if (field.kind === 'password') {
   if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new AuthError(400, 'パスワードは12〜128文字で設定してください');
   parsed[key] = value;
  } else parsed[key] = field.nullable && (value === '' || value === null) ? null : text(value, field.label, field.max ?? 100, !field.required);
 }
 return parsed;
}
function validateRecord(table: Definition, value: Record<string, unknown>) {
 if (table.key === 'stocks' && Number(value.reserved) > Number(value.on_hand)) throw new AuthError(400, '引当数は実在庫以下にしてください');
 if (table.key === 'policies' && (Number(value.safety_stock) > Number(value.reorder_point) || Number(value.reorder_point) > Number(value.target_stock))) throw new AuthError(400, '安全在庫≦発注点≦目標在庫で設定してください');
 if (table.key === 'order-items' && Number(value.received_quantity) > Number(value.ordered_quantity)) throw new AuthError(400, '入荷済数量は発注数量以下にしてください');
 if (table.key === 'suppliers' && value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value.email))) throw new AuthError(400, 'メールアドレスを確認してください');
}

async function saveStock(tx: Tx, actor: Viewer, before: RecordData, values: Record<string, unknown>, key: string) {
 const toolId = String(before.tool_id), locationId = String(before.location_id);
 await tx.$queryRaw`SELECT id FROM tools WHERE id=${toolId}::uuid FOR UPDATE`;
 const onHand = Number(values.on_hand ?? before.on_hand), reserved = Number(values.reserved ?? before.reserved);
 const changed = await tx.stockBalance.updateMany({ where: { id: before.id, updated_at: before.updated_at, on_hand: Number(before.on_hand), reserved: Number(before.reserved) }, data: { on_hand: onHand, reserved, updated_at: new Date(Math.max(Date.now(), before.updated_at.getTime() + 1)) } });
 if (changed.count !== 1) throw new AuthError(409, '在庫が変更されています。再読み込みして確認してください');
 const delta = onHand - Number(before.on_hand);
 if (delta) {
  const tool = await tx.tool.findUniqueOrThrow({ where: { id: toolId } });
  const transaction = await tx.inventoryTransaction.create({ data: { tool_id: toolId, location_id: locationId, actor_user_id: actor.id, type: 'ADJUSTMENT', quantity: delta, on_hand_after: onHand, unit_price: await recordedUnitPrice(tx, tool), reason: 'データ管理による在庫訂正', idempotency_key: `${key}:${before.id}:stock` } });
  await audit(tx, actor.id, 'TOOL_STOCK_UPDATED', 'inventory_transactions', transaction.id, { before: before.on_hand, after: onHand, transaction });
 }
 await audit(tx, actor.id, 'DATA_ROW_UPDATED', 'stock_balances', before.id, { before: redact(before), after: { on_hand: onHand, reserved } });
}

async function correctHistory(tx: Tx, actor: Viewer, before: RecordData, values: Record<string, unknown>, key: string) {
 if (before.type === 'REVERSAL' || await tx.inventoryTransaction.findUnique({ where: { reverses_id: before.id } })) throw new AuthError(409, '取消済みの履歴と逆取引は訂正できません');
 const reason = text(values.correction_reason, '訂正理由', 500);
 const quantity = integer(values.quantity ?? before.quantity, '増減数量', -2147483647);
 if (!quantity || (before.type === 'ISSUE' && quantity > 0) || (before.type === 'RECEIVE' && quantity < 0)) throw new AuthError(400, '取引種別に合う0以外の増減数量を入力してください');
 const toolId = String(before.tool_id), locationId = String(before.location_id);
 await tx.$queryRaw`SELECT id FROM tools WHERE id=${toolId}::uuid FOR UPDATE`;
 const stock = await tx.stockBalance.findUnique({ where: { tool_id_location_id: { tool_id: toolId, location_id: locationId } } });
 if (!stock) throw new AuthError(409, '訂正する取引の在庫が見つかりません');
 const reversed = stock.on_hand - Number(before.quantity), after = reversed + quantity;
 if ([reversed, after].some(value => value < stock.reserved || value < 0 || value > 2147483647)) throw new AuthError(409, '訂正によって在庫不足・引当割れ・数量上限超過が発生します');
 const changed = await tx.stockBalance.updateMany({ where: { id: stock.id, on_hand: stock.on_hand, reserved: stock.reserved }, data: { on_hand: after } });
 if (changed.count !== 1) throw new AuthError(409, '在庫が変更されています。再読み込みして確認してください');
 const original = await tx.inventoryTransaction.findUniqueOrThrow({ where: { id: before.id } });
 const reversal = await tx.inventoryTransaction.create({ data: { tool_id: toolId, location_id: locationId, actor_user_id: actor.id, machine_id: original.machine_id, type: 'REVERSAL', quantity: -original.quantity, on_hand_after: reversed, unit_price: original.unit_price, reason, reverses_id: before.id, idempotency_key: `${key}:${before.id}:reverse` } });
 const correction = await tx.inventoryTransaction.create({ data: { tool_id: toolId, location_id: locationId, actor_user_id: actor.id, machine_id: original.machine_id, type: original.type, quantity, on_hand_after: after, unit_price: Object.hasOwn(values, 'unit_price') ? values.unit_price as string | null : original.unit_price, reason, idempotency_key: `${key}:${before.id}:correct` } });
 await audit(tx, actor.id, 'DATA_HISTORY_CORRECTED', 'inventory_transactions', before.id, { original, reversal, correction, reason });
}

async function saveUser(tx: Tx, actor: Viewer, before: RecordData, values: Record<string, unknown>, passwordHash?: string) {
 const next = { ...before, ...values };
 if (before.id === actor.id && (!next.active || next.role !== 'ADMIN')) throw new AuthError(409, '自分自身を無効化・降格することはできません');
 if (before.active && before.role === 'ADMIN' && (!next.active || next.role !== 'ADMIN') && await tx.user.count({ where: { active: true, role: 'ADMIN' } }) <= 1) throw new AuthError(409, '有効な管理者を1人以上残してください');
 const user = await tx.user.update({ where: { id: before.id }, data: { name: String(next.name), role: next.role as 'ADMIN' | 'WORKER', active: Boolean(next.active), ...(passwordHash ? { password_hash: passwordHash } : {}), updated_at: new Date(Math.max(Date.now(), before.updated_at.getTime() + 1)) }, select: { id: true, employee_code: true, name: true, role: true, active: true } });
 if (before.role !== next.role || before.active !== next.active || passwordHash) await tx.session.deleteMany({ where: { user_id: before.id } });
 await audit(tx, actor.id, 'USER_UPDATED', 'users', before.id, { before: redact(before), after: user, password_changed: !!passwordHash });
}

async function authenticationAction(tx: Tx, actor: Viewer, table: Definition, change: Change) {
 const before = (await authenticationRows(tx, table.key)).find(row => row.id === change.id);
 if (!before || before.version !== change.version) throw new AuthError(409, '認証情報が変更されています。再読み込みして確認してください');
 if (table.key === 'sessions') {
  if (change.values.revoke !== true) throw new AuthError(400, '失効するセッションを選択してください');
  await tx.session.deleteMany({ where: { user_id: uuid(change.id) } });
 } else {
  if (change.values.reset !== true) throw new AuthError(400, '解除するログイン制限を選択してください');
  const users = await tx.user.findMany({ select: { id: true, employee_code: true } });
  const user = users.find(user => user.id === change.id);
  if (user) await tx.loginAttempt.deleteMany({ where: { key: tokenHash(user.employee_code) } });
  else if (change.id === 'unknown') await tx.loginAttempt.deleteMany({ where: { key: { notIn: users.map(user => tokenHash(user.employee_code)) } } });
  else throw new AuthError(404, 'ユーザーが見つかりません');
 }
 await audit(tx, actor.id, table.key === 'sessions' ? 'DATA_SESSIONS_REVOKED' : 'DATA_LOGIN_LIMIT_RESET', 'users', change.id, { before: before.values });
}

export async function saveTable(db: PrismaClient, auth: AuthService, token: string | undefined, table: Definition, input: Record<string, unknown>) {
 if (table.mode === 'readonly') throw new AuthError(403, 'このデータは閲覧専用です');
 const requestKey = uuid(input.request_key), key = 'data-batch:' + requestKey;
 if (!Array.isArray(input.changes) || input.changes.length < 1 || input.changes.length > 20) throw new AuthError(400, '一度に保存できる変更は1〜20行です');
 const changes: Change[] = input.changes.map(item => {
  const change = record(item);
  if (typeof change.id !== 'string' || typeof change.version !== 'string' || change.version.length > 100) throw new AuthError(400, '行と更新日時を確認してください');
  if (!(table.key === 'login-attempts' && change.id === 'unknown')) uuid(change.id);
  return { id: change.id, version: change.version, values: parseValues(table, change.values) };
 });
 if (new Set(changes.map(change => change.id)).size !== changes.length) throw new AuthError(400, '同じ行を重複して保存できません');
 const signature = createHmac('sha256', token!).update(JSON.stringify({ table: table.key, changes })).digest('hex');
 const hashes = new Map<string, string>();
 for (const change of changes) if (change.values.password) hashes.set(change.id, await hashPassword(String(change.values.password)));
 try {
  return await auth.authorized(token, ['data:manage'], async (tx, actor) => {
   await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
   const previous = await tx.auditLog.findFirst({ where: { action: 'DATA_BATCH_SAVED', entity_id: key } });
   if (previous) {
    const details = record(previous.details);
    if (previous.actor_user_id !== actor.id || details.signature !== signature) throw new AuthError(409, '同じ保存キーを別の変更へ使用できません');
    return { saved: Number(details.saved) };
   }
   for (const change of changes) {
    if (table.mode === 'revoke' || table.mode === 'reset') { await authenticationAction(tx, actor, table, change); continue; }
    const model = delegate(tx, table);
    const select = table.key === 'users' ? { id: true, employee_code: true, name: true, role: true, active: true, updated_at: true } : undefined;
    const before = await model.findUnique({ where: { id: change.id }, ...(select ? { select } : {}) });
    if (!before) throw new AuthError(404, '保存する行が見つかりません');
    if (versionOf(before) !== change.version) throw new AuthError(409, '他の操作で変更された行があります。再読み込みして確認してください');
    const values = { ...change.values };
    validateRecord(table, { ...before, ...values });
    if (table.key === 'stocks') { await saveStock(tx, actor, before, values, key); continue; }
    if (table.key === 'history') { await correctHistory(tx, actor, before, values, key); continue; }
    if (table.key === 'users') { await saveUser(tx, actor, before, values, hashes.get(change.id)); continue; }
    let data: Record<string, unknown> = values;
    if (table.key === 'tools') {
     const validated = toolData({ ...before, ...values, department: values.department, shelf_code: values.shelf_code, unit_price: undefined }, false, String(before.shelf_code));
     if (validated.unit !== before.unit && (await tx.stockBalance.count({ where: { tool_id: before.id } }) || await tx.inventoryTransaction.count({ where: { tool_id: before.id } }))) throw new AuthError(409, '在庫・履歴がある工具の単位は変更できません');
     data = { ...validated, ...(Object.hasOwn(values, 'unit_price') ? { unit_price: values.unit_price } : {}) };
    }
    const updated = await model.updateMany({ where: { id: before.id, updated_at: before.updated_at }, data: { ...data, updated_at: new Date(Math.max(Date.now(), before.updated_at.getTime() + 1)) } });
    if (updated.count !== 1) throw new AuthError(409, '他の操作で変更された行があります。再読み込みして確認してください');
    const after = await model.findUnique({ where: { id: before.id } });
    if (table.key === 'tools') {
     const policy = await tx.inventoryPolicy.findUnique({ where: { tool_id: before.id } });
     await audit(tx, actor.id, 'TOOL_UPDATED', 'tools', before.id, { before, after, previousPolicy: policy, policy });
    } else {
     await audit(tx, actor.id, 'DATA_ROW_UPDATED', table.key, before.id, { before: redact(before), after: redact(after) });
     if (table.key === 'policies') {
      const tool = await tx.tool.findUniqueOrThrow({ where: { id: String(before.tool_id) } });
      await audit(tx, actor.id, 'TOOL_UPDATED', 'tools', tool.id, { before: tool, after: tool, previousPolicy: before, policy: after });
     }
    }
   }
   await audit(tx, actor.id, 'DATA_BATCH_SAVED', 'data_manager', key, { table: table.key, ids: changes.map(change => change.id), saved: changes.length, signature });
   return { saved: changes.length };
  });
 } catch (error) {
  if (error instanceof AuthError) throw error;
  const e = error as { code?: string; meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } };
  const code = e.meta?.driverAdapterError?.cause?.originalCode ?? e.code;
  if (['P2002', '23505'].includes(code ?? '')) throw new AuthError(409, '重複するデータがあります。優先仕入先や未処理の発注候補は1件にしてください');
  if (['P2003', 'P2025', '23503'].includes(code ?? '')) throw new AuthError(409, '参照先が変更されています。再読み込みして確認してください');
  if (['23514', 'P2004'].includes(code ?? '')) throw new AuthError(400, '数量・状態・参照先の組み合わせを確認してください');
  if (['55P03', '40P01', 'P2028', 'P2034'].includes(code ?? '')) throw new AuthError(409, '別の操作を処理中です。同じ内容で再試行してください');
  throw error;
 }
}
