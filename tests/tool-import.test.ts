import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixture } from './helpers/database';
import { AuthService, AuthError } from '../src/lib/auth/service';
import { previewToolImport, commitToolImport } from '../src/lib/masters/tool-import';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
let auth: AuthService;
before(async () => { fixture = await databaseFixture('tool_import'); auth = new AuthService(fixture.db); });
after(async () => { await fixture?.close(); });
const row = (code: string, rowNumber = 2) => ({ rowNumber, values: { tool_code: code, name: '一括ドリル', category: 'ドリル', on_hand: '7', reorder_point: '3', order_quantity: '4', unit_price: '125.50', department: '17314', shelf_code: 'A-01' } });
const status = (n: number) => (error: unknown) => error instanceof AuthError && error.status === n;

test('確認は保存せず全項目と重複を行番号付きで検証する', async () => {
 const initial = await fixture.db.tool.count();
 const good = await previewToolImport(fixture.db, auth, fixture.tokens.WORKER, [row('batch-a')]);
 assert.equal(good.valid, true); assert.equal(good.rows[0].values.tool_code, 'BATCH-A');
 assert.equal(await fixture.db.tool.count(), initial);
 const invalid = await previewToolImport(fixture.db, auth, fixture.tokens.WORKER, [row('batch-a'), { ...row('BATCH-A', 4), values: { ...row('BATCH-A').values, category: 'その他', on_hand: '-1', department: '99999', unit_price: '1.234' } }]);
 assert.equal(invalid.valid, false); assert.ok(invalid.rows.every(value => value.errors.some(error => error.includes('重複'))));
 assert.equal(invalid.rows[1].rowNumber, 4); assert.ok(invalid.rows[1].errors.length >= 5);
 await assert.rejects(previewToolImport(fixture.db, auth, undefined, [row('AUTH')]), status(401));
 await assert.rejects(previewToolImport(fixture.db, auth, fixture.tokens.ADMIN, []), status(400));
 await assert.rejects(previewToolImport(fixture.db, auth, fixture.tokens.ADMIN, Array.from({length:201},(_,i)=>row('MANY-'+i,i+2))), status(400));
});

test('一括確定は通常登録と同じ在庫・履歴・候補・監査を操作者付きで保存し再送を拒否する', async () => {
 const rows = [row('BATCH-ONE'), row('BATCH-TWO', 3)];
 const result = await commitToolImport(fixture.db, auth, fixture.tokens.WORKER, rows);
 assert.equal(result.count, 2);
 for (const code of ['BATCH-ONE', 'BATCH-TWO']) {
  const tool = await fixture.db.tool.findUniqueOrThrow({where:{tool_code:code}});
  assert.equal(tool.category, 'DRILL'); assert.equal(tool.unit_price?.toFixed(2),'125.50');
  assert.equal((await fixture.db.stockBalance.findFirstOrThrow({where:{tool_id:tool.id}})).on_hand, 7);
  assert.equal((await fixture.db.reorderCandidate.findFirstOrThrow({where:{tool_id:tool.id,status:'OPEN'}})).quantity,4);
  const transaction = await fixture.db.inventoryTransaction.findFirstOrThrow({where:{tool_id:tool.id}});
  assert.equal(transaction.actor_user_id, fixture.users.WORKER); assert.equal(transaction.on_hand_after,7);
  assert.equal(await fixture.db.auditLog.count({where:{entity_id:tool.id,action:'TOOL_CREATED'}}),1);
 }
 await assert.rejects(commitToolImport(fixture.db, auth, fixture.tokens.WORKER, rows), status(400));
 assert.equal((await previewToolImport(fixture.db, auth, fixture.tokens.WORKER, rows)).valid,false);
});

test('確認後の重複と途中の監査失敗では一部だけ登録しない', async () => {
 const rows = [row('BATCH-RACE'),row('BATCH-RACE-SECOND',3)];
 assert.equal((await previewToolImport(fixture.db,auth,fixture.tokens.ADMIN,rows)).valid,true);
 await commitToolImport(fixture.db,auth,fixture.tokens.ADMIN,[rows[1]]);
 await assert.rejects(commitToolImport(fixture.db,auth,fixture.tokens.ADMIN,rows),status(400));
 assert.equal(await fixture.db.tool.count({where:{tool_code:'BATCH-RACE'}}),0);
 await fixture.admin.query("CREATE FUNCTION fail_batch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='TOOL_CREATED' AND NEW.details->'after'->>'tool_code'='BATCH-FAIL' THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_batch BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_batch_audit()");
 try {
  await assert.rejects(commitToolImport(fixture.db,auth,fixture.tokens.ADMIN,[row('BATCH-ROLLBACK'),row('BATCH-FAIL',3)]));
  assert.equal(await fixture.db.tool.count({where:{tool_code:{in:['BATCH-ROLLBACK','BATCH-FAIL']}}}),0);
 } finally { await fixture.admin.query('DROP TRIGGER reject_batch ON audit_logs; DROP FUNCTION fail_batch_audit()'); }
});

test('上限200件の一括登録と空欄数量の0扱い',async()=>{
 const rows=Array.from({length:200},(_,index)=>({...row('LIMIT-'+index,index+2),values:{...row('LIMIT-'+index).values,on_hand:'',reorder_point:'',order_quantity:''}}));
 assert.equal((await commitToolImport(fixture.db,auth,fixture.tokens.ADMIN,rows)).count,200);
 assert.equal(await fixture.db.tool.count({where:{tool_code:{startsWith:'LIMIT-'}}}),200);
 assert.equal(await fixture.db.inventoryTransaction.count({where:{tool_id_record:{tool_code:{startsWith:'LIMIT-'}}}}),0);
});
