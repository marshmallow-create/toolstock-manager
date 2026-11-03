import { mutate, requestToken } from '@/lib/auth/server';
import { masters } from '@/lib/masters/server';
export async function POST(request: Request, context: { params: Promise<{ id: string; conditionId: string }> }) {
 const { id, conditionId } = await context.params, path = '/tools/' + encodeURIComponent(id);
 return mutate(request, path + '?saved=1', path, async body => ({ body: { condition: await masters().saveSupplierItem(requestToken(request), id, conditionId, body) } }));
}
