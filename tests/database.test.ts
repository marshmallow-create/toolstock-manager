import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { getDb } from '../src/lib/db';
// 専用DBの一時スキーマへ実マイグレーションを適用。業務データには触れない。
test('初期DDLの参照整合性・数量・履歴保護', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'TEST_DATABASE_URL を設定してください');
  assert.match(new URL(url).pathname, /test/i, '専用テストDBが必要です');
  const client = new pg.Client({connectionString:url,connectionTimeoutMillis:3000});
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA phase1_test');
    await client.query('SET LOCAL search_path TO phase1_test');
    await client.query(await readFile('prisma/migrations/20261103000000_init/migration.sql','utf8'));
    await client.query(`INSERT INTO tools(id,tool_code,name,category,manufacturer,model,unit,updated_at) VALUES ('00000000-0000-0000-0000-000000000001','TEST','test','DRILL','demo','demo','piece',now());
      INSERT INTO locations(id,location_code,name,updated_at) VALUES ('00000000-0000-0000-0000-000000000002','TEST','test',now());
      INSERT INTO users(id,employee_code,name,role,updated_at) VALUES ('00000000-0000-0000-0000-000000000003','TEST','test','ADMIN',now())`);
    async function rejected(sql:string, code:string) {
      await client.query('SAVEPOINT invalid_case');
      await assert.rejects(client.query(sql), (e:unknown) => (e as {code:string}).code === code);
      await client.query('ROLLBACK TO SAVEPOINT invalid_case');
    }
    const stock = (n:number,r:number) => `INSERT INTO stock_balances(id,tool_id,location_id,on_hand,reserved,updated_at) VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',${n},${r},now())`;
    await rejected(stock(-1,0),'23514');
    await rejected(stock(1,2),'23514');
    await client.query(stock(10,0));
    await rejected(stock(10,0),'23505');
    await rejected(`DELETE FROM tools`,'23503');
    await client.query(`INSERT INTO inventory_transactions(id,tool_id,location_id,actor_user_id,type,quantity,idempotency_key,updated_at) VALUES ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','RECEIVE',10,'once',now())`);
    await client.query("INSERT INTO machines(id,machine_code,name,updated_at) VALUES ('00000000-0000-0000-0000-000000000010','OLD-MACHINE','legacy',now()); INSERT INTO suppliers(id,supplier_code,name,updated_at) VALUES ('00000000-0000-0000-0000-000000000011','OLD-SUPPLIER','legacy',now())");
    const issue = (key:string) => `INSERT INTO inventory_transactions(id,tool_id,location_id,actor_user_id,type,quantity,idempotency_key,updated_at) VALUES ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','ISSUE',-1,'${key}',now())`;
    await rejected(issue('before'),'23514');
    const snapshots=await client.query('SELECT row_to_json(t) AS value FROM inventory_transactions t UNION ALL SELECT row_to_json(t) FROM machines t UNION ALL SELECT row_to_json(t) FROM suppliers t');
    const migration=await readFile('prisma/migrations/20261107000000_simple_inventory/migration.sql','utf8');
    await client.query(migration.replace(/^BEGIN;\s*|COMMIT;\s*$/gm,''));
    assert.deepEqual((await client.query('SELECT row_to_json(t) AS value FROM inventory_transactions t UNION ALL SELECT row_to_json(t) FROM machines t UNION ALL SELECT row_to_json(t) FROM suppliers t')).rows,snapshots.rows);
    await client.query(issue('after'));
    assert.equal((await client.query("SELECT machine_id FROM inventory_transactions WHERE type='ISSUE'")).rows[0].machine_id,null);
    await rejected(`UPDATE inventory_transactions SET quantity=9`,'P0001');
    await rejected(`DELETE FROM inventory_transactions`,'P0001');
    await rejected(`INSERT INTO inventory_transactions SELECT '00000000-0000-0000-0000-000000000006',tool_id,location_id,actor_user_id,machine_id,type,quantity,idempotency_key,reverses_id,reason,created_at,updated_at FROM inventory_transactions`,'23505');
    await client.query(`INSERT INTO locations(id,location_code,name,updated_at) VALUES ('00000000-0000-0000-0000-000000000030','TEST-B','second shelf',now());
      INSERT INTO stock_balances(id,tool_id,location_id,on_hand,reserved,updated_at) VALUES ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030',5,2,now());
      INSERT INTO tools(id,tool_code,name,category,manufacturer,model,unit,updated_at) VALUES ('00000000-0000-0000-0000-000000000032','EMPTY','empty','DRILL','','','piece',now())`);
    const beforeShelfMigration = await client.query('SELECT row_to_json(t) AS value FROM stock_balances t UNION ALL SELECT row_to_json(t) FROM inventory_transactions t');
    await client.query(await readFile('prisma/migrations/20261107010000_tool_shelf/migration.sql','utf8'));
    assert.deepEqual((await client.query('SELECT tool_code,shelf_code FROM tools ORDER BY tool_code')).rows, [{ tool_code:'EMPTY',shelf_code:'' },{ tool_code:'TEST',shelf_code:'TEST / TEST-B' }]);
    assert.deepEqual((await client.query('SELECT row_to_json(t) AS value FROM stock_balances t UNION ALL SELECT row_to_json(t) FROM inventory_transactions t')).rows, beforeShelfMigration.rows);
  } finally { await client.query('ROLLBACK'); await client.end(); }
});


test('snapshot migration preserves old history and its append-only constraints', async()=>{
 const url=process.env.TEST_DATABASE_URL;assert.ok(url);assert.match(new URL(url).pathname,/test/i);
 const client=new pg.Client({connectionString:url,connectionTimeoutMillis:3000});await client.connect();const schema='snapshots_'+randomUUID().replaceAll('-','');
 try{
  await client.query('CREATE SCHEMA '+schema);await client.query('SET search_path TO '+schema);
  const migration='20261107020000_history_snapshots';
  for(const name of (await readdir('prisma/migrations')).filter(n=>/^\d/.test(n)&&n!==migration).sort())await client.query(await readFile('prisma/migrations/'+name+'/migration.sql','utf8'));
  const tool=randomUUID(),location=randomUUID(),user=randomUUID(),id=randomUUID();
  await client.query("INSERT INTO tools(id,tool_code,name,category,manufacturer,model,unit,updated_at) VALUES ($1,'SNAPSHOT','legacy','DRILL','','','pcs',now())",[tool]);
  await client.query("INSERT INTO locations(id,location_code,name,updated_at) VALUES ($1,'SNAPSHOT','legacy',now())",[location]);
  await client.query("INSERT INTO users(id,employee_code,name,role,updated_at) VALUES ($1,'SNAPSHOT','legacy','ADMIN',now())",[user]);
  await client.query("INSERT INTO inventory_transactions(id,tool_id,location_id,actor_user_id,type,quantity,idempotency_key,updated_at) VALUES ($1,$2,$3,$4,'RECEIVE',10,'legacy-snapshot',now())",[id,tool,location,user]);
  const before=(await client.query('SELECT to_jsonb(t) AS data FROM inventory_transactions t')).rows;
  await client.query(await readFile('prisma/migrations/'+migration+'/migration.sql','utf8'));
  const after=(await client.query("SELECT to_jsonb(t)-'on_hand_after'-'unit_price' AS data FROM inventory_transactions t")).rows;
  assert.deepEqual(after,before);assert.equal((await client.query('SELECT unit_price,on_hand_after FROM inventory_transactions')).rows[0].unit_price,null);
  await assert.rejects(client.query('UPDATE inventory_transactions SET unit_price=1'),(e:unknown)=>(e as {code:string}).code==='P0001');
  for(const [balance,price] of [[-1,'1'],[0,'-0.01']])await assert.rejects(client.query("INSERT INTO inventory_transactions(id,tool_id,location_id,actor_user_id,type,quantity,idempotency_key,on_hand_after,unit_price,updated_at) VALUES ($1,$2,$3,$4,'RECEIVE',1,$5,$6,$7,now())",[randomUUID(),tool,location,user,randomUUID(),balance,price]),(e:unknown)=>(e as {code:string}).code==='23514');
 }finally{await client.query('SET search_path TO public');await client.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await client.end();}
});


test('DB cache replaces stale generated clients and reuses the current client',async()=>{
 const cache=globalThis as unknown as {db?:unknown;dbConstructor?:unknown;dbUrl?:string};
 const saved={db:cache.db,dbConstructor:cache.dbConstructor,dbUrl:cache.dbUrl},savedUrl=process.env.DATABASE_URL;
 let disconnected=0;const stale={$disconnect:async()=>{disconnected++;}};
 cache.db=stale;delete cache.dbConstructor;delete cache.dbUrl;
 process.env.DATABASE_URL='postgresql://localhost:5432/cache_test?schema=cache_test';
 try{
  const current=getDb();assert.notStrictEqual(current,stale,'a cached pre-regeneration client must be replaced');
  assert.strictEqual(getDb(),current,'same generated client and URL should share one pool');
  await Promise.resolve();assert.equal(disconnected,1);
  cache.dbConstructor=class PreviousGeneratedClient {};
  const regenerated=getDb();assert.notStrictEqual(regenerated,current);assert.strictEqual(getDb(),regenerated);
  process.env.DATABASE_URL='postgresql://localhost:5432/cache_test?schema=other_test';
  const changedDatabase=getDb();assert.notStrictEqual(changedDatabase,regenerated);assert.strictEqual(getDb(),changedDatabase);
 }finally{
  await (cache.db as {$disconnect?:()=>Promise<void>})?.$disconnect?.();
  Object.assign(cache,saved);if(savedUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=savedUrl;
 }
});
