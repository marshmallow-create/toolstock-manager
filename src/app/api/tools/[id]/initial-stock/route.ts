import { mutate, requestToken } from '@/lib/auth/server';
import { masters } from '@/lib/masters/server';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
 const { id } = await context.params, path = '/tools/' + encodeURIComponent(id);
 return mutate(request, path + '?saved=1', path, async body => ({ status: 201, body: { stock: await masters().registerInitialStock(requestToken(request), id, body) } }));
}
