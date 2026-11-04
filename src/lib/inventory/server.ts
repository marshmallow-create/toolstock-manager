import { notFound } from 'next/navigation';
import { getDb } from '../db';
import { AuthError } from '../auth/service';
import { mutate, requestToken } from '../auth/server';
import { pageToken } from '../masters/server';
import { InventoryService } from './service';

export const inventory = () => new InventoryService(getDb());
export type InventoryAction = 'issue' | 'receive' | 'adjust' | 'reverse';
export function inventoryMutation(request: Request, action: InventoryAction) {
 const errorPath = (body?: Record<string, unknown>) => {
  if (action === 'reverse') return typeof body?.transaction_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.transaction_id) ? '/history/' + encodeURIComponent(body.transaction_id) : '/history';
  const target = new URL('/inventory/' + action, 'http://localhost');
  if (typeof body?.tool_id === 'string') target.searchParams.set('tool_id', body.tool_id);
  return target.pathname + target.search;
 };
 return mutate(request, '/history', errorPath, async body => {
  const transaction = await inventory()[action](requestToken(request), body);
  return { body: { transaction }, redirectTo: '/history/' + transaction.id };
 });
}
export async function pageHistoryDetail(id: string) {
 try { return await inventory().historyDetail(await pageToken(), id); }
 catch (error) { if (error instanceof AuthError && [400, 404].includes(error.status)) notFound(); throw error; }
}
