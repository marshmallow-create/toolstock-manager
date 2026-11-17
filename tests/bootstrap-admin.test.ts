import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/database';
import {bootstrapAdmin} from '../src/lib/auth/bootstrap-admin';
import {verifyPassword} from '../src/lib/auth/crypto';

let f:Awaited<ReturnType<typeof databaseFixture>>;
before(async()=>{f=await databaseFixture('bootstrap_test');});
after(async()=>{await f?.close();});
test('既存管理者がいる場合はパスワードもユーザーも変更しない',async()=>{
 const users=await f.db.user.findMany({orderBy:{id:'asc'}});
 assert.equal((await bootstrapAdmin(f.db,{})).created,false);
 assert.deepEqual(await f.db.user.findMany({orderBy:{id:'asc'}}),users);
});
test('空DBだけに管理者を作り、再実行しても認証情報を再設定しない',async()=>{
 // databaseFixture owns this disposable test schema; no application database is touched.
 assert.match(f.schema,/^bootstrap_test_[0-9a-f]+$/);
 await f.admin.query('TRUNCATE users CASCADE');
 await assert.rejects(()=>bootstrapAdmin(f.db,{}));
 await assert.rejects(()=>bootstrapAdmin(f.db,{password:'short'}));
 const password='Fictional-bootstrap-admin-123!';
 const created=await bootstrapAdmin(f.db,{password});
 assert.deepEqual(created,{created:true,employeeCode:'ADMIN001'});
 const admin=await f.db.user.findUniqueOrThrow({where:{employee_code:'ADMIN001'}});
 assert.equal(admin.role,'ADMIN');assert.equal(admin.active,true);
 assert.ok(await verifyPassword(password,admin.password_hash));
 assert.equal(await f.db.user.count(),1);assert.equal(await f.db.tool.count(),0);assert.equal(await f.db.inventoryTransaction.count(),0);
 const audit=await f.db.auditLog.findFirstOrThrow();assert.ok(!JSON.stringify(audit).includes(password));
 assert.equal((await bootstrapAdmin(f.db,{password:'A-different-password-123!'})).created,false);
 assert.equal((await f.db.user.findUniqueOrThrow({where:{id:admin.id}})).password_hash,admin.password_hash);
 await f.db.user.update({where:{id:admin.id},data:{active:false}});
 await assert.rejects(()=>bootstrapAdmin(f.db,{password}));
});
