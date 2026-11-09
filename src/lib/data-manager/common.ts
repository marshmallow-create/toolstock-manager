import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AuthError } from '../auth/service';
import { tableDefinitions, type Definition } from './definitions';

export type RecordData = Record<string, unknown> & { id: string; updated_at: Date };
// All delegates and columns are selected from definitions, never from request-supplied model names.
type Delegate = {
 findMany(args: Record<string, unknown>): Promise<RecordData[]>;
 findUnique(args: Record<string, unknown>): Promise<RecordData | null>;
 count(args: Record<string, unknown>): Promise<number>;
 updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
};
export const delegate = (db: PrismaClient | Prisma.TransactionClient, table: Definition): Delegate => db[table.model as keyof typeof db] as unknown as Delegate;
export function definition(key: unknown) {
 const table = tableDefinitions.find(table => table.key === key);
 if (!table) throw new AuthError(404, '対象のデータが見つかりません');
 return table;
}
export function record(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, '入力内容を確認してください');
 return value as Record<string, unknown>;
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function redact(value: unknown): unknown {
 if (value instanceof Date) return value.toISOString();
 if (value && typeof value === 'object' && 'toJSON' in value && typeof value.toJSON === 'function') return redact(value.toJSON());
 if (Array.isArray(value)) return value.map(redact);
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/password|token|fingerprint|idempotency|request_key/i.test(key)).map(([key, item]) => [key, redact(item)]));
 return value;
}
export const versionOf = (row: RecordData) => row.updated_at.toISOString();
