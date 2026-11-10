import { getDb } from '../db';
import { mutate, requestToken } from '../auth/server';
import { InventoryService } from './service';
import { historyReturnPath } from './validation';

export const inventory = () => new InventoryService(getDb());
export type InventoryAction = 'issue' | 'receive' | 'reverse';
export function inventoryMutation(request: Request, action: InventoryAction) {
 const errorPath = (body?: Record<string, unknown>) => {
  if (action === 'reverse') {
   try { return historyReturnPath(body?.return_to) ?? '/history'; } catch { return '/history'; }
  }
  if (typeof body?.tool_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.tool_id)) return '/dashboard';
  return '/tools/' + encodeURIComponent(body.tool_id) + '?operation=' + action + '#inventory-' + action;
 };
 return mutate(request, '/history', errorPath, async body => {
  const returnTo = action === 'reverse' ? historyReturnPath(body.return_to) : undefined;
  const transaction = await inventory()[action](requestToken(request), body);
  const historyTarget = new URL(returnTo ?? '/history?' + new URLSearchParams({ tool_id: transaction.tool_id }), 'http://toolstock.invalid');
  historyTarget.searchParams.set('saved', '1');
  const redirectTo = action === 'reverse'
   ? historyTarget.pathname + historyTarget.search + historyTarget.hash
   : '/tools/' + encodeURIComponent(transaction.tool_id) + '?saved=1';
  return { body: { transaction }, redirectTo };
 });
}
