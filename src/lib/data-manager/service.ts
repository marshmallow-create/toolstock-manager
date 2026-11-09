import type { PrismaClient } from '../../generated/prisma/client';
import { AuthService } from '../auth/service';
import { definition } from './common';
import { readTable } from './read';
import { saveTable } from './write';

export class DataManager {
 private auth: AuthService;
 constructor(private db: PrismaClient) { this.auth = new AuthService(db); }
 async list(token: string | undefined, table: string, query: Record<string, unknown> = {}) {
  await this.auth.authenticate(token, 'data:manage');
  return readTable(this.db, definition(table), query);
 }
 async save(token: string | undefined, table: string, input: Record<string, unknown>) {
  await this.auth.authenticate(token, 'data:manage');
  return saveTable(this.db, this.auth, token, definition(table), input);
 }
}
