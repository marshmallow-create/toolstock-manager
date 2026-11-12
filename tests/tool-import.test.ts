import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixture } from './helpers/database';
import { AuthService, AuthError } from '../src/lib/auth/service';
import { previewToolImport, commitToolImport } from '../src/lib/masters/tool-import';
import { previewToolUpdate, commitToolUpdate } from '../src/lib/masters/tool-update';
import { exportTools } from '../src/lib/masters/read';
import { createToolExport, parseToolWorkbook } from '../src/lib/masters/tool-workbook';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
let auth: AuthService;
before(async () => { fixture = await databaseFixture('tool_import'); auth = new AuthService(fixture.db); });
after(async () => { await fixture?.close(); });
const row = (code: string, rowNumber = 2) => ({ rowNumber, values: { tool_code: code, name: '一括ドリル', category: 'ドリル', on_hand: '7', reorder_point: '3', order_quantity: '4', unit_price: '125.50', department: '17314', shelf_code: 'A-01' } });
const status = (n: number) => (error: unknown) => error instanceof AuthError && error.status === n;

test('既存の日本語カテゴリーを含む未編集の出力Excelは変更を発生させない',async()=>{
 await commitToolImport(fixture.db,auth,fixture.tokens.ADMIN,[row('EXPORT-LEGACY-CATEGORY')]);
 await fixture.db.tool.update({where:{tool_code:'EXPORT-LEGACY-CATEGORY'},data:{category:'ドリル'}});
 const file=await createToolExport(await exportTools(fixture.db,auth,fixture.tokens.ADMIN,{tool_code:'EXPORT-LEGACY-CATEGORY'}));
 const rows=await parseToolWorkbook(file.buffer,'update');
 const preview=await previewToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows);
 assert.equal(preview.valid,true);assert.deepEqual(preview.rows[0].changes,[]);
 assert.equal((await commitToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows,preview.previewToken)).count,0);
 assert.equal((await fixture.db.tool.findUniqueOrThrow({where:{tool_code:'EXPORT-LEGACY-CATEGORY'}})).category,'ドリル');
});

test('既存の長い棚番を出力したExcelで品目名だけを変更できる',async()=>{
 await commitToolImport(fixture.db,auth,fixture.tokens.ADMIN,[row('EXPORT-LEGACY-SHELF')]);
 const shelf='棚'.repeat(120);
 await fixture.db.tool.update({where:{tool_code:'EXPORT-LEGACY-SHELF'},data:{shelf_code:shelf}});
 const file=await createToolExport(await exportTools(fixture.db,auth,fixture.tokens.ADMIN,{tool_code:'EXPORT-LEGACY-SHELF'}));
 const rows=await parseToolWorkbook(file.buffer,'update');rows[0].values.name='棚番を保持';
 const preview=await previewToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows);
 assert.equal(preview.valid,true,JSON.stringify(preview.rows[0].errors));assert.deepEqual(preview.rows[0].changes,['name']);
 assert.equal((await commitToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows,preview.previewToken)).count,1);
 assert.equal((await fixture.db.tool.findUniqueOrThrow({where:{tool_code:'EXPORT-LEGACY-SHELF'}})).shelf_code,shelf);
});

test('一括変更は空欄を保持し0も更新でき、通常変更と同じ履歴を作る',async()=>{
 await commitToolImport(fixture.db,auth,fixture.tokens.ADMIN,[row('UPDATE-A')]);
 const rows=[{rowNumber:2,values:{tool_code:'update-a',name:'変更後',on_hand:'0',reorder_point:'0',order_quantity:'0',unit_price:'0',department:'',shelf_code:''}}];
 const preview=await previewToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows);
 assert.equal(preview.valid,true);assert.equal(preview.rows[0].before.name,'一括ドリル');
 assert.equal((await fixture.db.tool.findUniqueOrThrow({where:{tool_code:'UPDATE-A'}})).name,'一括ドリル');
 assert.equal((await commitToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows,preview.previewToken)).count,1);
 const tool=await fixture.db.tool.findUniqueOrThrow({where:{tool_code:'UPDATE-A'}});
 assert.equal(tool.name,'変更後');assert.equal(tool.department,'17314');assert.equal(tool.shelf_code,'A-01');assert.equal(tool.category,'DRILL');assert.equal(tool.unit_price?.toString(),'0');
 assert.equal((await fixture.db.stockBalance.findFirstOrThrow({where:{tool_id:tool.id}})).on_hand,0);
 assert.equal((await fixture.db.inventoryPolicy.findUniqueOrThrow({where:{tool_id:tool.id}})).reorder_point,0);
 assert.equal(await fixture.db.reorderCandidate.count({where:{tool_id:tool.id,status:'OPEN'}}),0);
 assert.equal(await fixture.db.auditLog.count({where:{entity_id:tool.id,action:'TOOL_UPDATED'}}),1);
 await assert.rejects(commitToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows,preview.previewToken),status(409));
});

test('一括変更は存在しないコード・重複・不正値・空の変更を行番号付きで拒否する',async()=>{
 const rows=[{rowNumber:2,values:{tool_code:'MISSING',name:'名前'}},{rowNumber:5,values:{tool_code:'UPDATE-A',on_hand:'-1'}},{rowNumber:6,values:{tool_code:'UPDATE-A'}}];
 const preview=await previewToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows);
 assert.equal(preview.valid,false);assert.ok(preview.rows.every(row=>row.errors.length>0));assert.equal(preview.rows[1].rowNumber,5);
 await assert.rejects(commitToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows,preview.previewToken),status(400));
 for(const token of [undefined,fixture.tokens.WORKER]){
  await assert.rejects(previewToolUpdate(fixture.db,auth,token,rows),status(token?403:401));
  await assert.rejects(commitToolUpdate(fixture.db,auth,token,rows,''),status(token?403:401));
 }
});

test('確認後の在庫変更やファイル差し替えを検出し、途中失敗時は全件を戻す',async()=>{
 await commitToolImport(fixture.db,auth,fixture.tokens.ADMIN,[row('UPDATE-RACE'),row('UPDATE-SECOND',3)]);
 const rows=[{rowNumber:2,values:{tool_code:'UPDATE-RACE',name:'変更1'}},{rowNumber:3,values:{tool_code:'UPDATE-SECOND',name:'変更2'}}];
 const preview=await previewToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows);
 await fixture.db.stockBalance.updateMany({where:{tool_id_record:{tool_code:'UPDATE-RACE'}},data:{on_hand:8}});
 await assert.rejects(commitToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows,preview.previewToken),status(409));
 const current=await previewToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows);
 await assert.rejects(commitToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,[{...rows[0],values:{...rows[0].values,name:'差替'}}],current.previewToken),status(409));
 await fixture.admin.query("CREATE FUNCTION fail_update_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='TOOL_UPDATED' AND NEW.details->'after'->>'name'='変更2' THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_update_batch BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_update_audit()");
 try{
  await assert.rejects(commitToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows,current.previewToken));
  for(const tool of await fixture.db.tool.findMany({where:{tool_code:{in:['UPDATE-RACE','UPDATE-SECOND']}}}))assert.equal(tool.name,'一括ドリル');
 }finally{await fixture.admin.query('DROP TRIGGER reject_update_batch ON audit_logs; DROP FUNCTION fail_update_audit()');}
});

test('Excelの確認・確定は管理者だけが利用でき、確認後も権限を再検証する', async () => {
 for (const token of [undefined, fixture.tokens.WORKER]) {
  await assert.rejects(previewToolImport(fixture.db, auth, token, [row('DENIED-IMPORT')]), status(token ? 403 : 401));
  await assert.rejects(commitToolImport(fixture.db, auth, token, [row('DENIED-IMPORT')]), status(token ? 403 : 401));
 }
 const user = await auth.createUser(fixture.tokens.ADMIN, { employee_code: 'IMPORT-ADMIN', name: '一括担当', role: 'ADMIN', password: fixture.password });
 const session = (await auth.login(user.employee_code, fixture.password)).token;
 assert.equal((await previewToolImport(fixture.db, auth, session, [row('ROLE-CHANGED')])).valid, true);
 await auth.updateUser(fixture.tokens.ADMIN, user.id, { name: user.name, role: 'WORKER', active: true });
 await assert.rejects(commitToolImport(fixture.db, auth, session, [row('ROLE-CHANGED')]), status(401));
 const workerSession = (await auth.login(user.employee_code, fixture.password)).token;
 await assert.rejects(commitToolImport(fixture.db, auth, workerSession, [row('ROLE-CHANGED')]), status(403));
 assert.equal(await fixture.db.tool.count({ where: { tool_code: { in: ['DENIED-IMPORT', 'ROLE-CHANGED'] } } }), 0);
});

test('確認は保存せず全項目と重複を行番号付きで検証する', async () => {
 const initial = await fixture.db.tool.count();
 const good = await previewToolImport(fixture.db, auth, fixture.tokens.ADMIN, [row('batch-a')]);
 assert.equal(good.valid, true); assert.equal(good.rows[0].values.tool_code, 'BATCH-A');
 assert.equal(await fixture.db.tool.count(), initial);
 const invalid = await previewToolImport(fixture.db, auth, fixture.tokens.ADMIN, [row('batch-a'), { ...row('BATCH-A', 4), values: { ...row('BATCH-A').values, category: 'その他', on_hand: '-1', department: '99999', unit_price: '1.234' } }]);
 assert.equal(invalid.valid, false); assert.ok(invalid.rows.every(value => value.errors.some(error => error.includes('重複'))));
 assert.equal(invalid.rows[1].rowNumber, 4); assert.ok(invalid.rows[1].errors.length >= 5);
 await assert.rejects(previewToolImport(fixture.db, auth, undefined, [row('AUTH')]), status(401));
 await assert.rejects(previewToolImport(fixture.db, auth, fixture.tokens.ADMIN, []), status(400));
 await assert.rejects(previewToolImport(fixture.db, auth, fixture.tokens.ADMIN, Array.from({length:201},(_,i)=>row('MANY-'+i,i+2))), status(400));
});

test('一括確定は通常登録と同じ在庫・履歴・候補・監査を操作者付きで保存し再送を拒否する', async () => {
 const rows = [row('BATCH-ONE'), row('BATCH-TWO', 3)];
 const result = await commitToolImport(fixture.db, auth, fixture.tokens.ADMIN, rows);
 assert.equal(result.count, 2);
 for (const code of ['BATCH-ONE', 'BATCH-TWO']) {
  const tool = await fixture.db.tool.findUniqueOrThrow({where:{tool_code:code}});
  assert.equal(tool.category, 'DRILL'); assert.equal(tool.unit_price?.toFixed(2),'125.50');
  assert.equal((await fixture.db.stockBalance.findFirstOrThrow({where:{tool_id:tool.id}})).on_hand, 7);
  assert.equal((await fixture.db.reorderCandidate.findFirstOrThrow({where:{tool_id:tool.id,status:'OPEN'}})).quantity,4);
  const transaction = await fixture.db.inventoryTransaction.findFirstOrThrow({where:{tool_id:tool.id}});
  assert.equal(transaction.actor_user_id, fixture.users.ADMIN); assert.equal(transaction.on_hand_after,7);
  assert.equal(await fixture.db.auditLog.count({where:{entity_id:tool.id,action:'TOOL_CREATED'}}),1);
 }
 await assert.rejects(commitToolImport(fixture.db, auth, fixture.tokens.ADMIN, rows), status(400));
 assert.equal((await previewToolImport(fixture.db, auth, fixture.tokens.ADMIN, rows)).valid,false);
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

test('上限200件を一括変更し、空欄の在庫方針や在庫を保持する',async()=>{
 const first=await fixture.db.tool.findUniqueOrThrow({where:{tool_code:'LIMIT-0'}});
 await fixture.db.inventoryPolicy.update({where:{tool_id:first.id},data:{safety_stock:1,reorder_point:2,target_stock:3}});
 const rows=Array.from({length:200},(_,index)=>({rowNumber:index+2,values:{tool_code:'LIMIT-'+index,name:'変更-'+index}}));
 const preview=await previewToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows);assert.equal(preview.valid,true);
 assert.equal((await commitToolUpdate(fixture.db,auth,fixture.tokens.ADMIN,rows,preview.previewToken)).count,200);
 assert.equal(await fixture.db.tool.count({where:{tool_code:{startsWith:'LIMIT-'},name:{startsWith:'変更-'}}}),200);
 const policy=await fixture.db.inventoryPolicy.findUniqueOrThrow({where:{tool_id:first.id}});
 assert.equal(policy.safety_stock,1);assert.equal(policy.reorder_point,2);assert.equal(policy.target_stock,3);
 assert.equal(await fixture.db.inventoryTransaction.count({where:{tool_id_record:{tool_code:{startsWith:'LIMIT-'}}}}),0);
});
