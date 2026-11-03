import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
const globalDb = globalThis as unknown as { db?: PrismaClient };
export function getDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL が未設定です');
  return globalDb.db ??= new PrismaClient({ adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000,
  }, { schema: new URL(process.env.DATABASE_URL).searchParams.get('schema') ?? 'public' }) });
}
