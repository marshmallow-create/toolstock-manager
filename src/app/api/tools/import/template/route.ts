import { auth, errorResponse, requestToken } from '@/lib/auth/server';
import { createToolTemplate } from '@/lib/masters/tool-workbook';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 try{
  await auth().authenticate(requestToken(request),'tools:import');
  const buffer=await createToolTemplate();
  return new Response(new Uint8Array(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="toolstock-template.xlsx"','Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
