import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { AuthService } from '../../src/lib/auth/service';
import { hashPassword } from '../../src/lib/auth/crypto';

export async function databaseFixture(prefix: string) {
 const url = process.env.TEST_DATABASE_URL;
 if (!url || !/test/i.test(new URL(url).pathname)) throw new Error('専用のTEST_DATABASE_URLが必要です');
 const schema = prefix + '_' + randomUUID().replaceAll('-', '');
 const admin = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
 await admin.connect();
 await admin.query('CREATE SCHEMA ' + schema);
 await admin.query('SET search_path TO ' + schema);
 for (const name of (await readdir('prisma/migrations')).filter(n => /^\d/.test(n)).sort()) {
  await admin.query(await readFile('prisma/migrations/' + name + '/migration.sql', 'utf8'));
 }
 const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: '-c search_path=' + schema }, { schema }) });
 const auth = new AuthService(db);
 const password = 'Fictional-masters-test-123';
 const password_hash = await hashPassword(password);
 const tokens: Record<string, string> = {};
 const users: Record<string, string> = {};
 for (const role of ['WORKER', 'STOCK_MANAGER', 'PURCHASER', 'ADMIN'] as const) {
  const user = await db.user.create({ data: { employee_code: role, name: '架空' + role, role, password_hash } });
  users[role] = user.id;
  tokens[role] = (await auth.login(role, password)).token;
 }
 return { db, auth, admin, schema, url, password, tokens, users, async close() {
  await db.$disconnect();
  await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  await admin.end();
 } };
}
