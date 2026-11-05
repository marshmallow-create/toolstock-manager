import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword,tokenHash } from '../src/lib/auth/crypto';
const schema='auth_http_'+randomUUID().replaceAll('-','');
const password='Fictional-http-password-123';
let server:ChildProcess, db:PrismaClient, admin:pg.Client, origin:string;
let logs='';
before(async()=>{
 const url=process.env.TEST_DATABASE_URL; assert.ok(url); assert.match(new URL(url).pathname,/test/i);
 admin=new pg.Client({connectionString:url});await admin.connect();
 await admin.query('CREATE SCHEMA '+schema);await admin.query('SET search_path TO '+schema);
 for(const name of (await readdir('prisma/migrations')).filter(n=>/^\d/.test(n)).sort()) await admin.query(await readFile('prisma/migrations/'+name+'/migration.sql','utf8'));
 db=new PrismaClient({adapter:new PrismaPg({connectionString:url,options:'-c search_path='+schema},{schema})});
 const password_hash=await hashPassword(password);
 for(const [employee_code,role] of [['HTTP-A','WORKER'],['HTTP-ADMIN','ADMIN']] as const)
  await db.user.create({data:{employee_code,name:employee_code,role,password_hash}});
 const probe=createServer(); await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r)); const port=(probe.address() as {port:number}).port; await new Promise<void>(r=>probe.close(()=>r()));
 origin='http://127.0.0.1:'+port;
 const database=new URL(url);database.searchParams.set('schema',schema);database.searchParams.set('options','-c search_path='+schema);
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,APP_ORIGIN:origin,DATABASE_URL:database.href},stdio:['ignore','pipe','pipe']});
 server.stdout?.on('data',data=>logs+=String(data));server.stderr?.on('data',data=>logs+=String(data));
 for(let i=0;i<100;i++){
  if(server.exitCode!==null) throw new Error(logs);
  try{await fetch(origin+'/login');return;}catch{await new Promise(r=>setTimeout(r,100));}
 }
 throw new Error('HTTP server timeout: '+logs);
}, {timeout:20000});
after(async()=>{
 if(server&&server.exitCode===null){server.kill();await new Promise<void>(r=>server.once('exit',()=>r()));}
 await db?.$disconnect();if(admin){await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();}
});
const request=(path:string,options:RequestInit={})=>fetch(origin+path,{redirect:'manual',...options});
async function login(code:string){
 const r=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({employee_code:code,password})});
 assert.equal(r.status,200,await r.clone().text());
 const cookie=r.headers.get('set-cookie');assert.ok(cookie);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Lax/i);
 return cookie.split(';')[0];
}
const post=(path:string,cookie:string,body:unknown,from?:string)=>request(path,{method:'POST',headers:{'Content-Type':'application/json',Origin:from??origin,Cookie:cookie},body:JSON.stringify(body)});
test('匿名ユーザーの保護画面はログインへ誘導しAPIは401',async()=>{
 assert.equal((await request('/login')).status,200);
 for(const path of ['/dashboard','/admin/users']){
  const r=await request(path);assert.equal(r.status,307);assert.ok(r.headers.get('location')?.includes('/login'));
 }
 for(const path of ['/api/auth/session','/api/admin/users','/api/health/db']) assert.equal((await request(path)).status,401,path);
});
test('全2ロールの画面・APIアクセス、Cookie偽造、他Originを拒否',async()=>{
 for(const code of ['HTTP-A','HTTP-ADMIN']){
  const cookie=await login(code);
  assert.equal((await request('/dashboard',{headers:{Cookie:cookie}})).status,200);
  const api=await request('/api/admin/users',{headers:{Cookie:cookie}});assert.equal(api.status,code==='HTTP-ADMIN'?200:403);
  const page=await request('/admin/users',{headers:{Cookie:cookie}});assert.equal(page.status,code==='HTTP-ADMIN'?200:307);
  if(code!=='HTTP-ADMIN'){
   assert.equal((await post('/api/admin/users',cookie,{employee_code:'ESCALATED',name:'X',role:'ADMIN',password})).status,403);
   const own=await (await request('/api/auth/session',{headers:{Cookie:cookie}})).json();
   assert.equal((await post('/api/admin/users/'+own.user.id,cookie,{name:'X',role:'ADMIN',active:true})).status,403);
  }
  assert.equal((await post('/api/auth/logout',cookie,{},'https://evil.invalid')).status,403);
 }
 assert.equal((await request('/api/auth/session',{headers:{Cookie:'toolstock_session=forged'}})).status,401);
 assert.equal((await post('/api/auth/login','',{employee_code:'HTTP-A',password},'https://evil.invalid')).status,403);
 const absent=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employee_code:'HTTP-A',password})});assert.equal(absent.status,403);
});

test('ユーザー管理画面は2ロールを選択でき、廃止ロールをAPIで拒否する',async()=>{
 const cookie=await login('HTTP-ADMIN');
 const response=await request('/admin/users',{headers:{Cookie:cookie}});assert.equal(response.status,200);
 const html=await response.text();
 const selects=[...html.matchAll(/<select\b[^>]*name="role"[^>]*>(.*?)<\/select>/gs)];assert.ok(selects.length>0);
 for(const select of selects)assert.deepEqual([...select[1].matchAll(/<option\b[^>]*value="([^"]+)"/g)].map(option=>option[1]),['WORKER','ADMIN']);
 const user=await db.user.findUniqueOrThrow({where:{employee_code:'HTTP-A'}});
 for(const role of ['STOCK_MANAGER','PURCHASER']){
  assert.equal((await post('/api/admin/users',cookie,{employee_code:'RETIRED-'+role,name:'禁止ロール',role,password})).status,400);
  assert.equal((await post('/api/admin/users/'+user.id,cookie,{name:user.name,role,active:true})).status,400);
 }
 assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).role,'WORKER');
 assert.equal(await db.user.count({where:{employee_code:{startsWith:'RETIRED-'}}}),0);
});
test('管理者の登録・無効化・権限変更・ログアウト・期限切れをHTTP経由で検証',async()=>{
 const cookie=await login('HTTP-ADMIN');
 const created=await post('/api/admin/users',cookie,{employee_code:'HTTP-NEW',name:'架空ユーザー',role:'WORKER',password});assert.equal(created.status,201);
 const {user}=await created.json();assert.ok(!('password_hash' in user));
 let other=await login('HTTP-NEW');
 assert.equal((await post('/api/admin/users/'+user.id,cookie,{name:'架空ユーザー',role:'ADMIN',active:true})).status,200);
 assert.equal((await request('/api/auth/session',{headers:{Cookie:other}})).status,401);
 other=await login('HTTP-NEW');
 assert.equal((await post('/api/admin/users/'+user.id,cookie,{name:'架空ユーザー',role:'ADMIN',active:false})).status,200);
 assert.equal((await request('/api/auth/session',{headers:{Cookie:other}})).status,401);
 const inactive=await post('/api/auth/login','',{employee_code:'HTTP-NEW',password});assert.equal(inactive.status,401);
 const signed=await login('HTTP-A');
 assert.equal((await post('/api/auth/logout',signed,{})).status,200);
 assert.equal((await request('/api/auth/session',{headers:{Cookie:signed}})).status,401);
 const expired=await login('HTTP-A');const token=expired.split('=')[1];
 await db.session.update({where:{token_hash:tokenHash(token)},data:{last_seen_at:new Date(Date.now()-31*60_000),created_at:new Date(Date.now()-60*60_000)}});
 assert.equal((await request('/api/auth/session',{headers:{Cookie:expired}})).status,401);
 assert.equal(await db.auditLog.count({where:{entity_id:user.id}}),3);
 const listing=await (await request('/api/admin/users',{headers:{Cookie:cookie}})).text();assert.ok(!listing.includes('password_hash'));assert.ok(!listing.includes('scrypt$'));
});

test('HTMLフォームのログイン・登録・更新・ログアウトが303で遷移する',async()=>{
 const form=async(path:string,data:Record<string,string>,cookie='')=>request(path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin,Cookie:cookie},body:new URLSearchParams(data)});
 const failed=await form('/api/auth/login',{employee_code:'HTTP-A',password:'wrong'});assert.equal(failed.status,303);assert.match(failed.headers.get('location')??'',/\/login\?error=/);
 const loginResponse=await form('/api/auth/login',{employee_code:'HTTP-ADMIN',password});assert.equal(loginResponse.status,303);assert.equal(loginResponse.headers.get('location'),origin+'/dashboard');
 const cookie=loginResponse.headers.get('set-cookie')!.split(';')[0];
 const created=await form('/api/admin/users',{employee_code:'FORM-USER',name:'フォーム登録',role:'WORKER',password},cookie);assert.equal(created.status,303);
 const user=await db.user.findUniqueOrThrow({where:{employee_code:'FORM-USER'}});
 const updated=await form('/api/admin/users/'+user.id,{name:'フォーム更新',role:'ADMIN',active:'false',password:''},cookie);assert.equal(updated.status,303);
 assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).active,false);
 const list=await request('/admin/users',{headers:{Cookie:cookie}});assert.equal(list.status,200);assert.match(await list.text(),/FORM-USER/);
 const logout=await form('/api/auth/logout',{},cookie);assert.equal(logout.status,303);assert.match(logout.headers.get('set-cookie')??'',/Max-Age=0/);
});
