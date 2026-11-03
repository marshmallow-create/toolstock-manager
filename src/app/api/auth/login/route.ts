import { auth,mutate,requestToken } from '@/lib/auth/server';
export const runtime='nodejs';
export async function POST(request:Request) {
 return mutate(request,'/dashboard','/login',async body=>{
  const result=await auth().login(body.employee_code as string,body.password as string);
  // 同じブラウザのログイン前セッションを置換する。
  await auth().logout(requestToken(request));
  return {token:result.token,body:{user:result.user}};
 });
}
