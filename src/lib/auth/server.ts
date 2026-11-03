import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getDb } from '../db';
import { AuthService, AuthError, MAX_MS } from './service';
export const COOKIE='toolstock_session';
export const auth=()=>new AuthService(getDb());
export function appOrigin() { return new URL(process.env.APP_ORIGIN??'http://127.0.0.1:3000').origin; }
export function requestToken(request:Request) { return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1); }
export async function pageUser(permission?:string) {
 try { return await auth().authenticate((await cookies()).get(COOKIE)?.value,permission); }
 catch(error) { if(error instanceof AuthError) redirect(error.status===403?'/dashboard?denied=1':'/login'); throw error; }
}
export function errorResponse(error:unknown) {
 const known=error instanceof AuthError;
 return NextResponse.json({error:known?error.message:'処理に失敗しました。DB接続を確認してください'}, {status:known?error.status:503,headers:{'Cache-Control':'no-store'}});
}
export async function readBody(request:Request):Promise<Record<string,unknown>> {
 const reader=request.body?.getReader();let text='';let size=0;const decoder=new TextDecoder();
 if(reader) { for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new AuthError(413,'入力が長すぎます');}text+=decoder.decode(value,{stream:true});} text+=decoder.decode(); }
 try {
  const type=request.headers.get('content-type')?.split(';')[0];
  if(type==='application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(text));
  if(type!=='application/json') throw new AuthError(415,'入力形式が不正です');
  const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body)) throw new Error();return body;
 } catch(error){if(error instanceof AuthError)throw error;throw new AuthError(400,'入力を確認してください');}
}
type MutationResult={body?:unknown;status?:number;token?:string|null};
export async function mutate(request:Request,successPath:string,errorPath:string,operation:(body:Record<string,unknown>)=>Promise<MutationResult>) {
 const form=request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded');
 try {
  if(request.headers.get('origin')!==appOrigin()) throw new AuthError(403,'送信元を確認できません');
  const result=await operation(await readBody(request));
  const response=form?NextResponse.redirect(new URL(successPath,appOrigin()),303):NextResponse.json(result.body??{ok:true},{status:result.status??200});
  response.headers.set('Cache-Control','no-store');
  if(result.token!==undefined) response.cookies.set(COOKIE,result.token??'',{httpOnly:true,sameSite:'lax',secure:appOrigin().startsWith('https:'),path:'/',maxAge:result.token?MAX_MS/1000:0});
  return response;
 } catch(error) {
  if(form&&error instanceof AuthError&&error.status!==403){
   const target=error.status===401&&errorPath!=='/login'?'/login':errorPath;
   return NextResponse.redirect(new URL(target+'?error='+encodeURIComponent(error.message),appOrigin()),303);
  }
  return errorResponse(error);
 }
}
