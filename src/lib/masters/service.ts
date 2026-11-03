import type { PrismaClient } from '../../generated/prisma/client';
import { AuthService } from '../auth/service';
import type { Input } from './validation';
import * as read from './read';
import * as write from './write';
import { registerInitialStock } from './initial-stock';

export class MastersService {
 private auth: AuthService;
 constructor(private db: PrismaClient) { this.auth = new AuthService(db); }
 listTools(token: string | undefined, query: Input = {}) { return read.listTools(this.db, this.auth, token, query); }
 toolDetail(token: string | undefined, id: string) { return read.toolDetail(this.db, this.auth, token, id); }
 listMasters(token: string | undefined, kind: string) { return read.listMasters(this.db, this.auth, token, kind); }
 createTool(token: string | undefined, input: Input) { return write.createTool(this.db, this.auth, token, input); }
 updateTool(token: string | undefined, id: string, input: Input) { return write.updateTool(this.db, this.auth, token, id, input); }
 createMaster(token: string | undefined, kind: string, input: Input) { return write.createMaster(this.db, this.auth, token, kind, input); }
 updateMaster(token: string | undefined, kind: string, id: string, input: Input) { return write.updateMaster(this.db, this.auth, token, kind, id, input); }
 saveSupplierItem(token: string | undefined, toolId: string, conditionId: string | undefined, input: Input) { return write.saveSupplierItem(this.db, this.auth, token, toolId, conditionId, input); }
 registerInitialStock(token: string | undefined, toolId: string, input: Input) { return registerInitialStock(this.db, this.auth, token, toolId, input); }
}
