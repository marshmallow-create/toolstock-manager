import { mutate, requestToken } from '@/lib/auth/server';
import { masters, jsonRead } from '@/lib/masters/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
 return jsonRead(() => masters().listTools(requestToken(request), Object.fromEntries(new URL(request.url).searchParams)));
}
export async function POST(request: Request) {
 return mutate(request, '/dashboard?saved=1', '/tools/new', async body => ({ status: 201, body: { tool: await masters().createTool(requestToken(request), body) } }));
}
