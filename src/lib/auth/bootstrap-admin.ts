import type {PrismaClient} from '../../generated/prisma/client';
import {hashPassword} from './crypto';
type BootstrapInput = {employeeCode?:string;name?:string;password?:string};
export async function bootstrapAdmin(db:PrismaClient,input:BootstrapInput) {
 return db.$transaction(async tx=>{
  await tx.$executeRaw`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`;
  if(await tx.user.count({where:{role:'ADMIN',active:true,deleted_at:null}}))return {created:false};
  if(await tx.user.count())throw new Error('既存ユーザーが存在するため初期管理者は自動作成できません');
  const employeeCode=input.employeeCode??'ADMIN001',name=input.name??'管理者';
  if(!/^[A-Z0-9_-]{1,32}$/.test(employeeCode)||!name.trim()||name.trim().length>80)throw new Error('初期管理者の社員ID・氏名を確認してください');
  if(!input.password)throw new Error('BOOTSTRAP_ADMIN_PASSWORDを設定してください');
  const password_hash=await hashPassword(input.password);
  const user=await tx.user.create({data:{employee_code:employeeCode,name:name.trim(),role:'ADMIN',password_hash}});
  await tx.auditLog.create({data:{actor_user_id:user.id,action:'INITIAL_ADMIN_CREATED',entity_type:'users',entity_id:user.id,details:{employee_code:employeeCode}}});
  return {created:true,employeeCode};
 },{timeout:10_000});
}
