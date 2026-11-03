import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { databaseFixture } from './helpers/database';
import { MastersService } from '../src/lib/masters/service';
import { AuthError } from '../src/lib/auth/service';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
let service: MastersService;
let seq = 0;
const code = () => 'TEST-' + (++seq);
const status = (n: number) => (e: unknown) => e instanceof AuthError && e.status === n;
const toolInput = () => ({ tool_code: code(), name: '架空ドリル', category: 'DRILL', manufacturer: '架空', model: 'MODEL-DEMO', unit: '本', safety_stock: 2, reorder_point: 5, target_stock: 10 });
const createTool = () => service.createTool(fixture.tokens.STOCK_MANAGER, toolInput());
const location = () => service.createMaster(fixture.tokens.ADMIN, 'locations', { location_code: code(), name: '架空棚' });
before(async () => { fixture = await databaseFixture('masters_test'); service = new MastersService(fixture.db); });
after(async () => { await fixture?.close(); });

test('工具コードを正規化し方針と監査を保存、正規化後の重複を拒否', async () => {
 const input = { ...toolInput(), tool_code: ' lower-code ' };
 const tool = await service.createTool(fixture.tokens.STOCK_MANAGER, input);
 assert.equal(tool.tool_code, 'LOWER-CODE');
 const detail = await service.toolDetail(fixture.tokens.ADMIN, tool.id);
 assert.equal(detail.policy?.reorder_point, 5);
 assert.equal(await fixture.db.auditLog.count({ where: { entity_id: tool.id, action: 'TOOL_CREATED' } }), 1);
 await assert.rejects(service.createTool(fixture.tokens.ADMIN, input), status(409));
});

test('設備・棚・仕入先の登録、重複拒否、名前と状態の変更、コード変更禁止', async () => {
 for (const [kind, field] of [['machines', 'machine_code'], ['locations', 'location_code'], ['suppliers', 'supplier_code']] as const) {
  const input = { [field]: code(), name: '架空名称', email: 'demo@example.invalid' };
  const master = await service.createMaster(fixture.tokens.ADMIN, kind, input);
  await assert.rejects(service.createMaster(fixture.tokens.ADMIN, kind, input), status(409));
  const updated = await service.updateMaster(fixture.tokens.ADMIN, kind, master.id, { name: '変更後', active: false, email: '' });
  assert.equal(updated.name, '変更後'); assert.equal(updated.active, false);
  await assert.rejects(service.updateMaster(fixture.tokens.ADMIN, kind, master.id, { ...input, [field]: 'OTHER', active: true }), status(400));
 }
 await assert.rejects(service.listMasters(fixture.tokens.ADMIN, 'users'), status(400));
});

test('在庫方針・型・桁数とUUIDを検証し、欠落した方針だけ0を初期値にする', async () => {
 for (const bad of [-1, 1.5, true, '', '1e2', '2147483648']) {
  await assert.rejects(service.createTool(fixture.tokens.ADMIN, { ...toolInput(), safety_stock: bad }), status(400));
 }
 await assert.rejects(service.createTool(fixture.tokens.ADMIN, { ...toolInput(), target_stock: 1 }), status(400));
 await assert.rejects(service.createTool(fixture.tokens.ADMIN, { ...toolInput(), unit: 'x'.repeat(17) }), status(400));
 await assert.rejects(service.toolDetail(fixture.tokens.ADMIN, 'bad-id'), status(400));
 await assert.rejects(service.toolDetail(fixture.tokens.ADMIN, randomUUID()), status(404));
 const input = toolInput();
 const { safety_stock: _s, reorder_point: _r, target_stock: _t, ...basic } = input;
 const tool = await service.createTool(fixture.tokens.ADMIN, basic);
 assert.equal((await service.toolDetail(fixture.tokens.ADMIN, tool.id)).policy?.target_stock, 0);
});

test('工具の番号・名前・型番検索、分類・状態絞込、ページングと棚集計', async () => {
 const input = { ...toolInput(), name: '検索専用エンドミル', model: 'Unique-Model-X' };
 const tool = await service.createTool(fixture.tokens.ADMIN, input);
 for (const q of [input.tool_code.toLowerCase(), '検索専用', 'unique-model-x']) {
  const list = await service.listTools(fixture.tokens.WORKER, { q, category: 'DRILL' });
  assert.equal(list.total, 1); assert.equal(list.tools[0].id, tool.id);
 }
 assert.equal((await service.listTools(fixture.tokens.WORKER, { q: input.tool_code, page: '999' })).tools.length, 0);
 await assert.rejects(service.listTools(fixture.tokens.ADMIN, { page: '1.5' }), status(400));
 await assert.rejects(service.listTools(fixture.tokens.ADMIN, { status: 'oops' }), status(400));
 await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, active: false });
 assert.equal((await service.listTools(fixture.tokens.ADMIN, { q: input.tool_code })).total, 0);
 assert.equal((await service.listTools(fixture.tokens.ADMIN, { q: input.tool_code, status: 'inactive' })).total, 1);
});

test('単価をDecimalで保存し優先仕入先を一つに維持、作業者には購買条件を返さない', async () => {
 const tool = await createTool();
 const suppliers = await Promise.all([1, 2].map(() => service.createMaster(fixture.tokens.ADMIN, 'suppliers', { supplier_code: code(), name: '架空商社' })));
 const input = { supplier_id: suppliers[0].id, unit_price: '999999999999.99', order_multiple: 5, lead_time_days: 3, preferred: true };
 const first = await service.saveSupplierItem(fixture.tokens.ADMIN, tool.id, undefined, input);
 assert.equal(first.unit_price, '999999999999.99');
 await assert.rejects(service.saveSupplierItem(fixture.tokens.ADMIN, tool.id, undefined, input), status(409));
 const second = await service.saveSupplierItem(fixture.tokens.ADMIN, tool.id, undefined, { ...input, supplier_id: suppliers[1].id, unit_price: '0.10' });
 await Promise.all([first.id, second.id].map((id, i) => service.saveSupplierItem(fixture.tokens.ADMIN, tool.id, id, { ...input, supplier_id: suppliers[i].id, unit_price: '1.25' })));
 assert.equal(await fixture.db.supplierItem.count({ where: { tool_id: tool.id, preferred: true } }), 1);
 const worker = await service.toolDetail(fixture.tokens.WORKER, tool.id);
 assert.ok(!('supplier_items' in worker));
 assert.equal((await service.toolDetail(fixture.tokens.PURCHASER, tool.id)).supplier_items?.length, 2);
 await assert.rejects(service.listMasters(fixture.tokens.WORKER, 'suppliers'), status(403));
 for (const bad of ['-1', '1.001', '1e2', 'NaN', '1000000000000.00', true]) {
  await assert.rejects(service.saveSupplierItem(fixture.tokens.ADMIN, tool.id, first.id, { ...input, unit_price: bad }), status(400));
 }
});

test('初期在庫を残高・履歴・監査へ同時保存し、同内容再送で増えない', async () => {
 const tool = await createTool(), shelf = await location();
 const input = { location_id: shelf.id, quantity: '12', request_key: randomUUID(), reserved: 99, actor_user_id: fixture.users.WORKER };
 const first = await service.registerInitialStock(fixture.tokens.STOCK_MANAGER, tool.id, input);
 assert.deepEqual(await service.registerInitialStock(fixture.tokens.STOCK_MANAGER, tool.id, input), first);
 const detail = await service.toolDetail(fixture.tokens.WORKER, tool.id);
 assert.equal(detail.stocks[0].on_hand, 12); assert.equal(detail.stocks[0].reserved, 0); assert.equal(detail.stocks[0].available, 12);
 const list = await service.listTools(fixture.tokens.WORKER, { q: tool.tool_code });
 assert.equal(list.tools[0].on_hand, 12);
 const history = await fixture.db.inventoryTransaction.findMany({ where: { tool_id: tool.id } });
 assert.equal(history.length, 1); assert.equal(history[0].quantity, 12); assert.equal(history[0].actor_user_id, fixture.users.STOCK_MANAGER);
 assert.equal(await fixture.db.auditLog.count({ where: { entity_id: 'phase3-initial:' + input.request_key } }), 1);
 await assert.rejects(service.updateTool(fixture.tokens.ADMIN, tool.id, { ...toolInput(), tool_code: tool.tool_code, unit: '箱', active: true }), status(409));
});

test('0の初期在庫は取引履歴を作らず登録済みになり、再送でも監査が増えない', async () => {
 const tool = await createTool(), shelf = await location();
 const input = { location_id: shelf.id, quantity: 0, request_key: randomUUID() };
 const first = await service.registerInitialStock(fixture.tokens.ADMIN, tool.id, input);
 assert.deepEqual(await service.registerInitialStock(fixture.tokens.ADMIN, tool.id, input), first);
 assert.equal(await fixture.db.inventoryTransaction.count({ where: { tool_id: tool.id } }), 0);
 assert.equal(await fixture.db.stockBalance.count({ where: { tool_id: tool.id } }), 1);
 await assert.rejects(service.registerInitialStock(fixture.tokens.ADMIN, tool.id, { ...input, request_key: randomUUID() }), status(409));
});

test('同じキーの異なる数量・工具・操作者を拒否し、別キーで既存残高も上書きしない', async () => {
 const tool = await createTool(), other = await createTool(), shelf = await location();
 const input = { location_id: shelf.id, quantity: 4, request_key: randomUUID() };
 await service.registerInitialStock(fixture.tokens.ADMIN, tool.id, input);
 await assert.rejects(service.registerInitialStock(fixture.tokens.ADMIN, tool.id, { ...input, quantity: 5 }), status(409));
 await assert.rejects(service.registerInitialStock(fixture.tokens.ADMIN, other.id, input), status(409));
 await assert.rejects(service.registerInitialStock(fixture.tokens.STOCK_MANAGER, tool.id, input), status(409));
 await assert.rejects(service.registerInitialStock(fixture.tokens.ADMIN, tool.id, { ...input, request_key: randomUUID() }), status(409));
 assert.equal((await fixture.db.stockBalance.findFirstOrThrow({ where: { tool_id: tool.id } })).on_hand, 4);
});

test('同時の同キー再送は一度だけ登録、異キーの同じ棚は片方のみ成功', async () => {
 for (const same of [true, false]) {
  const tool = await createTool(), shelf = await location();
  const input = { location_id: shelf.id, quantity: 8, request_key: randomUUID() };
  const results = await Promise.allSettled([service.registerInitialStock(fixture.tokens.ADMIN, tool.id, input), service.registerInitialStock(fixture.tokens.ADMIN, tool.id, { ...input, request_key: same ? input.request_key : randomUUID() })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, same ? 2 : 1);
  if (!same) { const failed = results.find(r => r.status === 'rejected'); assert.ok(failed && failed.status === 'rejected' && status(409)(failed.reason)); }
  assert.equal(await fixture.db.inventoryTransaction.count({ where: { tool_id: tool.id } }), 1);
 }
});

test('対象無効化後は成功済み再送だけを許可し、新規初期在庫と購買条件変更を拒否', async () => {
 const input = toolInput(), tool = await service.createTool(fixture.tokens.ADMIN, input), shelf = await location();
 const stock = { location_id: shelf.id, quantity: 3, request_key: randomUUID() };
 const first = await service.registerInitialStock(fixture.tokens.ADMIN, tool.id, stock);
 await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, active: false });
 assert.deepEqual(await service.registerInitialStock(fixture.tokens.ADMIN, tool.id, stock), first);
 await assert.rejects(service.registerInitialStock(fixture.tokens.ADMIN, tool.id, { ...stock, request_key: randomUUID() }), status(409));
});

test('初期在庫で負数・小数・boolean・空文字・指数・上限超過・不正キーを拒否', async () => {
 const tool = await createTool(), shelf = await location();
 for (const quantity of [-1, 0.5, true, '', '1e2', '2147483648']) {
  await assert.rejects(service.registerInitialStock(fixture.tokens.ADMIN, tool.id, { location_id: shelf.id, quantity, request_key: randomUUID() }), status(400));
 }
 await assert.rejects(service.registerInitialStock(fixture.tokens.ADMIN, tool.id, { location_id: shelf.id, quantity: 1, request_key: 'bad' }), status(400));
});

test('権限外の書き込みと匿名を拒否し、失効/権限喪失後は再送も拒否', async () => {
 for (const role of ['WORKER', 'PURCHASER']) await assert.rejects(service.createTool(fixture.tokens[role], toolInput()), status(403));
 await assert.rejects(service.listTools(undefined, {}), status(401));
 const employee_code = code();
 const user = await fixture.auth.createUser(fixture.tokens.ADMIN, { employee_code, name: '架空', role: 'STOCK_MANAGER', password: fixture.password });
 const token = (await fixture.auth.login(employee_code, fixture.password)).token;
 const tool = await createTool(), shelf = await location();
 const input = { location_id: shelf.id, quantity: 1, request_key: randomUUID() };
 await service.registerInitialStock(token, tool.id, input);
 await fixture.auth.updateUser(fixture.tokens.ADMIN, user.id, { name: '架空', role: 'WORKER', active: true });
 await assert.rejects(service.registerInitialStock(token, tool.id, input), status(401));
 const next = (await fixture.auth.login(employee_code, fixture.password)).token;
 await assert.rejects(service.registerInitialStock(next, tool.id, input), status(403));
});

test('監査失敗時に残高と履歴もロールバックする', async () => {
 const tool = await createTool(), shelf = await location();
 await fixture.admin.query(`CREATE FUNCTION fail_initial_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'INITIAL_STOCK_REGISTERED' THEN RAISE EXCEPTION 'test audit rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_initial_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_initial_audit()`);
 try {
  await assert.rejects(service.registerInitialStock(fixture.tokens.ADMIN, tool.id, { location_id: shelf.id, quantity: 4, request_key: randomUUID() }));
  assert.equal(await fixture.db.stockBalance.count({ where: { tool_id: tool.id } }), 0);
  assert.equal(await fixture.db.inventoryTransaction.count({ where: { tool_id: tool.id } }), 0);
 } finally { await fixture.admin.query('DROP TRIGGER reject_initial_audit ON audit_logs; DROP FUNCTION fail_initial_audit()'); }
});

test('自分のユーザー名更新とマスタ保存を同時に行ってもデッドロックしない', async () => {
 await Promise.all([
  fixture.auth.updateUser(fixture.tokens.ADMIN, fixture.users.ADMIN, { name: '架空管理者更新', role: 'ADMIN', active: true }),
  service.createTool(fixture.tokens.ADMIN, toolInput()),
 ]);
});

test('優先仕入先切り替えの両側を監査し、監査失敗では切り替え全体を戻す', async () => {
 const tool = await createTool();
 const suppliers = await Promise.all([1, 2].map(() => service.createMaster(fixture.tokens.ADMIN, 'suppliers', { supplier_code: code(), name: '架空仕入先' })));
 const input = { supplier_id: suppliers[0].id, unit_price: '10.50', order_multiple: 1, lead_time_days: 1, preferred: true };
 const first = await service.saveSupplierItem(fixture.tokens.ADMIN, tool.id, undefined, input);
 const second = await service.saveSupplierItem(fixture.tokens.ADMIN, tool.id, undefined, { ...input, supplier_id: suppliers[1].id, preferred: false });
 await service.saveSupplierItem(fixture.tokens.ADMIN, tool.id, second.id, { ...input, supplier_id: suppliers[1].id });
 const log = await fixture.db.auditLog.findFirstOrThrow({ where: { entity_id: second.id, action: 'SUPPLIER_ITEM_SAVED' }, orderBy: { created_at: 'desc' } });
 const details = log.details as unknown as { before: { preferred: boolean }; after: { preferred: boolean }; preference_changes: { before: { id: string; preferred: boolean }; after: { id: string; preferred: boolean } }[] };
 assert.equal(details.before.preferred, false); assert.equal(details.after.preferred, true);
 assert.deepEqual(details.preference_changes.map(change => ({ before: { id: change.before.id, preferred: change.before.preferred }, after: { id: change.after.id, preferred: change.after.preferred } })), [{ before: { id: first.id, preferred: true }, after: { id: first.id, preferred: false } }]);
 await fixture.admin.query("CREATE FUNCTION fail_supplier_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'SUPPLIER_ITEM_SAVED' THEN RAISE EXCEPTION 'test audit rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_supplier_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_supplier_audit()");
 try {
  await assert.rejects(service.saveSupplierItem(fixture.tokens.ADMIN, tool.id, first.id, input));
  assert.equal((await fixture.db.supplierItem.findUniqueOrThrow({ where: { id: first.id } })).preferred, false);
  assert.equal((await fixture.db.supplierItem.findUniqueOrThrow({ where: { id: second.id } })).preferred, true);
 } finally { await fixture.admin.query('DROP TRIGGER reject_supplier_audit ON audit_logs; DROP FUNCTION fail_supplier_audit()'); }
});
