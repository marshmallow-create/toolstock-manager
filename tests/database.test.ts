import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
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
    await rejected(`UPDATE inventory_transactions SET quantity=9`,'P0001');
    await rejected(`DELETE FROM inventory_transactions`,'P0001');
    await rejected(`INSERT INTO inventory_transactions SELECT '00000000-0000-0000-0000-000000000006',tool_id,location_id,actor_user_id,machine_id,type,quantity,idempotency_key,reverses_id,reason,created_at,updated_at FROM inventory_transactions`,'23505');
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
