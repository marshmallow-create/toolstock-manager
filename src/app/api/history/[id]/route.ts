import { requestToken } from '@/lib/auth/server';
import { jsonRead } from '@/lib/masters/server';
import { inventory } from '@/lib/inventory/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
 const { id } = await context.params;
 return jsonRead(async () => ({ transaction: await inventory().historyDetail(requestToken(request), id) }));
}
