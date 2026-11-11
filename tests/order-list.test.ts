import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { databaseFixture } from './helpers/database';
import { MastersService } from '../src/lib/masters/service';
import { InventoryService } from '../src/lib/inventory/service';
import { AuthError } from '../src/lib/auth/service';
import { listOrders } from '../src/lib/orders/list';
import type { OrderStatus } from '../src/generated/prisma/client';

let f: Awaited<ReturnType<typeof databaseFixture>>, masters: MastersService, inventory: InventoryService, seq = 0;
before(async () => { f = await databaseFixture('order_list_test'); masters = new MastersService(f.db); inventory = new InventoryService(f.db); });
after(async () => { await f?.close(); });
const token = (role = 'ADMIN') => f.tokens[role];
async function stock(quantity = 10, reorder_point = 10) {
 const tool = await masters.createTool(token(), { tool_code: 'QUEUE-' + (++seq), name: '発注リスト工具', category: 'DRILL', department: '17314', unit: '本', on_hand: quantity, reorder_point, order_quantity: 7, unit_price: '123.45' });
 const balance = await f.db.stockBalance.findFirstOrThrow({ where: { tool_id: tool.id } });
 return { tool, location_id: balance.location_id };
}
type Stock = Awaited<ReturnType<typeof stock>>;
const input = (s: Stock, quantity = 1) => ({ tool_id: s.tool.id, location_id: s.location_id, quantity, request_key: randomUUID() });
const entry = (s: Stock) => f.db.orderListEntry.findUnique({ where: { tool_id: s.tool.id } });
async function order(s: Stock, status: OrderStatus, ordered_quantity: number, received_quantity = 0) {
 const supplier = await f.db.supplier.create({ data: { supplier_code: 'Q-' + randomUUID(), name: '架空仕入先' } });
 const purchase = await f.db.purchaseOrder.create({ data: { order_no: randomUUID(), supplier_id: supplier.id, requested_by: f.users.ADMIN, status } });
 await f.db.purchaseOrderItem.create({ data: { order_id: purchase.id, tool_id: s.tool.id, ordered_quantity, received_quantity, unit_price: '1', supplier_model: 'test', order_multiple: 1, lead_time_days: 1 } });
 return purchase;
}

test('出庫後の全棚合計が発注点＋発注残を厳密に下回る場合だけ登録する', async () => {
 const s = await stock(6, 8);
 const other = await f.db.location.create({ data: { location_code: randomUUID(), name: '別棚' } });
 await f.db.stockBalance.create({ data: { tool_id: s.tool.id, location_id: other.id, on_hand: 3 } });
 await inventory.issue(token('WORKER'), input(s)); // 5+3 = 8: equality does not qualify.
 assert.equal(await entry(s), null);
 const issued = await inventory.issue(token('WORKER'), input(s));
 assert.equal((await entry(s))?.trigger_transaction_id, issued.id);
 const absent = await stock(2, 0);
 await f.db.inventoryPolicy.delete({ where: { tool_id: absent.tool.id } });
 await inventory.issue(token('WORKER'), input(absent, 2));
 assert.equal(await entry(absent), null);
});

test('発注残はORDERED/PARTIALLY_RECEIVEDの未受領数を明細ごとにゼロ下限で合計する', async () => {
 const s = await stock(12, 2);
 await order(s, 'ORDERED', 5, 1); // 4 remaining.
 await order(s, 'PARTIALLY_RECEIVED', 8, 3); // 5 remaining; threshold = 11.
 await order(s, 'ORDERED', 8, 8); // Fully received items add zero.
 for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'EXPORTED', 'RECEIVED', 'REJECTED', 'CANCELLED'] as const) await order(s, status, 100);
 await inventory.issue(token('WORKER'), input(s));
 assert.equal(await entry(s), null); // 11 == 11.
 const issued = await inventory.issue(token('WORKER'), input(s));
 assert.equal((await entry(s))?.trigger_transaction_id, issued.id);
});

test('工具ごとに一行で最新の条件該当出庫だけを保持し再送で更新しない', async () => {
 const s = await stock(10, 20), firstInput = input(s);
 const first = await inventory.issue(token('WORKER'), firstInput);
 const initial = await entry(s); assert.ok(initial);
 const latest = await inventory.issue(token('ADMIN_ALT'), input(s));
 const updated = await entry(s); assert.ok(updated);
 assert.equal(updated.id, initial.id); assert.equal(updated.trigger_transaction_id, latest.id);
 assert.equal(updated.created_at.toISOString(), initial.created_at.toISOString());
 assert.deepEqual(await inventory.issue(token('WORKER'), firstInput), first);
 assert.deepEqual(await entry(s), updated);
 assert.equal(await f.db.orderListEntry.count({ where: { tool_id: s.tool.id } }), 1);
 assert.equal(await f.db.auditLog.count({ where: { action: 'ORDER_LIST_UPDATED', entity_id: updated.id } }), 2);
 const log = await f.db.auditLog.findFirstOrThrow({ where: { action: 'ORDER_LIST_UPDATED', entity_id: updated.id }, orderBy: { created_at: 'desc' } });
 assert.equal((log.details as { tool_id: string }).tool_id, s.tool.id);
 assert.equal((log.details as { trigger_transaction_id: string }).trigger_transaction_id, latest.id);
});

test('入庫・取消・手修正・失敗出庫は新規登録せず既存行を変更しない', async () => {
 const s = await stock(10, 1);
 await inventory.receive(token('WORKER'), input(s));
 const nonqualifying = await inventory.issue(token('WORKER'), input(s));
 await inventory.reverse(token(), { transaction_id: nonqualifying.id, request_key: randomUUID() });
 await masters.updateTool(token(), s.tool.id, { name: s.tool.name, category: s.tool.category, unit: s.tool.unit, active: true, on_hand: 1, expected_on_hand: 11, reorder_point: 20 });
 await assert.rejects(inventory.issue(token('WORKER'), input(s, 2)));
 assert.equal(await entry(s), null);
 const issued = await inventory.issue(token('WORKER'), input(s));
 const saved = await entry(s); assert.ok(saved);
 await inventory.receive(token(), input(s, 30));
 await inventory.reverse(token(), { transaction_id: issued.id, request_key: randomUUID() });
 await inventory.issue(token('WORKER'), input(s)); // Above threshold; retain the qualifying source.
 assert.deepEqual(await entry(s), saved);
});

test('発注リスト監査失敗は在庫・出庫履歴・発注リスト・通常監査をまとめて戻す', async () => {
 const s = await stock();
 await f.admin.query("CREATE FUNCTION fail_order_list_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ORDER_LIST_UPDATED' THEN RAISE EXCEPTION 'test order list audit rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_order_list_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_order_list_audit()");
 try {
  await assert.rejects(inventory.issue(token('WORKER'), input(s)));
  assert.equal((await f.db.stockBalance.findFirstOrThrow({ where: { tool_id: s.tool.id } })).on_hand, 10);
  assert.equal(await f.db.inventoryTransaction.count({ where: { tool_id: s.tool.id, type: 'ISSUE' } }), 0);
  assert.equal(await entry(s), null);
  assert.equal(await f.db.auditLog.count({ where: { action: 'INVENTORY_MUTATION', details: { path: ['result', 'tool_id'], equals: s.tool.id } } }), 0);
 } finally { await f.admin.query('DROP TRIGGER reject_order_list_audit ON audit_logs; DROP FUNCTION fail_order_list_audit()'); }
});

test('両権限で単価も含む一覧を読めて現在の発注数を合算し最新出庫者を表示する', async () => {
 const s = await stock(), issued = await inventory.issue(token('ADMIN_ALT'), input(s));
 // The existing partial unique index permits only one OPEN candidate per tool.
 await f.db.reorderCandidate.updateMany({ where: { tool_id: s.tool.id, status: 'OPEN' }, data: { quantity: 10 } });
 await f.db.reorderCandidate.createMany({ data: [{ tool_id: s.tool.id, status: 'CONVERTED', quantity: 100 }, { tool_id: s.tool.id, status: 'DISMISSED', quantity: 100 }] });
 await f.db.tool.update({ where: { id: s.tool.id }, data: { unit_price: '999999999999.99' } });
 const admin = (await listOrders(f.db, f.auth, token())).items.find(row => row.tool.id === s.tool.id)!;
 assert.equal(admin.quantity, 10); assert.equal(admin.unit_price, '999999999999.99');
 assert.equal(admin.created_at.toISOString(), issued.created_at);
 assert.deepEqual(admin.actor, { name: '架空ADMIN', employee_code: 'ADMIN_ALT' });
 assert.equal(admin.tool.department, '17314');
 const worker = (await listOrders(f.db, f.auth, token('WORKER'))).items.find(row => row.tool.id === s.tool.id)!;
 assert.equal(worker.unit_price, '999999999999.99');
 assert.equal(JSON.stringify(worker).includes('password_hash'), false);
 assert.equal(JSON.stringify(worker).includes('token_hash'), false);
 await f.db.reorderCandidate.updateMany({ where: { tool_id: s.tool.id }, data: { status: 'DISMISSED' } });
 assert.equal((await listOrders(f.db, f.auth, token())).items.find(row => row.tool.id === s.tool.id)?.quantity, 0);
 await assert.rejects(listOrders(f.db, f.auth, undefined), (e: unknown) => e instanceof AuthError && e.status === 401);
 for (const page of [0, -1, '1.5', true]) await assert.rejects(listOrders(f.db, f.auth, token(), { page }), (e: unknown) => e instanceof AuthError && e.status === 400);
});

test('一覧は最新出庫日時・取引ID降順で50件ずつ返し巨大な範囲外ページは空', async () => {
 const time = new Date('2099-01-01T00:00:00Z');
 for (let i = 1; i <= 51; i++) {
  const s = await stock(1, 2);
  const id = '20000000-0000-0000-0000-' + String(i).padStart(12, '0');
  const source = await f.db.inventoryTransaction.create({ data: { id, tool_id: s.tool.id, location_id: s.location_id, actor_user_id: f.users.WORKER, type: 'ISSUE', quantity: -1, idempotency_key: randomUUID(), created_at: time } });
  await f.db.orderListEntry.create({ data: { tool_id: s.tool.id, trigger_transaction_id: source.id } });
 }
 const first = await listOrders(f.db, f.auth, token()), second = await listOrders(f.db, f.auth, token(), { page: 2 });
 assert.equal(first.items.length, 50); assert.equal(first.pageSize, 50);
 assert.equal(first.items[0].tool.tool_code, 'QUEUE-' + seq);
 assert.equal(second.items[0].created_at.toISOString(), time.toISOString());
 assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, first.total);
 assert.deepEqual((await listOrders(f.db, f.auth, token(), { page: '999999999999' })).items, []);
});
