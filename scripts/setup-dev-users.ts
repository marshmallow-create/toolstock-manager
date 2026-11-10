import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { getDb } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth/crypto';
const url=new URL(process.env.DATABASE_URL??'postgresql://invalid');
if(process.env.ALLOW_LOCAL_SEED!=='yes'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/toolstock_dev') throw new Error('ローカル開発DBで ALLOW_LOCAL_SEED=yes を指定してください');
const db=getDb();
try {
 const file='.local/dev-credentials.json';
 let credentials:Record<string,string>={};
 try {credentials=JSON.parse(await readFile(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e;}
 const added:Record<string,string>={};
 await db.$transaction(async tx=>{
  await tx.$executeRaw`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`;
  const actor=await tx.user.findUniqueOrThrow({where:{employee_code:'ADMIN001'}});
  for(const employee_code of ['A001','ADMIN001']){
   const user=await tx.user.findUniqueOrThrow({where:{employee_code}});
   if(!user.active||user.deleted_at||user.password_hash) continue;
   const password=randomBytes(24).toString('base64url');
   await tx.user.update({where:{id:user.id},data:{password_hash:await hashPassword(password)}});
   await tx.auditLog.create({data:{actor_user_id:actor.id,action:'DEV_PASSWORD_INITIALIZED',entity_type:'users',entity_id:user.id,details:{employee_code}}});
   added[employee_code]=password;
  }
  await mkdir('.local',{recursive:true});
  await writeFile(file,JSON.stringify({...credentials,...added},null,2)+'\n',{mode:0o600});
 },{timeout:10_000});
 console.log('資格情報設定完了: '+Object.keys(added).length+'件。パスワードは .local/dev-credentials.json に保存しました（既存の資格情報は変更しません）。');
} finally {await db.$disconnect();}
