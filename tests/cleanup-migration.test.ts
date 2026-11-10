import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

const migration = '20261110000000_remove_unused_legacy';
async function isolated(run: (db: pg.Client, schema: string) => Promise<void>) {
 const url = process.env.TEST_DATABASE_URL; assert.ok(url); assert.match(new URL(url).pathname, /test/i);
 const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 }), schema = 'cleanup_' + randomUUID().replaceAll('-', '');
 await db.connect();
 try {
  await db.query('CREATE SCHEMA ' + schema); await db.query('SET search_path TO ' + schema);
  for (const name of (await readdir('prisma/migrations')).filter(name => /^\d/.test(name) && name < migration).sort()) await db.query(await readFile('prisma/migrations/' + name + '/migration.sql', 'utf8'));
  await run(db, schema);
 } finally { await db.query('ROLLBACK'); await db.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await db.end(); }
}
const apply = async (db: pg.Client) => db.query(await readFile('prisma/migrations/' + migration + '/migration.sql', 'utf8'));

test('旧設備・仕入条件と未使用列を除去し、単価・在庫・履歴・発注・資格情報を保持する', async () => {
 await isolated(async (db, schema) => {
  const user = randomUUID(), supplier = randomUUID(), machine = randomUUID(), location = randomUUID();
  await db.query("INSERT INTO users(id,employee_code,name,role,password_hash,updated_at) VALUES($1,'CLEANUP','責任者','ADMIN','keep-hash',now())", [user]);
  await db.query("INSERT INTO sessions(token_hash,user_id,last_seen_at,expires_at) VALUES('keep-session',$1,now(),now()+interval '1 hour')", [user]);
  await db.query("INSERT INTO suppliers(id,supplier_code,name,updated_at) VALUES($1,'LEGACY','仕入先',now())", [supplier]);
  await db.query("INSERT INTO machines(id,machine_code,name,updated_at) VALUES($1,'LEGACY','旧設備',now())", [machine]);
  await db.query("INSERT INTO locations(id,location_code,name,updated_at) VALUES($1,'SHELF','棚',now())", [location]);
  const tools = [randomUUID(), randomUUID(), randomUUID()];
  for (let index = 0; index < tools.length; index++) {
   await db.query("INSERT INTO tools(id,tool_code,name,category,manufacturer,model,unit,unit_price,updated_at) VALUES($1,$2,'工具','DRILL','旧メーカー','旧型番','本',$3,now())", [tools[index], 'T' + index, index === 1 ? '0.00' : null]);
   await db.query('INSERT INTO supplier_items(id,tool_id,supplier_id,unit_price,order_multiple,lead_time_days,preferred,updated_at) VALUES($1,$2,$3,25.50,1,2,$4,now())', [randomUUID(), tools[index], supplier, index !== 2]);
  }
  await db.query('INSERT INTO stock_balances(id,tool_id,location_id,on_hand,reserved,updated_at) VALUES($1,$2,$3,12,2,now())', [randomUUID(), tools[0], location]);
  const history = randomUUID();
  await db.query("INSERT INTO inventory_transactions(id,tool_id,location_id,actor_user_id,machine_id,type,quantity,idempotency_key,on_hand_after,unit_price,updated_at) VALUES($1,$2,$3,$4,$5,'ISSUE',-2,'keep-replay',12,10.00,now())", [history, tools[0], location, user, machine]);
  await db.query("INSERT INTO purchase_orders(id,order_no,supplier_id,status,requested_by,updated_at) VALUES($1,'KEEP-ORDER',$2,'ORDERED',$3,now())", [randomUUID(), supplier, user]);
  const retained = async () => ({ users: (await db.query('SELECT * FROM users')).rows, sessions: (await db.query('SELECT * FROM sessions')).rows, stocks: (await db.query('SELECT * FROM stock_balances')).rows, orders: (await db.query('SELECT * FROM purchase_orders')).rows, history: (await db.query("SELECT to_jsonb(t)-'machine_id' AS value FROM inventory_transactions t")).rows });
  const before = await retained();
  await apply(db);
  assert.deepEqual(await retained(), before);
  assert.deepEqual((await db.query('SELECT unit_price FROM tools ORDER BY tool_code')).rows.map(row => row.unit_price), ['25.50', '0.00', null]);
  assert.equal((await db.query('SELECT unit FROM tools WHERE id=$1', [tools[0]])).rows[0].unit, '本');
  const tables = (await db.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema])).rows.map(row => row.tablename);
  assert.ok(!tables.includes('machines')); assert.ok(!tables.includes('supplier_items')); assert.ok(tables.includes('suppliers')); assert.ok(tables.includes('purchase_orders'));
  const columns = (await db.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND (table_name='tools' OR table_name='inventory_transactions')", [schema])).rows;
  assert.ok(!columns.some(row => ['manufacturer', 'model', 'machine_id'].includes(row.column_name)));
  const archive = (await db.query("SELECT details FROM audit_logs WHERE action='LEGACY_SCHEMA_ARCHIVED'")).rows[0].details;
  assert.equal(archive.machines[0].id, machine); assert.equal(archive.supplier_items.length, 3);
  assert.equal(archive.tools[0].manufacturer, '旧メーカー'); assert.equal(archive.transaction_equipment[0].machine_id, machine);
  await assert.rejects(db.query('UPDATE inventory_transactions SET quantity=-1'), (error: unknown) => (error as { code: string }).code === 'P0001');
  await assert.rejects(db.query("DELETE FROM audit_logs"), (error: unknown) => (error as { code: string }).code === 'P0001');
 });
});

test('空のDBでも適用でき、退避するデータに操作者がいない場合は削除せず拒否する', async () => {
 await isolated(async db => { await apply(db); assert.equal((await db.query('SELECT count(*) FROM tools')).rows[0].count, '0'); });
 await isolated(async db => {
  await db.query("INSERT INTO machines(id,machine_code,name,updated_at) VALUES($1,'KEEP','退避対象',now())", [randomUUID()]);
  await assert.rejects(apply(db), (error: unknown) => (error as { code: string }).code === 'P0001');
  await db.query('ROLLBACK');
  assert.equal((await db.query('SELECT count(*) FROM machines')).rows[0].count, '1');
 });
});
