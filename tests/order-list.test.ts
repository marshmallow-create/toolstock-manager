import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { databaseFixture } from './helpers/database';
import { MastersService } from '../src/lib/masters/service';
import { InventoryService } from '../src/lib/inventory/service';
import { AuthError } from '../src/lib/auth/service';
import { listOrders } from '../src/lib/orders/list';

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
test('作業者も発注リストを取り消せて、発注せず一覧から除外し再送しても新しい行を消さない',async()=>{
 const {cancelOrderListEntry}=await import('../src/lib/orders/write');
 const s=await stock(10,20);await inventory.issue(token(),input(s));
 const queued=await entry(s);assert.ok(queued);
 const req={tool_id:s.tool.id,entry_id:queued.id,request_key:randomUUID()};
 await assert.rejects(cancelOrderListEntry(f.db,f.auth,undefined,req),(e:unknown)=>e instanceof AuthError&&e.status===401);
 await cancelOrderListEntry(f.db,f.auth,token('WORKER'),req);
 assert.equal(await entry(s),null);
 assert.equal(await f.db.toolOrder.count({where:{tool_id:s.tool.id}}),0);
 assert.equal((await masters.toolDetail(token(),s.tool.id)).order_quantity,7);
 await inventory.issue(token(),input(s));const next=await entry(s);assert.ok(next);
 await cancelOrderListEntry(f.db,f.auth,token('WORKER'),req);
 assert.deepEqual(await entry(s),next);
 assert.equal(await f.db.auditLog.count({where:{action:'ORDER_LIST_CANCELLED',entity_id:'order-list-cancel:'+req.request_key}}),1);
});
const input = (s: Stock, quantity = 1) => ({ tool_id: s.tool.id, location_id: s.location_id, quantity, request_key: randomUUID() });
const entry = (s: Stock) => f.db.orderListEntry.findUnique({ where: { tool_id: s.tool.id } });
async function order(s: Stock, quantity: number, received_quantity = 0, cancelled_quantity = 0) {
 return f.db.toolOrder.create({ data: {tool_id:s.tool.id,created_by:f.users.ADMIN,request_key:randomUUID(),order_quantity:quantity,units_per_order:1,stock_quantity:quantity,received_quantity,cancelled_quantity,purchase_unit_price:'1'} });
}

test('出庫後の全棚合計と発注残の合計が発注ラインを厳密に下回る場合だけ登録する', async () => {
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

test('発注残は各発注の未入庫数を合計し、入庫済み・取消済みを除く', async () => {
 const s = await stock(4, 12);
 await order(s, 5, 1); // 4 remaining.
 await order(s, 8, 3); // 5 remaining; total on order = 9.
 await order(s, 8, 8); // Fully received items add zero.
 await order(s, 100, 0, 100); // Fully cancelled items add zero.
 await inventory.issue(token('WORKER'), input(s));
 assert.equal(await entry(s), null); // Stock 3 + on order 9 == reorder point 12.
 const issued = await inventory.issue(token('WORKER'), input(s));
 assert.equal((await entry(s))?.trigger_transaction_id, issued.id);
});

test('発注済みの未入庫数を在庫に加算し入庫後も合計が発注ライン未満の出庫だけを掲載する',async()=>{
 const {registerOrder}=await import('../src/lib/orders/write');
 const s=await stock(10,10);
 await masters.updateTool(token(),s.tool.id,{name:s.tool.name,category:s.tool.category,active:true,reorder_point:10,units_per_order:5});
 await inventory.issue(token(),input(s));const queued=await entry(s);assert.ok(queued);
 await registerOrder(f.db,f.auth,token(),{tool_id:s.tool.id,entry_id:queued.id,quantity:2,expected_units_per_order:5,request_key:randomUUID()});
 await inventory.issue(token(),input(s,5));assert.equal(await entry(s),null); // 4 + 10 > 10.
 await inventory.receive(token(),input(s,4));
 await inventory.issue(token(),input(s,4));assert.equal(await entry(s),null); // 4 + 6 == 10.
 const issued=await inventory.issue(token(),input(s)); // 3 + 6 < 10.
 assert.equal((await entry(s))?.trigger_transaction_id,issued.id);
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
 await masters.updateTool(token(), s.tool.id, { name: s.tool.name, category: s.tool.category, active: true, on_hand: 1, expected_on_hand: 11, reorder_point: 20 });
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

test('箱発注を在庫単位で集計し部分入庫・再送・取消を一体管理する',async()=>{
 const {registerOrder,cancelOrder}=await import('../src/lib/orders/write');
 const s=await stock(20,30);
 await masters.updateTool(token(),s.tool.id,{name:s.tool.name,category:s.tool.category,active:true,reorder_point:30,order_unit:'箱',units_per_order:10,unit_price:'5000'});
 await inventory.issue(token(),input(s));
 const queued=await entry(s);assert.ok(queued);
 const req={tool_id:s.tool.id,entry_id:queued.id,quantity:2,expected_units_per_order:10,request_key:randomUUID()};
 const placed=await registerOrder(f.db,f.auth,token('WORKER'),req);
 assert.equal((await f.db.toolOrder.findUniqueOrThrow({where:{id:placed.id}})).created_by,f.users.WORKER);
 assert.equal(placed.stock_quantity,20);assert.equal(await entry(s),null);
 assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,20);
 assert.deepEqual(await registerOrder(f.db,f.auth,token('WORKER'),req),placed);
 await assert.rejects(registerOrder(f.db,f.auth,token('WORKER'),{...req,quantity:3}),(e:unknown)=>e instanceof AuthError&&e.status===409);
 await masters.updateTool(token(),s.tool.id,{name:s.tool.name,category:s.tool.category,active:true,reorder_point:30,units_per_order:3,unit_price:'1000'});
 const receiptReq={...input(s),quantity_unit:'order',tool_order_id:placed.id};
 const receipt=await inventory.receive(token('WORKER'),receiptReq);
 assert.equal(receipt.quantity,10);assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,10);
 assert.deepEqual(await inventory.receive(token('WORKER'),receiptReq),receipt);
 const partial=await inventory.receive(token(),{...input(s,3),tool_order_id:placed.id});
 assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,7);
 await assert.rejects(inventory.receive(token(),{...input(s,8),tool_order_id:placed.id}),(e:unknown)=>e instanceof AuthError&&e.status===409);
 const cancelReq={request_key:randomUUID()};
 await cancelOrder(f.db,f.auth,token(),placed.id,cancelReq);
 assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,0);
 await inventory.reverse(token(),{transaction_id:partial.id,request_key:randomUUID()});
 assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,3);
 await cancelOrder(f.db,f.auth,token(),placed.id,cancelReq); // Replay must not cancel the reopened receipt.
 assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,3);
});

test('紐付入庫の競合・監査失敗・誤工具では発注残と在庫を二重更新しない',async()=>{
 const {registerOrder}=await import('../src/lib/orders/write');const s=await stock(5,30);await inventory.issue(token(),input(s));
 const queued=await entry(s);assert.ok(queued);
 const order=await registerOrder(f.db,f.auth,token(),{tool_id:s.tool.id,entry_id:queued.id,quantity:1,expected_units_per_order:1,request_key:randomUUID()});
 const receipt={...input(s),tool_order_id:order.id};
 const other=await stock();await assert.rejects(inventory.receive(token(),{...input(other),tool_order_id:order.id}),(e:unknown)=>e instanceof AuthError&&e.status===409);
 const results=await Promise.allSettled([inventory.receive(token(),receipt),inventory.receive(token('WORKER'),{...receipt,request_key:randomUUID()})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,0);
 const fulfilled=results.find(r=>r.status==='fulfilled');assert.ok(fulfilled?.status==='fulfilled');
 await inventory.reverse(token(),{transaction_id:fulfilled.value.id,request_key:randomUUID()});
 await f.admin.query("CREATE FUNCTION fail_linked_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='INVENTORY_MUTATION' THEN RAISE EXCEPTION 'test receipt rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_linked_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_linked_audit()");
 const before=await masters.toolDetail(token(),s.tool.id);
 try{await assert.rejects(inventory.receive(token(),{...receipt,request_key:randomUUID()}));assert.equal((await masters.toolDetail(token(),s.tool.id)).on_hand,before.on_hand);assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,1);}finally{await f.admin.query('DROP TRIGGER reject_linked_audit ON audit_logs; DROP FUNCTION fail_linked_audit()');}
});

test('発注登録の工具ロック待ちは再試行可能な409を返す',async()=>{
 const {registerOrder}=await import('../src/lib/orders/write');const s=await stock(5,30);await inventory.issue(token(),input(s));const queued=await entry(s);assert.ok(queued);
 await f.admin.query('BEGIN');await f.admin.query('SELECT id FROM tools WHERE id=$1 FOR UPDATE',[s.tool.id]);
 try{await assert.rejects(registerOrder(f.db,f.auth,token(),{tool_id:s.tool.id,entry_id:queued.id,quantity:1,expected_units_per_order:1,request_key:randomUUID()}),(e:unknown)=>e instanceof AuthError&&e.status===409);}finally{await f.admin.query('ROLLBACK');}
});

test('通常入庫は古い発注から未入庫数を減らし、分割・超過・再送・取消を整合させる',async()=>{
 const {registerOrder}=await import('../src/lib/orders/write');
 const s=await stock(20,30);
 const placed=[];
 for(const quantity of [5,7]){
  await inventory.issue(token(),input(s));const queued=await entry(s);assert.ok(queued);
  placed.push(await registerOrder(f.db,f.auth,token(),{tool_id:s.tool.id,entry_id:queued.id,quantity,expected_units_per_order:1,request_key:randomUUID()}));
 }
 const req=input(s,8),receipt=await inventory.receive(token('WORKER'),req);
 assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,4);
 assert.equal((await f.db.toolOrder.findUniqueOrThrow({where:{id:placed[0].id}})).received_quantity,5);
 assert.equal((await f.db.toolOrder.findUniqueOrThrow({where:{id:placed[1].id}})).received_quantity,3);
 assert.deepEqual(await inventory.receive(token('WORKER'),req),receipt);
 assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,4);
 const extra=await inventory.receive(token(),input(s,10));
 assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,0);
 await inventory.reverse(token(),{transaction_id:receipt.id,request_key:randomUUID()});
 assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,8);
 await inventory.reverse(token(),{transaction_id:extra.id,request_key:randomUUID()});
 assert.equal((await masters.toolDetail(token(),s.tool.id)).on_order,12);
});
