import { appOrigin, auth, errorResponse, requestToken } from '@/lib/auth/server';
import { AuthError } from '@/lib/auth/service';
import { getDb } from '@/lib/db';
import { readImportFile } from '@/lib/masters/import-request';
import { parseToolWorkbook } from '@/lib/masters/tool-workbook';
import { previewToolImport, commitToolImport } from '@/lib/masters/tool-import';
import { previewToolUpdate, commitToolUpdate } from '@/lib/masters/tool-update';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
 try{
  const token=requestToken(request), service=auth();
  await service.authenticate(token,'tools:import');
  if(request.headers.get('origin')!==appOrigin())throw new AuthError(403,'送信元を確認できません');
  const {buffer,action,mode,previewToken}=await readImportFile(request), rows=await parseToolWorkbook(buffer,mode);
  if(mode==='update'){
   const result=action==='commit'?await commitToolUpdate(getDb(),service,token,rows,previewToken):await previewToolUpdate(getDb(),service,token,rows);
   return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }
  if(action==='commit')return Response.json(await commitToolImport(getDb(),service,token,rows),{status:201,headers:{'Cache-Control':'no-store'}});
  return Response.json(await previewToolImport(getDb(),service,token,rows),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
