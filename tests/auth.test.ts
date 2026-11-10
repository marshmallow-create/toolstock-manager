import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { AuthService, AuthError } from '../src/lib/auth/service';
import { hashPassword, verifyPassword, tokenHash } from '../src/lib/auth/crypto';
import { permissions, can, type Role } from '../src/lib/auth/permissions';

const schema = 'auth_test_' + randomUUID().replaceAll('-', '');
let db: PrismaClient;
let admin: pg.Client;
let service: AuthService;
let now = new Date('2026-11-03T00:00:00Z');
const password = 'Fictional-test-password-123';
const codes = ['TEST-A', 'TEST-ADMIN'];
const roles = ['WORKER', 'ADMIN'] as const;

before(async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url); assert.match(new URL(url).pathname, /test/i);
  admin = new pg.Client({connectionString:url}); await admin.connect();
  await admin.query('CREATE SCHEMA ' + schema);
  await admin.query('SET search_path TO ' + schema);
  for (const name of (await readdir('prisma/migrations')).filter(n=>/^\d/.test(n)).sort())
    await admin.query(await readFile('prisma/migrations/' + name + '/migration.sql','utf8'));
  db = new PrismaClient({adapter:new PrismaPg({connectionString:url, options:'-c search_path='+schema},{schema})});
  service = new AuthService(db, () => now);
  const password_hash = await hashPassword(password);
  for (let i=0;i<codes.length;i++) await db.user.create({data:{employee_code:codes[i],name:codes[i],role:roles[i],password_hash}});
});
after(async () => { await db?.$disconnect(); if(admin){ await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE'); await admin.end(); } });

const status = (code:number) => (e:unknown) => e instanceof AuthError && e.status===code;

test('削除済みユーザーを一覧から除外し、無効ユーザーは表示を維持する', async () => {
 const token=(await service.login(codes[1],password)).token;
 const deleted=await db.user.create({data:{employee_code:'DELETED-USER',name:'削除済み',role:'WORKER',active:false}});
 const inactive=await db.user.create({data:{employee_code:'INACTIVE-USER',name:'無効',role:'WORKER',active:false}});
 await db.$executeRaw`UPDATE users SET deleted_at=now() WHERE id=${deleted.id}::uuid`;
 const users=await service.listUsers(token);
 assert.ok(!users.some(user=>user.id===deleted.id));
 assert.ok(users.some(user=>user.id===inactive.id));
 await assert.rejects(service.updateUser(token,deleted.id,{name:'復元',role:'WORKER',active:true,password:'Abcd1234'}),status(404));
 assert.equal((await db.user.findUniqueOrThrow({where:{id:deleted.id}})).active,false);
});

test('パスワードはsalt付きハッシュで保持し、不正パスワードを拒否する', async()=>{
  const a=await hashPassword(password), b=await hashPassword(password);
  assert.notEqual(a,b); assert.ok(!a.includes(password));
  assert.equal(await verifyPassword(password,a),true);
  assert.equal(await verifyPassword('incorrect',a),false);
  assert.equal(await verifyPassword(password,'invalid'),false);
  await assert.rejects(hashPassword('short'));
});
test('パスワードは8文字と128文字を受け付け7文字と129文字を拒否する', async () => {
 for (const value of ['Abcd1234', 'x'.repeat(128)]) assert.equal(await verifyPassword(value, await hashPassword(value)), true);
 for (const value of ['Abc1234', 'x'.repeat(129)]) await assert.rejects(hashPassword(value));
});

test('8文字でユーザーを登録・ログイン・変更でき、不正な長さは保存しない', async () => {
 const adminToken = (await service.login(codes[1], password)).token;
 for (const value of ['a'.repeat(7), 'a'.repeat(129)]) await assert.rejects(service.createUser(adminToken, { employee_code: 'BAD-LENGTH-' + value.length, name: '境界値', role: 'WORKER', password: value }), status(400));
 const user = await service.createUser(adminToken, { employee_code: 'EIGHT-CHARS', name: '8文字利用者', role: 'WORKER', password: 'Abcd1234' });
 const first = await service.login(user.employee_code, 'Abcd1234');
 for (const value of ['a'.repeat(7), 'a'.repeat(129)]) await assert.rejects(service.updateUser(adminToken, user.id, { name: user.name, role: 'WORKER', active: true, password: value }), status(400));
 assert.equal((await service.authenticate(first.token)).id, user.id);
 await service.updateUser(adminToken, user.id, { name: user.name, role: 'WORKER', active: true, password: 'Zyxw9876' });
 await assert.rejects(service.authenticate(first.token), status(401));
 await assert.rejects(service.login(user.employee_code, 'Abcd1234'), status(401));
 assert.equal((await service.login(user.employee_code, 'Zyxw9876')).user.id, user.id);
});

test('2ロールの全操作が仕様の権限表と一致する',()=>{
  const expected = [
    ['inventory:read','inventory:issue','inventory:receive','history:own','tools:create'],
    Object.keys(permissions),
  ];
  for(let i=0;i<roles.length;i++) for(const permission of Object.keys(permissions))
    assert.equal(can(roles[i],permission),expected[i].includes(permission),roles[i]+':'+permission);
  assert.equal(can('UNKNOWN','inventory:read'),false);
});
test('社員IDログイン、トークンハッシュ保存、ログアウトと偽造トークン拒否',async()=>{
  const login=await service.login(codes[0],password);
  const stored=await db.session.findUniqueOrThrow({where:{token_hash:tokenHash(login.token)}});
  assert.notEqual(stored.token_hash,login.token);
  assert.equal((await service.authenticate(login.token)).employee_code,codes[0]);
  await assert.rejects(service.authenticate('forged'),status(401));
  await service.logout(login.token);
  await assert.rejects(service.authenticate(login.token),status(401));
});
test('無操作30分・最長8時間のセッション失効',async()=>{
  const login=await service.login(codes[0],password);
  now=new Date(now.getTime()+30*60_000);
  await assert.rejects(service.authenticate(login.token),status(401));
  const next=await service.login(codes[0],password);
  for(let i=0;i<31;i++){ now=new Date(now.getTime()+15*60_000); await service.authenticate(next.token); }
  now=new Date(now.getTime()+15*60_000);
  await assert.rejects(service.authenticate(next.token),status(401));
});
test('作業者は管理API相当のサービス操作を拒否',async()=>{
  for(const code of codes.slice(0,1)){
    const {token}=await service.login(code,password);
    await assert.rejects(service.listUsers(token),status(403));
    await assert.rejects(service.createUser(token,{employee_code:'X',name:'X',role:'ADMIN',password}),status(403));
  }
});
test('廃止されたロールはユーザー登録と更新で拒否する',async()=>{
  const {token}=await service.login(codes[1],password);
  const user=await db.user.findUniqueOrThrow({where:{employee_code:codes[0]}});
  for(const role of ['STOCK_MANAGER','PURCHASER']){
    // Exercise invalid runtime input that the TypeScript API correctly excludes.
    await assert.rejects(service.createUser(token,{employee_code:'RETIRED-'+role,name:'架空',role:role as Role,password}),status(400));
    await assert.rejects(service.updateUser(token,user.id,{name:user.name,role:role as Role,active:true}),status(400));
  }
  assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).role,'WORKER');
  assert.equal(await db.user.count({where:{employee_code:{startsWith:'RETIRED-'}}}),0);
});
test('管理者のユーザー登録・ロール変更・無効化が監査され、既存セッションを失効する',async()=>{
  const {token}=await service.login(codes[1],password);
  const user=await service.createUser(token,{employee_code:'NEW',name:'架空',role:'WORKER',password});
  assert.ok(!JSON.stringify(user).includes('password_hash'));
  const first=await service.login('NEW',password);
  await service.updateUser(token,user.id,{role:'ADMIN',active:true,name:'架空'});
  await assert.rejects(service.authenticate(first.token),status(401));
  const second=await service.login('NEW',password);
  await service.updateUser(token,user.id,{role:'ADMIN',active:false,name:'架空'});
  await assert.rejects(service.authenticate(second.token),status(401));
  await assert.rejects(service.login('NEW',password),status(401));
  assert.equal(await db.auditLog.count({where:{entity_id:user.id}}),3);
  assert.ok(!(await service.listUsers(token)).some(u=>'password_hash' in u));
  await assert.rejects(service.updateUser(token,(await service.authenticate(token)).id,{role:'WORKER',active:true,name:'self'}),status(409));
});
test('不正資格情報は一般化したエラーを返し、5回試行後は15分制限する',async()=>{
  const messages:string[]=[];
  for(const code of ['MISSING',codes[1]]){
    for(let i=0;i<5;i++) await assert.rejects(service.login(code,'wrong'),e=>{assert.ok(e instanceof AuthError); messages.push(e.message); return e.status===401;});
    await assert.rejects(service.login(code,password),status(429));
  }
  assert.equal(new Set(messages).size,1);
  now=new Date(now.getTime()+15*60_000);
  assert.equal((await service.login(codes[1],password)).user.role,'ADMIN');
});


test('同時ログイン失敗でも5回制限を超えて認証検証を通さない',async()=>{
 const results=await Promise.allSettled(Array.from({length:8},()=>service.login('PARALLEL-MISSING','wrong')));
 const statuses=results.map(r=>r.status==='rejected'?(r.reason as AuthError).status:200);
 assert.equal(statuses.filter(s=>s===401).length,5);assert.equal(statuses.filter(s=>s===429).length,3);
});
test('パスワード変更は既存セッションを失効し、旧パスワードを拒否する',async()=>{
 const {token}=await service.login(codes[1],password);
 const user=await db.user.findUniqueOrThrow({where:{employee_code:codes[0]}});
 const original=await service.login(codes[0],password);
 const nextPassword='Replacement-fictional-password-456';
 await service.updateUser(token,user.id,{name:user.name,role:user.role,active:true,password:nextPassword});
 await assert.rejects(service.authenticate(original.token),status(401));
 await assert.rejects(service.login(codes[0],password),status(401));
 assert.equal((await service.login(codes[0],nextPassword)).user.id,user.id);
});
test('管理者の相互降格が同時に発生しても有効管理者を保持する',async()=>{
 const first=await service.login(codes[1],password);
 const secondUser=await service.createUser(first.token,{employee_code:'OTHER-ADMIN',name:'架空管理者',role:'ADMIN',password});
 const second=await service.login('OTHER-ADMIN',password);
 const result=await Promise.allSettled([
  service.updateUser(first.token,secondUser.id,{name:secondUser.name,role:'WORKER',active:true}),
  service.updateUser(second.token,first.user.id,{name:first.user.name,role:'WORKER',active:true}),
 ]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(await db.user.count({where:{active:true,role:'ADMIN'}}),1);
});
