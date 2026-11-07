import { getDb } from '../db';
import { mutate, requestToken } from '../auth/server';
import { InventoryService } from './service';

export const inventory = () => new InventoryService(getDb());
export type InventoryAction = 'issue' | 'receive' | 'reverse';
export function inventoryMutation(request: Request, action: InventoryAction) {
 const errorPath = (body?: Record<string, unknown>) => {
  if (action === 'reverse') return '/history';
  if (typeof body?.tool_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.tool_id)) return '/dashboard';
  return '/tools/' + encodeURIComponent(body.tool_id) + '?operation=' + action + '#inventory-' + action;
 };
 return mutate(request, '/history', errorPath, async body => {
  const transaction = await inventory()[action](requestToken(request), body);
  return { body: { transaction }, redirectTo: '/history?' + new URLSearchParams({ tool_id: transaction.tool_id, saved: '1' }) };
 });
}
