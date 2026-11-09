import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { databaseFixture } from './helpers/database';
import { DataManager } from '../src/lib/data-manager/service';
import { tableDefinitions } from '../src/lib/data-manager/definitions';
import { MastersService } from '../src/lib/masters/service';
import { AuthError } from '../src/lib/auth/service';
import { tokenHash } from '../src/lib/auth/crypto';
import { InventoryService } from '../src/lib/inventory/service';

let fixture: Awaited<ReturnType<typeof databaseFixture>>, manager: DataManager, masters: MastersService;
before(async () => { fixture = await databaseFixture('data_manager'); manager = new DataManager(fixture.db); masters = new MastersService(fixture.db); });
after(async () => { await fixture?.close(); });
const status = (n: number) => (error: unknown) => error instanceof AuthError && error.status === n;
const tool = () => masters.createTool(fixture.tokens.ADMIN, { tool_code: 'DATA-' + randomUUID().slice(0, 8), name: '責任者編集用', category: 'DRILL', on_hand: 10, unit_price: '123.45' });
const row = async (table: string, id: string) => (await manager.list(fixture.tokens.ADMIN, table)).rows.find(item => item.id === id)!;
const save = (table: string, changes: unknown[]) => manager.save(fixture.tokens.ADMIN, table, { changes, request_key: randomUUID() });

test('全15種類を管理者だけが参照でき、秘密情報を返さない', async () => {
 assert.equal(tableDefinitions.length, 15);
 for (const table of tableDefinitions) {
  await assert.rejects(manager.list(fixture.tokens.WORKER, table.key), status(403));
  await assert.rejects(manager.list(undefined, table.key), status(401));
  const data = await manager.list(fixture.tokens.ADMIN, table.key);
  assert.ok(Array.isArray(data.rows));
  const json = JSON.stringify(data);
  for (const secret of ['password_hash', 'scrypt$', 'token_hash', fixture.tokens.ADMIN, tokenHash(fixture.tokens.ADMIN)]) assert.ok(!json.includes(secret), table.key + ':' + secret);
 }
 await assert.rejects(manager.list(fixture.tokens.ADMIN, '__proto__'), status(404));
 await assert.rejects(manager.list(fixture.tokens.ADMIN, 'tools', { page: '1.1' }), status(400));
});

test('表の複数行を保存し、許可外列・不正値・古い更新日時は全件ロールバックする', async () => {
 const first = await tool(), second = await tool();
 const a = await row('tools', first.id), b = await row('tools', second.id);
 await assert.rejects(save('tools', [{ ...a, values: { name: '途中の変更' } }, { ...b, values: { category: 'INVALID' } }]), status(400));
 assert.equal((await fixture.db.tool.findUniqueOrThrow({ where: { id: first.id } })).name, first.name);
 await save('tools', [{ ...a, values: { name: '表から更新', unit_price: '0.00' } }, { ...b, values: { name: '2行目も更新' } }]);
 assert.equal((await fixture.db.tool.findUniqueOrThrow({ where: { id: first.id } })).name, '表から更新');
 await assert.rejects(save('tools', [{ ...a, values: { name: '古い画面' } }]), status(409));
 await assert.rejects(save('tools', [{ ...await row('tools', first.id), values: { id: randomUUID() } }]), status(400));
 await assert.rejects(manager.save(fixture.tokens.WORKER, 'tools', { changes: [{ ...a, values: { name: '禁止' } }], request_key: randomUUID() }), status(403));
 await assert.rejects(save('audit', [{ ...a, values: { action: 'forged' } }]), status(403));
 const retryKey = randomUUID(), change = { ...await row('tools', first.id), values: { name: '再送確認' } };
 await manager.save(fixture.tokens.ADMIN, 'tools', { changes: [change], request_key: retryKey });
 await manager.save(fixture.tokens.ADMIN, 'tools', { changes: [change], request_key: retryKey });
 await assert.rejects(manager.save(fixture.tokens.ADMIN, 'tools', { changes: [{ ...change, values: { name: 'キーの再利用' } }], request_key: retryKey }), status(409));
});

test('在庫表の修正は差分履歴・監査と同時保存し、引当割れを拒否する', async () => {
 const created = await tool(), stock = await fixture.db.stockBalance.findFirstOrThrow({ where: { tool_id: created.id } });
 await save('stocks', [{ ...await row('stocks', stock.id), values: { on_hand: 12, reserved: 3 } }]);
 const updated = await fixture.db.stockBalance.findUniqueOrThrow({ where: { id: stock.id } });
 assert.equal(updated.on_hand, 12); assert.equal(updated.reserved, 3);
 const history = await fixture.db.inventoryTransaction.findFirstOrThrow({ where: { tool_id: created.id, type: 'ADJUSTMENT' } });
 assert.equal(history.quantity, 2); assert.equal(history.actor_user_id, fixture.users.ADMIN); assert.equal(history.on_hand_after, 12);
 await assert.rejects(save('stocks', [{ ...await row('stocks', stock.id), values: { on_hand: 2 } }]), status(400));
 assert.equal((await fixture.db.stockBalance.findUniqueOrThrow({ where: { id: stock.id } })).on_hand, 12);
});

test('入出庫履歴の訂正は原本を維持し、取消と訂正を原子的に追加する', async () => {
 const created = await tool();
 const original = await fixture.db.inventoryTransaction.findFirstOrThrow({ where: { tool_id: created.id } });
 const body = { request_key: randomUUID(), changes: [{ ...await row('history', original.id), values: { quantity: 8, correction_reason: '数量入力の訂正' } }] };
 await manager.save(fixture.tokens.ADMIN, 'history', body);
 await manager.save(fixture.tokens.ADMIN, 'history', body);
 assert.equal(await fixture.db.inventoryTransaction.count({ where: { tool_id: created.id } }), 3);
 assert.deepEqual(await fixture.db.inventoryTransaction.findUniqueOrThrow({ where: { id: original.id } }), original);
 const reversal = await fixture.db.inventoryTransaction.findUniqueOrThrow({ where: { reverses_id: original.id } });
 assert.equal(reversal.quantity, -10);
 assert.equal((await fixture.db.stockBalance.findFirstOrThrow({ where: { tool_id: created.id } })).on_hand, 8);
 const correction = await fixture.db.inventoryTransaction.findFirstOrThrow({ where: { tool_id: created.id, reason: '数量入力の訂正', type: 'RECEIVE' } });
 assert.equal(correction.quantity, 8);
 assert.equal((await row('history', original.id)).editable, false);
 await assert.rejects(save('history', [{ ...await row('history', original.id), values: { quantity: 7, correction_reason: '二重訂正' } }]), status(409));
 await assert.rejects(save('history', [{ ...await row('history', correction.id), values: { quantity: 0, correction_reason: '不正数量' } }]), status(400));
});

test('表の出庫数量を負数の文字列で訂正できる', async () => {
 const created = await tool(), stock = await fixture.db.stockBalance.findFirstOrThrow({ where: { tool_id: created.id } });
 const issued = await new InventoryService(fixture.db).issue(fixture.tokens.ADMIN, { tool_id: created.id, location_id: stock.location_id, quantity: 2, request_key: randomUUID() });
 await save('history', [{ ...await row('history', issued.id), values: { quantity: '-3', correction_reason: '出庫数を訂正' } }]);
 assert.equal((await fixture.db.stockBalance.findUniqueOrThrow({ where: { id: stock.id } })).on_hand, 7);
});

test('ユーザー表は自分の降格を拒否し、権限変更時は対象のセッションを失効する', async () => {
 const own = await row('users', fixture.users.ADMIN);
 await assert.rejects(save('users', [{ ...own, values: { role: 'WORKER' } }]), status(409));
 const user = await fixture.auth.createUser(fixture.tokens.ADMIN, { employee_code: 'DATA-USER', name: '編集対象', role: 'WORKER', password: fixture.password });
 const token = (await fixture.auth.login('DATA-USER', fixture.password)).token;
 await save('users', [{ ...await row('users', user.id), values: { role: 'ADMIN', name: '権限変更済み' } }]);
 await assert.rejects(fixture.auth.authenticate(token), status(401));
 const logs = await fixture.db.auditLog.findMany({ where: { entity_id: user.id } });
 assert.ok(!JSON.stringify(logs).includes('password_hash'));
});

test('方針・仕入・発注の数値制約を守る', async () => {
 const created = await tool(), policy = await fixture.db.inventoryPolicy.findUniqueOrThrow({ where: { tool_id: created.id } });
 await assert.rejects(save('policies', [{ ...await row('policies', policy.id), values: { safety_stock: 5, reorder_point: 2 } }]), status(400));
 await save('policies', [{ ...await row('policies', policy.id), values: { safety_stock: 2, reorder_point: 4, target_stock: 6 } }]);
 const supplier = await fixture.db.supplier.create({ data: { supplier_code: 'S-01', name: '旧仕入先' } });
 await save('suppliers', [{ ...await row('suppliers', supplier.id), values: { name: '表で更新した仕入先' } }]);
 const order = await fixture.db.purchaseOrder.create({ data: { order_no: 'DATA-ORDER', supplier_id: supplier.id, requested_by: fixture.users.ADMIN, status: 'DRAFT' } });
 const item = await fixture.db.purchaseOrderItem.create({ data: { order_id: order.id, tool_id: created.id, ordered_quantity: 10, received_quantity: 2, unit_price: '5', supplier_model: '', order_multiple: 1, lead_time_days: 1 } });
 await assert.rejects(save('order-items', [{ ...await row('order-items', item.id), values: { received_quantity: 11 } }]), status(400));
 await save('orders', [{ ...await row('orders', order.id), values: { status: 'ORDERED' } }]);
 assert.equal((await fixture.db.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'ORDERED');
});

test('参照マスタ・仕入条件・発注候補も編集でき、全テーブルの検索とページングが動作する', async () => {
 const created = await tool();
 const machine = await fixture.db.machine.create({ data: { machine_code: 'DATA-M', name: '設備' } });
 const supplier = await fixture.db.supplier.create({ data: { supplier_code: 'DATA-S', name: '仕入先' } });
 const condition = await fixture.db.supplierItem.create({ data: { supplier_id: supplier.id, tool_id: created.id, unit_price: '3.50', order_multiple: 1, lead_time_days: 2 } });
 const candidate = await fixture.db.reorderCandidate.create({ data: { tool_id: created.id, quantity: 4, status: 'OPEN' } });
 await save('machines', [{ ...await row('machines', machine.id), values: { active: false } }]);
 await save('supplier-items', [{ ...await row('supplier-items', condition.id), values: { preferred: true, unit_price: '7.25' } }]);
 await save('candidates', [{ ...await row('candidates', candidate.id), values: { quantity: 8 } }]);
 assert.equal((await fixture.db.supplierItem.findUniqueOrThrow({ where: { id: condition.id } })).unit_price.toFixed(2), '7.25');
 for (const table of tableDefinitions) assert.ok(Array.isArray((await manager.list(fixture.tokens.ADMIN, table.key, { q: 'DATA' })).rows), table.key);
 await fixture.db.tool.createMany({ data: Array.from({ length: 51 }, (_, index) => ({ tool_code: 'PAGE-' + String(index).padStart(3, '0'), name: 'ページ検証', category: 'DRILL', unit: '個', manufacturer: '', model: '' })) });
 const first = await manager.list(fixture.tokens.ADMIN, 'tools', { q: 'PAGE-' }), second = await manager.list(fixture.tokens.ADMIN, 'tools', { q: 'PAGE-', page: '2' });
 assert.equal(first.total, 51); assert.equal(first.rows.length, 50); assert.equal(second.rows.length, 1);
});

test('監査保存に失敗した一括編集は在庫・取引を含め全件ロールバックする', async () => {
 const created = await tool(), stock = await fixture.db.stockBalance.findFirstOrThrow({ where: { tool_id: created.id } });
 const before = await row('stocks', stock.id);
 await fixture.admin.query("CREATE FUNCTION reject_data_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'DATA_BATCH_SAVED' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER data_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_data_audit()");
 try {
  await assert.rejects(save('stocks', [{ ...before, values: { on_hand: 15 } }]));
  assert.equal((await fixture.db.stockBalance.findUniqueOrThrow({ where: { id: stock.id } })).on_hand, 10);
  assert.equal(await fixture.db.inventoryTransaction.count({ where: { tool_id: created.id } }), 1);
 } finally { await fixture.admin.query('DROP TRIGGER data_audit_failure ON audit_logs; DROP FUNCTION reject_data_audit()'); }
});

test('セッションとログイン試行は秘密キーを使わず管理できる', async () => {
 const login = await fixture.auth.login('WORKER', fixture.password);
 const sessions = await manager.list(fixture.tokens.ADMIN, 'sessions');
 const worker = sessions.rows.find(item => item.id === fixture.users.WORKER)!;
 await save('sessions', [{ ...worker, values: { revoke: true } }]);
 await assert.rejects(fixture.auth.authenticate(login.token), status(401));
 await fixture.db.loginAttempt.create({ data: { key: tokenHash('WORKER'), attempts: 6, started_at: new Date() } });
 const failed = (await manager.list(fixture.tokens.ADMIN, 'login-attempts')).rows.find(item => item.id === fixture.users.WORKER)!;
 await save('login-attempts', [{ ...failed, values: { reset: true } }]);
 assert.equal(await fixture.db.loginAttempt.count({ where: { key: tokenHash('WORKER') } }), 0);
});
