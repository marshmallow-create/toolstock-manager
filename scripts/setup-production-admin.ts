import 'dotenv/config';
import {getDb} from '../src/lib/db';
import {bootstrapAdmin} from '../src/lib/auth/bootstrap-admin';
const db=getDb();
try {
 const result=await bootstrapAdmin(db,{employeeCode:process.env.BOOTSTRAP_ADMIN_EMPLOYEE_CODE,name:process.env.BOOTSTRAP_ADMIN_NAME,password:process.env.BOOTSTRAP_ADMIN_PASSWORD});
 console.log(result.created?'初期管理者を作成しました。パスワードはログに表示しません。':'既存管理者を維持しました。');
} catch {
 console.error('初期管理者の設定に失敗しました。DB接続とBOOTSTRAP_ADMIN設定を確認してください。');
 process.exitCode=1;
} finally {await db.$disconnect();}
