import { AuthError } from '../auth/service';
import { calendarDate, optionalId } from '../inventory/validation';
import { categoryValue } from '../masters/validation';
import { categoryCode } from '../tool-options';

const DAY = 86_400_000;
export type AnalyticsQuery = Record<string, unknown>;
export type AnalyticsFilters = ReturnType<typeof analyticsFilters>;
export type AnalyticsRow = {
 type: string; quantity: number; amount: string | null; created_at: Date;
 tool: { id: string; tool_code: string; name: string; category: string; active: boolean };
};
export const jstDate = (date: Date) => new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const dateString = (date: Date) => date.toISOString().slice(0, 10);
const utcDate = (value: string) => new Date(value + 'T00:00:00Z');
const shiftDays = (value: string, days: number) => dateString(new Date(utcDate(value).getTime() + days * DAY));
function monthDate(year: number, month: number, day: number) {
 const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
 return dateString(new Date(Date.UTC(year, month, Math.min(day, last))));
}
export function analyticsFilters(query: AnalyticsQuery, now = new Date()) {
 const period = query.period === undefined || query.period === '' ? 'month' : query.period;
 if (typeof period !== 'string' || !['month', 'last-month', 'year', 'custom'].includes(period)) throw new AuthError(400, '集計期間を選択してください');
 const today = jstDate(now), year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)) - 1, day = Number(today.slice(8));
 let from: string, to: string, previousFrom: string, previousTo: string;
 if (period === 'custom') {
  const start = calendarDate(query.from), finish = calendarDate(query.to);
  if (!start || !finish || start > finish || jstDate(start) < '1900-01-01' || jstDate(finish) > '9998-12-31' || finish.getTime() - start.getTime() >= 366 * DAY) throw new AuthError(400, '1900年〜9998年の開始日・終了日を指定してください。集計期間は366日以内です。');
  from = jstDate(start); to = jstDate(finish);
  const days = (finish.getTime() - start.getTime()) / DAY + 1;
  previousFrom = shiftDays(from, -days); previousTo = shiftDays(from, -1);
 } else if (period === 'last-month') {
  from = monthDate(year, month - 1, 1); to = shiftDays(monthDate(year, month, 1), -1);
  previousFrom = monthDate(year, month - 2, 1); previousTo = shiftDays(from, -1);
 } else if (period === 'year') {
  from = `${year}-01-01`; to = today;
  previousFrom = `${year - 1}-01-01`; previousTo = monthDate(year - 1, month, day);
 } else {
  from = monthDate(year, month, 1); to = today;
  previousFrom = monthDate(year, month - 1, 1); previousTo = monthDate(year, month - 1, day);
 }
 const category = categoryValue(query.category, true), toolId = optionalId(query.tool_id);
 const sort = query.sort === undefined || query.sort === '' ? 'amount' : query.sort;
 if (sort !== 'amount' && sort !== 'quantity') throw new AuthError(400, 'ランキングの並び順を選択してください');
 return { period, from, to, previousFrom, previousTo, category, toolId, sort: sort as 'amount' | 'quantity',
  start: calendarDate(from)!, end: new Date(calendarDate(to)!.getTime() + DAY),
  previousStart: calendarDate(previousFrom)!, previousEnd: new Date(calendarDate(previousTo)!.getTime() + DAY),
  granularity: (period === 'year' || (utcDate(to).getTime() - utcDate(from).getTime()) / DAY > 62 ? 'month' : 'day') as 'month' | 'day',
 };
}

function cents(value: string) {
 const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace(/^-/, '').split('.');
 const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
 return negative ? -result : result;
}
function decimal(value: bigint) {
 const absolute = value < 0n ? -value : value;
 return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
export function moneyChange(current: string, previous: string) {
 const delta = cents(current) - cents(previous), base = cents(previous);
 const tenths = base === 0n ? null : (delta * 1000n + (delta >= 0n ? base / 2n : -(base / 2n))) / base;
 return { difference: decimal(delta), percent: tenths === null ? null : `${tenths < 0n ? '-' : ''}${(tenths < 0n ? -tenths : tenths) / 10n}.${(tenths < 0n ? -tenths : tenths) % 10n}` };
}

export function summarizeTransactions(rows: AnalyticsRow[], filters: AnalyticsFilters) {
 let issue = 0n, receive = 0n, issueCount = 0, issueQuantity = 0, receiveCount = 0, missingIssue = 0, missingReceive = 0;
 const tools = new Map<string, AnalyticsRow['tool'] & { quantity: number; amount: bigint; missing: number; known: number }>();
 const categories = new Map<string, { amount: bigint; missing: number; known: number }>();
 const trend = new Map<string, { issue: bigint; receive: bigint; missing: number }>();
 for (let date = filters.from; date <= filters.to; date = shiftDays(date, 1)) {
  const key = filters.granularity === 'month' ? date.slice(0, 7) : date;
  if (!trend.has(key)) trend.set(key, { issue: 0n, receive: 0n, missing: 0 });
 }
 for (const row of rows) {
  if (!['ISSUE', 'RECEIVE'].includes(row.type) || row.created_at < filters.start || row.created_at >= filters.end) continue;
  const category = categoryCode(row.tool.category) ?? row.tool.category;
  if (filters.category && category !== filters.category || filters.toolId && row.tool.id !== filters.toolId) continue;
  const amount = row.amount === null ? 0n : cents(row.amount), absolute = amount < 0n ? -amount : amount;
  const point = trend.get(filters.granularity === 'month' ? jstDate(row.created_at).slice(0, 7) : jstDate(row.created_at))!;
  if (row.amount === null) point.missing++;
  if (row.type === 'RECEIVE') {
   receive += absolute; receiveCount++; point.receive += absolute;
   if (row.amount === null) missingReceive++;
   continue;
  }
  issue += absolute; issueCount++; issueQuantity += Math.abs(row.quantity); point.issue += absolute;
  if (row.amount === null) missingIssue++;
  const tool = tools.get(row.tool.id) ?? { ...row.tool, category, quantity: 0, amount: 0n, missing: 0, known: 0 };
  tool.quantity += Math.abs(row.quantity); tool.amount += absolute;
  if (row.amount === null) tool.missing++; else tool.known++;
  tools.set(row.tool.id, tool);
  const group = categories.get(category) ?? { amount: 0n, missing: 0, known: 0 };
  group.amount += absolute; if (row.amount === null) group.missing++; else group.known++;
  categories.set(category, group);
 }
 const descending = (a: bigint, b: bigint) => a > b ? -1 : a < b ? 1 : 0;
 const ranking = [...tools.values()].sort((a, b) => (filters.sort === 'quantity' ? b.quantity - a.quantity : descending(a.amount, b.amount)) || a.tool_code.localeCompare(b.tool_code)).slice(0, 10);
 return {
  issueAmount: decimal(issue), receiveAmount: decimal(receive), issueCount, issueQuantity, receiveCount, toolCount: tools.size, missingIssue, missingReceive,
  ranking: ranking.map(tool => ({ ...tool, amount: decimal(tool.amount) })),
  trend: [...trend].map(([date, point]) => ({ date, issueAmount: decimal(point.issue), receiveAmount: decimal(point.receive), missing: point.missing })),
  categories: [...categories].sort((a,b) => descending(a[1].amount,b[1].amount) || a[0].localeCompare(b[0])).map(([category, group]) => ({category,amount:decimal(group.amount),missing:group.missing,known:group.known,share:issue === 0n || group.known === 0 ? null : Number(group.amount * 1000n / issue) / 10})),
 };
}
