import type { PrismaClient, Prisma } from '../../generated/prisma/client';
import { hashPassword, verifyPassword, createToken, tokenHash } from './crypto';
import { can, type Role, roleLabels } from './permissions';
export class AuthError extends Error { constructor(public status:number,message:string) {super(message);} }
const denied=()=>new AuthError(401,'社員IDまたはパスワードを確認してください');
const unauthorized=()=>new AuthError(401,'ログインしてください');
const selectUser = {id:true,employee_code:true,name:true,role:true,active:true} as const;
export type Viewer = {id:string;employee_code:string;name:string;role:Role;active:boolean};
type Client = Prisma.TransactionClient;
export const IDLE_MS=30*60_000, MAX_MS=8*60*60_000;
export class AuthService {
 constructor(private db:PrismaClient, private clock:()=>Date=()=>new Date()) {}
 async login(code:string,password:string) {
  if(typeof code!=='string'||typeof password!=='string'||code.length>32||password.length>128||!code.trim()||!password) throw denied();
  const employee_code=code.trim().toUpperCase(), now=this.clock();
  const result=await this.db.$transaction(async tx=>{
   const key=tokenHash(employee_code);
   let attempt=await tx.loginAttempt.upsert({where:{key},create:{key,attempts:1,started_at:now},update:{attempts:{increment:1}}});
   if(now.getTime()-attempt.started_at.getTime()>=15*60_000) attempt=await tx.loginAttempt.update({where:{key},data:{attempts:1,started_at:now}});
   if(attempt.attempts>5) return {error:new AuthError(429,'試行回数が上限に達しました。15分後に再試行してください')};
   await tx.$queryRaw`SELECT id FROM users WHERE employee_code=${employee_code} FOR UPDATE`;
   const user=await tx.user.findUnique({where:{employee_code}});
   const valid=await verifyPassword(password,user?.password_hash??null);
   if(!user||!user.active||!valid) return {error:denied()};
   const token=createToken();
   await tx.session.create({data:{token_hash:tokenHash(token),user_id:user.id,created_at:now,last_seen_at:now,expires_at:new Date(now.getTime()+MAX_MS)}});
   await tx.loginAttempt.delete({where:{key}});
   await tx.auditLog.create({data:{actor_user_id:user.id,action:'SESSION_LOGIN',entity_type:'sessions',entity_id:tokenHash(token),details:{result:'success'}}});
   return {token,user:await tx.user.findUniqueOrThrow({where:{id:user.id},select:selectUser})};
  },{timeout:10_000});
  if('error' in result) throw result.error;
  return result;
 }
 private async authenticated(client:Client,token:string|undefined) {
  if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized();
  const hash=tokenHash(token), now=this.clock();
  const session=await client.session.findUnique({where:{token_hash:hash},include:{user_record:{select:selectUser}}});
  if(!session||!session.user_record.active||session.expires_at<=now||now.getTime()-session.last_seen_at.getTime()>=IDLE_MS) throw unauthorized();
  const touched=await client.session.updateMany({where:{token_hash:hash,expires_at:{gt:now},last_seen_at:{gt:new Date(now.getTime()-IDLE_MS)},user_record:{active:true}},data:{last_seen_at:now}});
  if(!touched.count) throw unauthorized();
  return session.user_record;
 }
 async authenticate(token:string|undefined,permission?:string) {
  const user=await this.authenticated(this.db,token);
  if(permission&&!can(user.role,permission)) throw new AuthError(403,'この操作を行う権限がありません');
  return user;
 }
 async logout(token:string|undefined) {
  if(!token)return;
  await this.db.$transaction(async tx=>{
   const hash=tokenHash(token),session=await tx.session.findUnique({where:{token_hash:hash}});
   const deleted=await tx.session.deleteMany({where:{token_hash:hash}});
   if(session&&deleted.count)await tx.auditLog.create({data:{actor_user_id:session.user_id,action:'SESSION_LOGOUT',entity_type:'sessions',entity_id:hash,details:{result:'success'}}});
  });
 }
 async listUsers(token:string|undefined) {
  await this.authenticate(token,'users:manage');
  return this.db.user.findMany({select:selectUser,orderBy:{employee_code:'asc'}});
 }
 private validate(input:{name:unknown;role:unknown;active?:unknown;employee_code?:unknown;password?:unknown},creating:boolean) {
  if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>80||typeof input.role!=='string'||!Object.hasOwn(roleLabels,input.role)) throw new AuthError(400,'氏名とロールを確認してください');
  if(!creating&&typeof input.active!=='boolean') throw new AuthError(400,'有効状態を選択してください');
  if(creating&&(typeof input.employee_code!=='string'||!/^[A-Z0-9_-]{1,32}$/.test(input.employee_code))) throw new AuthError(400,'社員IDは半角英大文字・数字・ハイフン・アンダースコア32文字以内です');
  if((creating||input.password)&& (typeof input.password!=='string'||input.password.length<12||input.password.length>128)) throw new AuthError(400,'パスワードは12〜128文字で設定してください');
 }
 private async asAdmin<T>(token:string|undefined,operation:(tx:Client,actor:Viewer)=>Promise<T>) {
  return this.db.$transaction(async tx=>{
   // 管理者の同時降格による全管理者喪失を防ぐ。小規模ローカル運用の管理操作だけを直列化する。
   await tx.$executeRaw`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`;
   const actor=await this.authenticated(tx,token);
   if(!can(actor.role,'users:manage')) throw new AuthError(403,'この操作を行う権限がありません');
   return operation(tx,actor);
  },{timeout:10_000});
 }
 async createUser(token:string|undefined,input:{employee_code:string;name:string;role:Role;password:string}) {
  await this.authenticate(token,'users:manage'); this.validate(input,true);
  const password_hash=await hashPassword(input.password);
  try { return await this.asAdmin(token,async(tx,actor)=>{
   const user=await tx.user.create({data:{employee_code:input.employee_code,name:input.name.trim(),role:input.role,password_hash},select:selectUser});
   await tx.auditLog.create({data:{actor_user_id:actor.id,action:'USER_CREATED',entity_type:'users',entity_id:user.id,details:{employee_code:user.employee_code,role:user.role}}});
   return user;
  }); } catch(e) { if((e as {code?:string}).code==='P2002') throw new AuthError(409,'社員IDは登録済みです'); throw e; }
 }
 async updateUser(token:string|undefined,id:string,input:{name:string;role:Role;active:boolean;password?:string}) {
  await this.authenticate(token,'users:manage'); this.validate(input,false);
  if(!/^[0-9a-f-]{36}$/i.test(id)) throw new AuthError(400,'ユーザーIDが不正です');
  const password_hash=input.password?await hashPassword(input.password):undefined;
  return this.asAdmin(token,async(tx,actor)=>{
   const before=await tx.user.findUnique({where:{id},select:selectUser});
   if(!before) throw new AuthError(404,'ユーザーが見つかりません');
   if(id===actor.id&&(!input.active||input.role!=='ADMIN')) throw new AuthError(409,'自分自身を無効化・降格することはできません');
   if(before.active&&before.role==='ADMIN'&&(!input.active||input.role!=='ADMIN')&&await tx.user.count({where:{active:true,role:'ADMIN'}})<=1) throw new AuthError(409,'有効な管理者を1人以上残してください');
   const user=await tx.user.update({where:{id},data:{name:input.name.trim(),role:input.role,active:input.active,...(password_hash?{password_hash}:{})},select:selectUser});
   if(before.role!==user.role||before.active!==user.active||password_hash) await tx.session.deleteMany({where:{user_id:id}});
   await tx.auditLog.create({data:{actor_user_id:actor.id,action:'USER_UPDATED',entity_type:'users',entity_id:id,details:{before,after:user,password_changed:!!password_hash}}});
   return user;
  });
 }
}
