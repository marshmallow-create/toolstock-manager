import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { tokenHash } from '../auth/crypto';
import { integer, text } from '../masters/validation';
import { delegate, digest, redact, versionOf } from './common';
import { virtualFields, type Cell, type DataRow, type Definition, type TableData } from './definitions';

type Db = PrismaClient | Prisma.TransactionClient;
const referenceFields = { tool: ['tool_code', 'name'], user: ['employee_code', 'name'], location: ['location_code', 'name'], supplier: ['supplier_code', 'name'], purchaseOrder: ['order_no'], machine: ['machine_code', 'name'] } as const;
const relationName = (key: string) => key === 'requested_by' || key === 'approved_by' ? key + '_record' : key + '_record';

export async function authenticationRows(db: Db, key: string): Promise<DataRow[]> {
 const users = await db.user.findMany({ select: { id: true, employee_code: true, name: true }, orderBy: { employee_code: 'asc' } });
 if (key === 'sessions') {
  const sessions = await db.session.findMany({ orderBy: { token_hash: 'asc' } });
  return users.flatMap(user => {
   const group = sessions.filter(session => session.user_id === user.id);
   return group.length ? [{ id: user.id, version: digest(group.map(({ token_hash, created_at, expires_at }) => ({ token_hash, created_at, expires_at }))), editable: true, values: { employee_code: user.employee_code, name: user.name, count: group.length, last_seen_at: new Date(Math.max(...group.map(session => session.last_seen_at.getTime()))).toISOString(), revoke: false } }] : [];
  });
 }
 const attempts = await db.loginAttempt.findMany({ orderBy: { key: 'asc' } });
 const knownKeys = new Set(users.map(user => tokenHash(user.employee_code)));
 const rows: DataRow[] = users.flatMap(user => {
  const attempt = attempts.find(attempt => attempt.key === tokenHash(user.employee_code));
  return attempt ? [{ id: user.id, version: digest(attempt), editable: true, values: { employee_code: user.employee_code, name: user.name, attempts: attempt.attempts, started_at: attempt.started_at.toISOString(), reset: false } }] : [];
 });
 const unknown = attempts.filter(attempt => !knownKeys.has(attempt.key));
 if (unknown.length) rows.push({ id: 'unknown', version: digest(unknown), editable: true, values: { employee_code: '未登録ID', name: `${unknown.length}件の未登録ID`, attempts: unknown.reduce((sum, row) => sum + row.attempts, 0), started_at: new Date(Math.min(...unknown.map(row => row.started_at.getTime()))).toISOString(), reset: false } });
 return rows;
}

export async function readTable(db: PrismaClient, table: Definition, query: Record<string, unknown> = {}): Promise<TableData> {
 const q = text(query.q ?? '', '検索語', 100, true);
 const page = query.page === undefined || query.page === '' ? 1 : integer(query.page, 'ページ', 1, 1_000_000);
 const pageSize = 50;
 if (table.mode === 'revoke' || table.mode === 'reset') {
  const rows = (await authenticationRows(db, table.key)).filter(row => !q || Object.values(row.values).some(value => String(value).toLowerCase().includes(q.toLowerCase())));
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
 }
 const or: Record<string, unknown>[] = table.search.map(field => ({ [field]: { contains: q, mode: 'insensitive' } }));
 for (const field of table.fields) if (field.reference) {
  or.push({ [relationName(field.key)]: { OR: referenceFields[field.reference].map(key => ({ [key]: { contains: q, mode: 'insensitive' } })) } });
 }
 const where = q ? { OR: or } : {};
 const select: Record<string, unknown> = { id: true, updated_at: true };
 for (const field of table.fields) if (!virtualFields.has(field.key)) select[field.key] = true;
 if (table.key === 'history') select.inventory_transactions_reverses_id_children = { select: { id: true } };
 const model = delegate(db, table);
 const total = await model.count({ where });
 const records = page > Math.ceil(total / pageSize) ? [] : await model.findMany({ where, select, orderBy: table.key === 'history' || table.key === 'audit' ? [{ created_at: 'desc' }, { id: 'desc' }] : [{ created_at: 'asc' }, { id: 'asc' }], take: pageSize, skip: (page - 1) * pageSize });
 const labels = new Map<string, string>();
 for (const field of table.fields) if (field.reference) {
  const ids = [...new Set(records.map(row => row[field.key]).filter((id): id is string => typeof id === 'string'))];
  const refTable: Definition = { key: '', model: field.reference, label: '', group: '', fields: [], search: [] };
  const rows = await delegate(db, refTable).findMany({ where: { id: { in: ids } }, select: { id: true, ...Object.fromEntries(referenceFields[field.reference].map(key => [key, true])) } });
  for (const row of rows) labels.set(field.key + ':' + row.id, referenceFields[field.reference].map(key => row[key]).filter(Boolean).join(' / '));
 }
 const rows = records.map(row => {
  const values: Record<string, Cell> = {};
  for (const field of table.fields) {
   const value = row[field.key];
   if (field.kind === 'password' || field.key === 'correction_reason') values[field.key] = '';
   else if (field.reference) values[field.key] = typeof value === 'string' ? labels.get(field.key + ':' + value) ?? value : null;
   else if (field.kind === 'json') values[field.key] = JSON.stringify(redact(value), null, 2);
   else if (field.kind === 'date') values[field.key] = value instanceof Date ? value.toISOString() : null;
   else if (value === null || value === undefined) values[field.key] = null;
   else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[field.key] = value;
   else values[field.key] = String(value);
  }
  if (table.key === 'audit' && ['sessions', 'login_attempts'].includes(String(row.entity_type))) values.entity_id = '認証情報（非表示）';
  const reversal = row.inventory_transactions_reverses_id_children as { id: string } | null | undefined;
  if (table.key === 'history') values.reversal_id = reversal?.id ?? null;
  return { id: row.id, version: versionOf(row), values, editable: table.mode !== 'readonly' && (table.key !== 'history' || (row.type !== 'REVERSAL' && !reversal)) };
 });
 return { rows, total, page, pageSize };
}
