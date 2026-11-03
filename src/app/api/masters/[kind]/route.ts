import { mutate, requestToken } from '@/lib/auth/server';
import { masters, jsonRead } from '@/lib/masters/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
 const { kind } = await context.params;
 return jsonRead(async () => ({ masters: await masters().listMasters(requestToken(request), kind) }));
}
export async function POST(request: Request, context: { params: Promise<{ kind: string }> }) {
 const { kind } = await context.params;
 return mutate(request, '/admin/masters?saved=1', '/admin/masters', async body => ({ status: 201, body: { master: await masters().createMaster(requestToken(request), kind, body) } }));
}
