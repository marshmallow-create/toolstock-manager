import type { PrismaClient } from '../../generated/prisma/client';
import { AuthService } from '../auth/service';
import { mutateInventory } from './write';
import * as read from './read';
import type { Input } from './types';
export class InventoryService {
 private auth:AuthService;
 constructor(private db:PrismaClient){this.auth=new AuthService(db);}
 issue(token:string|undefined,input:Input){return mutateInventory(this.db,this.auth,token,'issue',input);}
 receive(token:string|undefined,input:Input){return mutateInventory(this.db,this.auth,token,'receive',input);}
 reverse(token:string|undefined,input:Input){return mutateInventory(this.db,this.auth,token,'reverse',input);}
 listHistory(token:string|undefined,query:Input={}){return read.listHistory(this.db,this.auth,token,query);}
 historyDetail(token:string|undefined,id:string){return read.historyDetail(this.db,this.auth,token,id);}
 historyOptions(token:string|undefined){return read.historyOptions(this.db,this.auth,token);}
}
