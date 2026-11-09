import { auth, errorResponse, requestToken, readBody, appOrigin } from '@/lib/auth/server';
import { AuthError } from '@/lib/auth/service';
import { getDb } from '@/lib/db';
import { DataManager } from '@/lib/data-manager/service';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ table: string }> };
export async function GET(request: Request, context: Context) {
 try {
  const { table } = await context.params;
  const data = await new DataManager(getDb()).list(requestToken(request), table, Object.fromEntries(new URL(request.url).searchParams));
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
 } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
 try {
  const token = requestToken(request);
  await auth().authenticate(token, 'data:manage');
  if (request.headers.get('origin') !== appOrigin()) throw new AuthError(403, '送信元を確認できません');
  const { table } = await context.params;
  const result = await new DataManager(getDb()).save(token, table, await readBody(request, 128 * 1024));
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
 } catch (error) { return errorResponse(error); }
}
