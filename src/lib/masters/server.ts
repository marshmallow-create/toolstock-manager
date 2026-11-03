import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getDb } from '../db';
import { AuthError } from '../auth/service';
import { errorResponse } from '../auth/server';
import { COOKIE } from '../auth/server';
import { MastersService } from './service';
export const masters = () => new MastersService(getDb());
export const pageToken = async () => (await cookies()).get(COOKIE)?.value;
export async function jsonRead(operation: () => Promise<unknown>) {
 try { return Response.json(await operation(), { headers: { 'Cache-Control': 'no-store' } }); }
 catch (error) { return errorResponse(error); }
}
export async function pageTool(id: string) {
 try { return await masters().toolDetail(await pageToken(), id); }
 catch (error) { if (error instanceof AuthError && [400, 404].includes(error.status)) notFound(); throw error; }
}
