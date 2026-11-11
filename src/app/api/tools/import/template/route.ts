import { auth, errorResponse, requestToken } from '@/lib/auth/server';
import { createToolTemplate } from '@/lib/masters/tool-workbook';
import { AuthError } from '@/lib/auth/service';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 try{
  await auth().authenticate(requestToken(request),'tools:import');
  const mode=new URL(request.url).searchParams.get('mode')??'create';
  if(mode!=='create' && mode!=='update')throw new AuthError(400,'登録・変更の種類を確認してください。');
  const buffer=await createToolTemplate(mode);
  return new Response(new Uint8Array(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="toolstock-${mode==='update'?'update':'template'}.xlsx"`,'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
