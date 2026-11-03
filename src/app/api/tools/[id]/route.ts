import { mutate, requestToken } from '@/lib/auth/server';
import { masters, jsonRead } from '@/lib/masters/server';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
 const { id } = await context.params;
 return jsonRead(async () => ({ tool: await masters().toolDetail(requestToken(request), id) }));
}
export async function POST(request: Request, context: Context) {
 const { id } = await context.params, path = '/tools/' + encodeURIComponent(id);
 return mutate(request, path + '?saved=1', path + '/edit', async body => ({ body: { tool: await masters().updateTool(requestToken(request), id, body) } }));
}
