import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
const globalDb = globalThis as unknown as {
  db?: PrismaClient;
  dbConstructor?: typeof PrismaClient;
  dbUrl?: string;
};
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL が未設定です');
  // Hot reload preserves globalThis, including clients generated from an older schema.
  if (globalDb.db && globalDb.dbConstructor === PrismaClient && globalDb.dbUrl === url) return globalDb.db;
  const previous = globalDb.db;
  const db = new PrismaClient({ adapter: new PrismaPg({
    connectionString: url, connectionTimeoutMillis: 3000,
  }, { schema: new URL(url).searchParams.get('schema') ?? 'public' }) });
  globalDb.db = db;
  globalDb.dbConstructor = PrismaClient;
  globalDb.dbUrl = url;
  // Release the retired pool without blocking creation of the current client.
  if (previous) void previous.$disconnect().catch(() => undefined);
  return db;
}
