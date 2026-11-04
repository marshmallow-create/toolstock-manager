import { requestToken } from '@/lib/auth/server';
import { jsonRead } from '@/lib/masters/server';
import { inventory } from '@/lib/inventory/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return jsonRead(() => inventory().listHistory(requestToken(request), Object.fromEntries(new URL(request.url).searchParams))); }
