import { getDb } from '@/lib/db';
import { auth,errorResponse,requestToken } from '@/lib/auth/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 try {
  await auth().authenticate(requestToken(request),'inventory:read');
  await getDb().$queryRaw`SELECT 1`;
  return Response.json({status:'ok',message:'DB接続成功',tools:await getDb().tool.count()},{headers:{'Cache-Control':'no-store'}});
 } catch(error){return errorResponse(error);}
}
