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
const createTool = () => service.createTool(fixture.tokens.ADMIN_ALT, toolInput());
const location = () => service.createMaster(fixture.tokens.ADMIN, 'locations', { location_code: code(), name: '架空棚' });
before(async () => { fixture = await databaseFixture('masters_test'); service = new MastersService(fixture.db); });
after(async () => { await fixture?.close(); });

test('工具変更履歴は対象工具の実際の変更と操作者を返し単価を保護する', async () => {
 const input = { ...toolInput(), on_hand: 7, order_quantity: 3, unit_price: '123.45', shelf_code: 'A-01' };
 const tool = await service.createTool(fixture.tokens.ADMIN, input);
 assert.deepEqual(await service.toolChangeHistory(fixture.tokens.WORKER, tool.id), []);
 await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, active: true, name: '履歴テスト工具', shelf_code: 'B-02', on_hand: 9, order_quantity: 5, unit_price: '234.56' });
 const rows = await service.toolChangeHistory(fixture.tokens.ADMIN, tool.id);
 assert.ok(rows.length); assert.ok(rows.every(row => row.actor.employee_code === 'ADMIN'));
 const content = rows.flatMap(row => row.changes).join('\n');
 for (const value of ['品目名', '棚番：A-01 → B-02', '在庫：7 → 9', '発注数：3 → 5', '123.45', '234.56']) assert.ok(content.includes(value), value);
 assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].created_at >= row.created_at));
 const worker = JSON.stringify(await service.toolChangeHistory(fixture.tokens.WORKER, tool.id));
 assert.ok(!worker.includes('123.45')); assert.ok(!worker.includes('234.56')); assert.ok(!worker.includes('password_hash'));
 const count = rows.length;
 await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, active: true, name: '履歴テスト工具', shelf_code: 'B-02', on_hand: 9, order_quantity: 5, unit_price: '234.56' });
 assert.equal((await service.toolChangeHistory(fixture.tokens.ADMIN, tool.id)).length, count);
 const other = await createTool(); assert.deepEqual(await service.toolChangeHistory(fixture.tokens.ADMIN, other.id), []);
 await assert.rejects(service.toolChangeHistory(undefined, tool.id), status(401));
});

test('カテゴリーは指定された5種類のみ登録・編集でき日本語と既存コードで検索できる', async () => {
 for (const [label, category] of [['ドリル', 'DRILL'], ['エンドミル', 'END_MILL'], ['タップ', 'TAP'], ['リーマ', 'REAMER'], ['チップ', 'INSERT']]) {
  const input = { ...toolInput(), category: label };
  const tool = await service.createTool(fixture.tokens.ADMIN, input);
  assert.equal(tool.category, category);
  assert.equal((await service.listTools(fixture.tokens.WORKER, { tool_code: tool.tool_code, category: label })).total, 1);
  await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, active: true, category });
  await fixture.db.tool.update({ where: { id: tool.id }, data: { category: label } });
  assert.equal((await service.listTools(fixture.tokens.WORKER, { tool_code: tool.tool_code, category })).total, 1);
 }
 const tool = await createTool();
 for (const category of ['その他', 'DRIL', '', undefined, null, 42]) {
  await assert.rejects(service.createTool(fixture.tokens.ADMIN, { ...toolInput(), category }), status(400));
  await assert.rejects(service.updateTool(fixture.tokens.ADMIN, tool.id, { ...toolInput(), tool_code: tool.tool_code, active: true, category }), status(400));
 }
 await assert.rejects(service.listTools(fixture.tokens.WORKER, { category: 'その他' }), status(400));
 assert.ok((await service.listTools(fixture.tokens.WORKER, { category: '' })).total > 0);
});

test('部門は4種類のコードと未設定のみ保存できる', async () => {
 const tool = await createTool();
 for (const department of ['17314', '17361', '17362', '17363', '']) {
  await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...toolInput(), tool_code: tool.tool_code, department, active: true });
  assert.equal((await service.toolDetail(fixture.tokens.ADMIN, tool.id)).department, department);
 }
 for (const department of ['17360', '製造部', 17314, true]) {
  await assert.rejects(service.createTool(fixture.tokens.ADMIN, { ...toolInput(), department }), status(400));
  await assert.rejects(service.updateTool(fixture.tokens.ADMIN, tool.id, { ...toolInput(), tool_code: tool.tool_code, department, active: true }), status(400));
 }
});

test('工具情報から在庫・発注ライン・発注数を変更し履歴と権限を守る', async () => {
 const tool = await service.createTool(fixture.tokens.ADMIN, { ...toolInput(), on_hand: 7, order_quantity: 3, shelf_code: 'EDIT-01' });
 const input = { name: tool.name, category: tool.category, manufacturer: tool.manufacturer, model: tool.model, unit: tool.unit, active: true, on_hand: '11', expected_on_hand: '7', reorder_point: '4', order_quantity: '6' };
 await service.updateTool(fixture.tokens.ADMIN, tool.id, input);
 const detail = await service.toolDetail(fixture.tokens.ADMIN, tool.id);
 assert.equal(detail.on_hand, 11); assert.equal(detail.policy?.reorder_point, 4); assert.equal(detail.order_quantity, 6);
 const history = await fixture.db.inventoryTransaction.findMany({ where: { tool_id: tool.id, type: 'ADJUSTMENT' } });
 assert.equal(history.length, 1); assert.equal(history[0].quantity, 4); assert.equal(history[0].on_hand_after, 11); assert.equal(history[0].actor_user_id, fixture.users.ADMIN);
 await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, expected_on_hand: '11' });
 assert.equal(await fixture.db.inventoryTransaction.count({ where: { tool_id: tool.id } }), 2);
 assert.equal((await service.toolDetail(fixture.tokens.ADMIN, tool.id)).order_quantity, 6);
 await assert.rejects(service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, on_hand: '12' }), status(409));
 await fixture.db.stockBalance.updateMany({ where: { tool_id: tool.id }, data: { reserved: 5 } });
 await assert.rejects(service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, expected_on_hand: '11', on_hand: '4', order_quantity: '9' }), status(409));
 for (const field of ['on_hand', 'order_quantity', 'reorder_point']) await assert.rejects(service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, [field]: '-1' }), status(400));
 await assert.rejects(service.updateTool(fixture.tokens.WORKER, tool.id, input), status(409));
 const unchanged = await service.toolDetail(fixture.tokens.ADMIN, tool.id);
 assert.equal(unchanged.on_hand, 11); assert.equal(unchanged.order_quantity, 6);
 await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, expected_on_hand: '11', on_hand: '5', order_quantity: '0', reorder_point: '0' });
 const zero = await service.toolDetail(fixture.tokens.ADMIN, tool.id);
 assert.equal(zero.on_hand, 5); assert.equal(zero.order_quantity, 0); assert.equal(zero.policy?.reorder_point, 0);
});

test('棚番は工具ごとに保存し、棚マスタや残高を変えずに編集できる', async () => {
 const input = { ...toolInput(), shelf_code: '棚A-01', on_hand: 7 };
 const tool = await service.createTool(fixture.tokens.ADMIN, input);
 const detail = await service.toolDetail(fixture.tokens.ADMIN, tool.id);
 assert.equal(detail.shelf_code, '棚A-01');
 const beforeStocks = await fixture.db.stockBalance.findMany({ where: { tool_id: tool.id } });
 const beforeHistory = await fixture.db.inventoryTransaction.findMany({ where: { tool_id: tool.id } });
 const locationCount = await fixture.db.location.count();
 await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, active: true, shelf_code: '棚B-02' });
 const row = (await service.listTools(fixture.tokens.WORKER, { tool_code: tool.tool_code })).tools[0];
 assert.equal(row.shelf_code, '棚B-02'); assert.equal(row.on_hand, 7);
 assert.equal(await fixture.db.location.count(), locationCount);
 assert.deepEqual(await fixture.db.stockBalance.findMany({ where: { tool_id: tool.id } }), beforeStocks);
 assert.deepEqual(await fixture.db.inventoryTransaction.findMany({ where: { tool_id: tool.id } }), beforeHistory);
 const second = await service.createTool(fixture.tokens.ADMIN, { ...toolInput(), shelf_code: '棚B-02' });
 assert.equal((await service.toolDetail(fixture.tokens.WORKER, second.id)).shelf_code, '棚B-02');
 await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, active: true, shelf_code: '' });
 assert.equal((await service.toolDetail(fixture.tokens.WORKER, tool.id)).shelf_code, '');
 const migratedShelf = Array.from({ length: 4 }, (_, i) => String(i).repeat(32)).join(' / ');
 await fixture.db.tool.update({ where: { id: tool.id }, data: { shelf_code: migratedShelf } });
 await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, active: true, shelf_code: migratedShelf, name: '棚番を保持して名称更新' });
 assert.equal((await service.toolDetail(fixture.tokens.WORKER, tool.id)).shelf_code, migratedShelf);
});

test('一覧ラベルの項目だけで工具・部門・単価・棚在庫を一括登録し単価の閲覧権限を守る', async () => {
 const input = { tool_code: code(), name: '一覧形式の登録', category: 'DRILL', on_hand: '17', reorder_point: '5', order_quantity: '8', unit_price: '321.50', department: '17314', shelf_code: code() };
 const tool = await service.createTool(fixture.tokens.ADMIN, input);
 const row = (await service.listTools(fixture.tokens.ADMIN, { tool_code: tool.tool_code })).tools[0];
 assert.equal(row.on_hand, 17); assert.equal(row.department, '17314'); assert.equal(row.unit_price, '321.50');
 assert.equal(row.reorder_point, 5); assert.deepEqual(row.shelf_codes, [input.shelf_code]);
 assert.equal(row.on_order, 0); assert.equal(row.order_quantity, 8);
 const transactions = await fixture.db.inventoryTransaction.findMany({ where: { tool_id: tool.id } });
 assert.equal(transactions.length, 1); assert.equal(transactions[0].quantity, 17);
 assert.equal(transactions[0].actor_user_id, fixture.users.ADMIN);
 const worker = (await service.listTools(fixture.tokens.WORKER, { tool_code: tool.tool_code })).tools[0];
 assert.equal(worker.unit_price, null);
 assert.ok(!JSON.stringify(await service.toolDetail(fixture.tokens.WORKER, tool.id)).includes('321.50'));
 for (const bad of [{ ...input, tool_code: code(), shelf_code: 'a'.repeat(101) }, { ...input, tool_code: code(), unit_price: '-1' }, { ...input, tool_code: code(), order_quantity: '-1' }]) {
  await assert.rejects(service.createTool(fixture.tokens.ADMIN, bad), status(400));
  assert.equal(await fixture.db.tool.count({ where: { tool_code: bad.tool_code } }), 0);
 }
 const inactive = await location();
 assert.ok('location_code' in inactive);
 await service.updateMaster(fixture.tokens.ADMIN, 'locations', inactive.id, { name: '無効棚', active: false });
 const rejectedCode = code();
 const independent = await service.createTool(fixture.tokens.ADMIN, { ...input, tool_code: rejectedCode, shelf_code: inactive.location_code });
 assert.equal((await service.toolDetail(fixture.tokens.ADMIN, independent.id)).shelf_code, inactive.location_code);
});

test('工具コードを正規化し方針と監査を保存、正規化後の重複を拒否', async () => {
 const input = { ...toolInput(), tool_code: ' lower-code ' };
 const tool = await service.createTool(fixture.tokens.ADMIN_ALT, input);
 assert.equal(tool.tool_code, 'LOWER-CODE');
 const detail = await service.toolDetail(fixture.tokens.ADMIN, tool.id);
 assert.equal(detail.policy?.reorder_point, 5);
 assert.equal(await fixture.db.auditLog.count({ where: { entity_id: tool.id, action: 'TOOL_CREATED' } }), 1);
 await assert.rejects(service.createTool(fixture.tokens.ADMIN, input), status(409));
});

test('storage locations remain editable while retired master kinds reject all operations',async()=>{
 const input={location_code:code(),name:'shelf'};const master=await service.createMaster(fixture.tokens.ADMIN,'locations',input);await assert.rejects(service.createMaster(fixture.tokens.ADMIN,'locations',input),status(409));assert.equal((await service.updateMaster(fixture.tokens.ADMIN,'locations',master.id,{name:'updated',active:false})).active,false);await assert.rejects(service.updateMaster(fixture.tokens.ADMIN,'locations',master.id,{...input,location_code:'OTHER',active:true}),status(400));
 for(const kind of ['machines','suppliers']){await assert.rejects(service.listMasters(fixture.tokens.ADMIN,kind),status(404));await assert.rejects(service.createMaster(fixture.tokens.ADMIN,kind,{name:'retired'}),status(404));await assert.rejects(service.updateMaster(fixture.tokens.ADMIN,kind,master.id,{name:'retired'}),status(404));}
 await assert.rejects(service.listMasters(fixture.tokens.ADMIN,'users'),status(400));
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

test('工具の品目コード・品目名のみを検索し、分類・状態絞込、ページングと棚集計', async () => {
 const input = { ...toolInput(), name: '検索専用エンドミル', model: 'Unique-Model-X' };
 const tool = await service.createTool(fixture.tokens.ADMIN, input);
 for (const q of [input.tool_code.toLowerCase(), '検索専用']) {
  const list = await service.listTools(fixture.tokens.WORKER, { q, category: 'DRILL' });
  assert.equal(list.total, 1); assert.equal(list.tools[0].id, tool.id);
 }
 assert.equal((await service.listTools(fixture.tokens.WORKER, { q: 'unique-model-x' })).total, 0);
 for (const query of [{ tool_code: input.tool_code.toLowerCase() }, { name: '検索専用' }, { tool_code: input.tool_code, name: 'エンドミル' }]) {
  const list = await service.listTools(fixture.tokens.WORKER, query);
  assert.equal(list.total, 1); assert.equal(list.tools[0].id, tool.id);
 }
 for (const query of [{ tool_code: input.tool_code, name: '該当なし' }, { tool_code: '検索専用' }, { name: input.tool_code }]) {
  assert.equal((await service.listTools(fixture.tokens.WORKER, query)).total, 0);
 }
 assert.equal((await service.listTools(fixture.tokens.WORKER, { q: input.tool_code, page: '999' })).tools.length, 0);
 await assert.rejects(service.listTools(fixture.tokens.ADMIN, { page: '1.5' }), status(400));
 await assert.rejects(service.listTools(fixture.tokens.ADMIN, { status: 'oops' }), status(400));
 await service.updateTool(fixture.tokens.ADMIN, tool.id, { ...input, active: false });
 assert.equal((await service.listTools(fixture.tokens.ADMIN, { q: input.tool_code })).total, 0);
 assert.equal((await service.listTools(fixture.tokens.ADMIN, { q: input.tool_code, status: 'inactive' })).total, 1);
});

test('tool price takes precedence over historical supplier price without exposing suppliers',async()=>{
 const tool=await createTool();const supplier=await fixture.db.supplier.create({data:{supplier_code:code(),name:'legacy supplier'}});await fixture.db.supplierItem.create({data:{tool_id:tool.id,supplier_id:supplier.id,unit_price:'25.50',order_multiple:1,lead_time_days:1,preferred:true}});
 assert.equal((await service.listTools(fixture.tokens.ADMIN,{q:tool.tool_code})).tools[0].unit_price,'25.50');
 await fixture.db.tool.update({where:{id:tool.id},data:{unit_price:'12.25'}});assert.equal((await service.listTools(fixture.tokens.ADMIN,{q:tool.tool_code})).tools[0].unit_price,'12.25');
 for(const role of ['WORKER','ADMIN'])assert.ok(!('supplier_items' in await service.toolDetail(fixture.tokens[role],tool.id)));assert.ok(!('saveSupplierItem' in service));
 assert.equal((await service.listTools(fixture.tokens.WORKER,{q:tool.tool_code})).tools[0].unit_price,null);
});

test('一覧に棚番・発注点・発注残・候補数・優先単価を集計し単価の権限を守る', async () => {
 const tool = await createTool(), shelf = await location();
 assert.ok('location_code' in shelf);
 await service.registerInitialStock(fixture.tokens.ADMIN, tool.id, { location_id: shelf.id, quantity: 12, request_key: randomUUID() });
 const supplier = await fixture.db.supplier.create({data:{supplier_code:code(),name:'historical supplier'}});
 await fixture.db.supplierItem.create({data:{tool_id:tool.id,supplier_id:supplier.id,unit_price:'1234.50',order_multiple:1,lead_time_days:3,preferred:true}});
 for (const [status, ordered_quantity, received_quantity] of [['ORDERED', 10, 0], ['PARTIALLY_RECEIVED', 8, 3], ['CANCELLED', 99, 0], ['DRAFT', 99, 0], ['RECEIVED', 4, 4]] as const) {
  await fixture.db.purchaseOrder.create({ data: { order_no: code(), supplier_id: supplier.id, status, requested_by: fixture.users.ADMIN, purchase_order_items_order_id_children: { create: { tool_id: tool.id, ordered_quantity, received_quantity, unit_price: '1234.50', supplier_model: '', order_multiple: 1, lead_time_days: 3 } } } });
 }
 await fixture.db.reorderCandidate.createMany({ data: [{ tool_id: tool.id, status: 'OPEN', quantity: 8 }, { tool_id: tool.id, status: 'DISMISSED', quantity: 99 }] });
 const row = (await service.listTools(fixture.tokens.ADMIN, { q: tool.tool_code })).tools[0];
 assert.equal(row.on_hand, 12);
 assert.equal(row.shelf_code, '');
 assert.deepEqual(row.shelf_codes, []);
 assert.equal(row.reorder_point, 5);
 assert.equal(row.on_order, 15);
 assert.equal(row.order_quantity, 8);
 assert.equal(row.unit_price, '1234.50');
 const worker = (await service.listTools(fixture.tokens.WORKER, { q: tool.tool_code })).tools[0];
 assert.equal(worker.unit_price, null);
 const empty = await createTool();
 const emptyRow = (await service.listTools(fixture.tokens.ADMIN, { q: empty.tool_code })).tools[0];
 assert.deepEqual(emptyRow.shelf_codes, []);
 assert.equal(emptyRow.on_order, 0);
 assert.equal(emptyRow.order_quantity, 0);
 assert.equal(emptyRow.unit_price, null);
});

test('初期在庫を残高・履歴・監査へ同時保存し、同内容再送で増えない', async () => {
 const tool = await createTool(), shelf = await location();
 const input = { location_id: shelf.id, quantity: '12', request_key: randomUUID(), reserved: 99, actor_user_id: fixture.users.WORKER };
 const first = await service.registerInitialStock(fixture.tokens.ADMIN_ALT, tool.id, input);
 assert.deepEqual(await service.registerInitialStock(fixture.tokens.ADMIN_ALT, tool.id, input), first);
 const detail = await service.toolDetail(fixture.tokens.WORKER, tool.id);
 assert.equal(detail.stocks[0].on_hand, 12); assert.equal(detail.stocks[0].reserved, 0); assert.equal(detail.stocks[0].available, 12);
 const list = await service.listTools(fixture.tokens.WORKER, { q: tool.tool_code });
 assert.equal(list.tools[0].on_hand, 12);
 const history = await fixture.db.inventoryTransaction.findMany({ where: { tool_id: tool.id } });
 assert.equal(history.length, 1); assert.equal(history[0].quantity, 12); assert.equal(history[0].actor_user_id, fixture.users.ADMIN_ALT);
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
 await assert.rejects(service.registerInitialStock(fixture.tokens.ADMIN_ALT, tool.id, input), status(409));
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
 const existing = await createTool();
 await assert.rejects(service.updateTool(undefined, existing.id, { ...toolInput(), active: true }), status(401));
 await assert.rejects(service.listTools(undefined, {}), status(401));
 const employee_code = code();
 const user = await fixture.auth.createUser(fixture.tokens.ADMIN, { employee_code, name: '架空', role: 'ADMIN', password: fixture.password });
 const token = (await fixture.auth.login(employee_code, fixture.password)).token;
 const tool = await createTool(), shelf = await location();
 const input = { location_id: shelf.id, quantity: 1, request_key: randomUUID() };
 await service.registerInitialStock(token, tool.id, input);
 await fixture.auth.updateUser(fixture.tokens.ADMIN, user.id, { name: '架空', role: 'WORKER', active: true });
 await assert.rejects(service.registerInitialStock(token, tool.id, input), status(401));
 const next = (await fixture.auth.login(employee_code, fixture.password)).token;
 await assert.rejects(service.registerInitialStock(next, tool.id, input), status(403));
});

test('作業者が初期在庫・発注数を含む工具登録を実行できる', async () => {
 const input = { ...toolInput(), on_hand: 9, order_quantity: 4, shelf_code: 'WORKER-SHELF', unit_price: '123.45' };
 const tool = await service.createTool(fixture.tokens.WORKER, input);
 const detail = await service.toolDetail(fixture.tokens.ADMIN, tool.id);
 assert.equal(detail.on_hand, 9); assert.equal(detail.order_quantity, 4); assert.equal(detail.shelf_code, input.shelf_code); assert.equal(detail.unit_price, input.unit_price);
 const audit = await fixture.db.auditLog.findFirstOrThrow({ where: { entity_id: tool.id, action: 'TOOL_CREATED' } });
 assert.equal(audit.actor_user_id, fixture.users.WORKER);
 const transaction = await fixture.db.inventoryTransaction.findFirstOrThrow({ where: { tool_id: tool.id } });
 assert.equal(transaction.actor_user_id, fixture.users.WORKER); assert.equal(transaction.quantity, 9);
 await assert.rejects(service.createTool(undefined, { ...input, tool_code: code() }), status(401));
 const {unit_price, ...workerInput}=input;
 await service.updateTool(fixture.tokens.WORKER, tool.id, { ...workerInput, active: true, name: '作業者による変更', on_hand: 11, expected_on_hand: 9, order_quantity: 6 });
 const updated=await service.toolDetail(fixture.tokens.ADMIN,tool.id);
 assert.equal(updated.name,'作業者による変更');assert.equal(updated.on_hand,11);assert.equal(updated.order_quantity,6);assert.equal(updated.unit_price,unit_price);
 const changed=await fixture.db.auditLog.findFirstOrThrow({where:{entity_id:tool.id,action:'TOOL_UPDATED'}});
 assert.equal(changed.actor_user_id,fixture.users.WORKER);
 assert.ok(!('unit_price' in await service.toolDetail(fixture.tokens.WORKER, tool.id)));
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
