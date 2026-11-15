import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

const migration = '20261115020000_cleanup_unused_schema';
async function isolated(run: (db: pg.Client, schema: string) => Promise<void>) {
 const url = process.env.TEST_DATABASE_URL; assert.ok(url); assert.match(new URL(url).pathname, /test/i);
 const db = new pg.Client({ connectionString: url }), schema = 'current_cleanup_' + randomUUID().replaceAll('-', '');
 await db.connect();
 try {
  await db.query('CREATE SCHEMA ' + schema); await db.query('SET search_path TO ' + schema);
  for (const name of (await readdir('prisma/migrations')).filter(name => /^\d/.test(name) && name < migration).sort()) await db.query(await readFile('prisma/migrations/' + name + '/migration.sql', 'utf8'));
  await run(db, schema);
 } finally { await db.query('ROLLBACK'); await db.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await db.end(); }
}
const apply = async (db: pg.Client) => db.query(await readFile('prisma/migrations/' + migration + '/migration.sql', 'utf8'));

test('不要な購買テーブル・在庫方針列を退避して削除し、未入庫数と現行データを保持する', async () => {
 await isolated(async (db, schema) => {
  const user=randomUUID(),tool=randomUUID(),location=randomUUID(),supplier=randomUUID();
  await db.query("INSERT INTO users(id,employee_code,name,role,password_hash,updated_at) VALUES($1,'CLEANUP','検証','ADMIN','preserve-hash',now())",[user]);
  await db.query("INSERT INTO tools(id,tool_code,name,category,unit_price,units_per_order,updated_at) VALUES($1,'CLEANUP','検証','DRILL',5000,10,now())",[tool]);
  await db.query("INSERT INTO locations(id,location_code,name,updated_at) VALUES($1,'CLEANUP','検証',now())",[location]);
  await db.query('INSERT INTO stock_balances(id,tool_id,location_id,on_hand,reserved,updated_at) VALUES($1,$2,$3,20,2,now())',[randomUUID(),tool,location]);
  await db.query('INSERT INTO inventory_policies(id,tool_id,safety_stock,reorder_point,target_stock,updated_at) VALUES($1,$2,2,5,20,now())',[randomUUID(),tool]);
  await db.query("INSERT INTO inventory_transactions(id,tool_id,location_id,actor_user_id,type,quantity,unit_price,amount,idempotency_key,updated_at) VALUES($1,$2,$3,$4,'RECEIVE',20,500,10000,'cleanup-history',now())",[randomUUID(),tool,location,user]);
  await db.query("INSERT INTO suppliers(id,supplier_code,name,updated_at) VALUES($1,'CLEANUP','旧仕入先',now())",[supplier]);
  for (const [status,quantity,received] of [['ORDERED',10,2],['PARTIALLY_RECEIVED',8,3],['RECEIVED',6,6],['CANCELLED',99,0],['DRAFT',99,0]] as const) {
   const order=randomUUID();
   await db.query('INSERT INTO purchase_orders(id,order_no,supplier_id,status,requested_by,updated_at) VALUES($1,$2,$3,$4,$5,now())',[order,status,supplier,status,user]);
   await db.query("INSERT INTO purchase_order_items(id,order_id,tool_id,ordered_quantity,received_quantity,unit_price,supplier_model,order_multiple,lead_time_days,updated_at) VALUES($1,$2,$3,$4,$5,125.50,'旧型番',1,2,now())",[randomUUID(),order,tool,quantity,received]);
  }
  await db.query('INSERT INTO tool_orders(id,tool_id,created_by,request_key,order_quantity,units_per_order,stock_quantity,received_quantity,updated_at) VALUES($1,$2,$3,$4,2,10,20,3,now())',[randomUUID(),tool,user,randomUUID()]);
  const snapshot=async()=>{
   const result:Record<string,unknown>={};
   for(const table of ['users','tools','locations','stock_balances','inventory_transactions'])result[table]=(await db.query('SELECT to_jsonb(t) AS row FROM '+table+' t ORDER BY id')).rows;
   return result;
  };
  const before=await snapshot();
  const existingOrders=(await db.query('SELECT * FROM tool_orders')).rows;
  await apply(db);
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual((await db.query('SELECT * FROM tool_orders WHERE id=$1',[existingOrders[0].id])).rows,existingOrders);
  assert.equal((await db.query('SELECT sum(stock_quantity-received_quantity-cancelled_quantity)::int AS pending FROM tool_orders')).rows[0].pending,30);
  const converted=(await db.query("SELECT units_per_order,purchase_unit_price FROM tool_orders WHERE request_key LIKE 'legacy-purchase-item:%'")).rows;
  assert.equal(converted.length,2);assert.ok(converted.every(row=>row.units_per_order===1&&row.purchase_unit_price==='125.50'));
  assert.deepEqual((await db.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename IN ('suppliers','purchase_orders','purchase_order_items')",[schema])).rows,[]);
  assert.deepEqual((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='inventory_policies' AND column_name IN ('safety_stock','target_stock')",[schema])).rows,[]);
  const archived=(await db.query("SELECT details FROM audit_logs WHERE action='PROJECT_SCHEMA_CLEANUP'")).rows[0].details;
  assert.equal(archived.suppliers[0].id,supplier);assert.equal(archived.purchase_orders.length,5);assert.equal(archived.purchase_order_items.length,5);
  assert.equal(archived.inventory_policies[0].safety_stock,2);assert.equal(archived.inventory_policies[0].target_stock,20);
  await assert.rejects(db.query('UPDATE inventory_policies SET reorder_point=-1'));
  await assert.rejects(db.query('UPDATE inventory_transactions SET amount=0'));
  await assert.rejects(db.query('DELETE FROM audit_logs'));
 });
});

test('整理移行は空DBにも適用でき、退避する利用者がいなければ元データを保持する',async()=>{
 await isolated(async db=>{await apply(db);assert.equal((await db.query('SELECT count(*) FROM tools')).rows[0].count,'0');});
 await isolated(async db=>{
  await db.query("INSERT INTO suppliers(id,supplier_code,name,updated_at) VALUES($1,'KEEP','退避対象',now())",[randomUUID()]);
  await assert.rejects(apply(db),/existing user/);await db.query('ROLLBACK');
  assert.equal((await db.query('SELECT count(*) FROM suppliers')).rows[0].count,'1');
 });
});
