import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

const migration = '20261105010000_two_roles';
async function isolatedSchema(run: (client: pg.Client, schema: string) => Promise<void>) {
 const url = process.env.TEST_DATABASE_URL;
 assert.ok(url); assert.match(new URL(url).pathname, /test/i);
 const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
 const schema = 'roles_test_' + randomUUID().replaceAll('-', '');
 await client.connect();
 try {
  await client.query('CREATE SCHEMA ' + schema);
  await client.query('SET search_path TO ' + schema);
  await run(client, schema);
 } finally {
  await client.query('ROLLBACK');
  await client.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  await client.end();
 }
}
async function apply(client: pg.Client, name: string) {
 await client.query(await readFile('prisma/migrations/' + name + '/migration.sql', 'utf8'));
}
async function enumLabels(client: pg.Client, schema: string) {
 return (await client.query(`SELECT enumlabel FROM pg_enum JOIN pg_type ON enumtypid=pg_type.oid JOIN pg_namespace ON typnamespace=pg_namespace.oid WHERE typname='Role' AND nspname=$1 ORDER BY enumsortorder`, [schema])).rows.map(row => row.enumlabel);
}

test('既存4ロールの移行は権限を縮小し、本人情報・在庫履歴を維持して旧セッションだけを失効する', async () => {
 await isolatedSchema(async (client, schema) => {
  const names = (await readdir('prisma/migrations')).filter(name => /^\d/.test(name)).sort();
  for (const name of names.filter(name => name < migration)) await apply(client, name);
  const users = ['WORKER', 'STOCK_MANAGER', 'PURCHASER', 'ADMIN'].map((role, index) => ({ id: randomUUID(), role, active: index !== 2, password_hash: 'preserved-hash-' + index }));
  for (const user of users) {
   await client.query('INSERT INTO users(id,employee_code,name,role,active,password_hash,updated_at) VALUES($1,$2,$2,$2::text::"Role",$3,$4,now())', [user.id, user.role, user.active, user.password_hash]);
   await client.query("INSERT INTO sessions(token_hash,user_id,last_seen_at,expires_at) VALUES($1,$2,now(),now()+interval '1 hour')", ['session-' + user.role, user.id]);
  }
  const tool = randomUUID(), location = randomUUID(), transaction = randomUUID(), order = randomUUID(), supplier = randomUUID();
  await client.query("INSERT INTO tools(id,tool_code,name,category,manufacturer,model,unit,updated_at) VALUES($1,'MIGRATE','工具','DRILL','','','本',now())", [tool]);
  await client.query("INSERT INTO locations(id,location_code,name,updated_at) VALUES($1,'MIGRATE','棚',now())", [location]);
  await client.query('INSERT INTO stock_balances(id,tool_id,location_id,on_hand,reserved,updated_at) VALUES($1,$2,$3,7,2,now())', [randomUUID(), tool, location]);
  await client.query("INSERT INTO inventory_transactions(id,tool_id,location_id,actor_user_id,type,quantity,idempotency_key,updated_at) VALUES($1,$2,$3,$4,'RECEIVE',7,'migrated-history',now())", [transaction, tool, location, users[1].id]);
  await client.query("INSERT INTO suppliers(id,supplier_code,name,updated_at) VALUES($1,'MIGRATE','仕入先',now())", [supplier]);
  await client.query("INSERT INTO purchase_orders(id,order_no,supplier_id,status,requested_by,updated_at) VALUES($1,'MIGRATE',$2,'DRAFT',$3,now())", [order, supplier, users[2].id]);
  const history = (await client.query('SELECT * FROM inventory_transactions WHERE id=$1', [transaction])).rows;
  const balance = (await client.query('SELECT * FROM stock_balances WHERE tool_id=$1', [tool])).rows;
  const orders = (await client.query('SELECT * FROM purchase_orders WHERE id=$1', [order])).rows;

  await apply(client, migration);

  assert.deepEqual(await enumLabels(client, schema), ['WORKER', 'ADMIN']);
  for (const user of users) {
   const actual = (await client.query('SELECT id,role,active,password_hash,employee_code,name FROM users WHERE id=$1', [user.id])).rows[0];
   assert.deepEqual(actual, { id: user.id, role: user.role === 'ADMIN' ? 'ADMIN' : 'WORKER', active: user.active, password_hash: user.password_hash, employee_code: user.role, name: user.role });
  }
  assert.deepEqual((await client.query('SELECT token_hash FROM sessions ORDER BY token_hash')).rows.map(row => row.token_hash), ['session-ADMIN', 'session-WORKER']);
  assert.deepEqual((await client.query('SELECT * FROM inventory_transactions WHERE id=$1', [transaction])).rows, history);
  assert.deepEqual((await client.query('SELECT * FROM stock_balances WHERE tool_id=$1', [tool])).rows, balance);
  assert.deepEqual((await client.query('SELECT * FROM purchase_orders WHERE id=$1', [order])).rows, orders);
  const audits = (await client.query("SELECT actor_user_id,entity_id,details FROM audit_logs WHERE action='USER_ROLE_MIGRATED' ORDER BY details->'before'->>'role'")).rows;
  assert.equal(audits.length, 2);
  for (const [index, role] of ['PURCHASER', 'STOCK_MANAGER'].entries()) {
   assert.equal(audits[index].actor_user_id, users[3].id);
   assert.equal(audits[index].entity_id, users.find(user => user.role === role)!.id);
   assert.deepEqual(audits[index].details, { before: { role }, after: { role: 'WORKER' }, reason: migration });
  }
 });
});

test('監査を記録できる管理者がいない既存DBでは移行を拒否してデータを保持する', async () => {
 await isolatedSchema(async (client, schema) => {
  for (const name of (await readdir('prisma/migrations')).filter(name => /^\d/.test(name) && name < migration).sort()) await apply(client, name);
  const id = randomUUID();
  await client.query("INSERT INTO users(id,employee_code,name,role,password_hash,updated_at) VALUES($1,'LEGACY','旧担当','STOCK_MANAGER','preserved-hash',now())", [id]);
  await client.query("INSERT INTO sessions(token_hash,user_id,last_seen_at,expires_at) VALUES('legacy-session',$1,now(),now()+interval '1 hour')", [id]);
  const users = (await client.query('SELECT * FROM users')).rows;
  const sessions = (await client.query('SELECT * FROM sessions')).rows;
  await assert.rejects(apply(client, migration), error => (error as { code: string }).code === 'P0001');
  await client.query('ROLLBACK');
  assert.deepEqual(await enumLabels(client, schema), ['WORKER', 'STOCK_MANAGER', 'PURCHASER', 'ADMIN']);
  assert.deepEqual((await client.query('SELECT * FROM users')).rows, users);
  assert.deepEqual((await client.query('SELECT * FROM sessions')).rows, sessions);
  assert.equal((await client.query('SELECT count(*) FROM audit_logs')).rows[0].count, '0');
 });
});

test('新規DBの全マイグレーション適用後は2ロールだけを保存できる', async () => {
 await isolatedSchema(async (client, schema) => {
  for (const name of (await readdir('prisma/migrations')).filter(name => /^\d/.test(name)).sort()) await apply(client, name);
  assert.deepEqual(await enumLabels(client, schema), ['WORKER', 'ADMIN']);
  for (const role of ['WORKER', 'ADMIN']) await client.query('INSERT INTO users(id,employee_code,name,role,updated_at) VALUES($1,$2,$2,$2::text::"Role",now())', [randomUUID(), role]);
  for (const role of ['STOCK_MANAGER', 'PURCHASER']) await assert.rejects(client.query('INSERT INTO users(id,employee_code,name,role,updated_at) VALUES($1,$2,$2,$2::text::"Role",now())', [randomUUID(), role]), error => (error as { code: string }).code === '22P02');
  assert.equal((await client.query('SELECT count(*) FROM users')).rows[0].count, '2');
 });
});
