import { mutate, requestToken } from '@/lib/auth/server';
import { masters } from '@/lib/masters/server';
export async function POST(request: Request, context: { params: Promise<{ kind: string; id: string }> }) {
 const { kind, id } = await context.params;
 return mutate(request, '/admin/masters?saved=1', '/admin/masters', async body => ({ body: { master: await masters().updateMaster(requestToken(request), kind, id, body) } }));
}
