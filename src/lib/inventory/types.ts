import type { TransactionType } from '../../generated/prisma/client';
export type Operation = 'issue' | 'receive' | 'adjust' | 'reverse';
export type Input = Record<string, unknown>;
export type InventoryResult = {
 id:string; type:TransactionType; tool_id:string; location_id:string; actor_user_id:string;
 machine_id:string|null; quantity:number; on_hand_before:number; on_hand_after:number;
 reserved:number; reason:string|null; reverses_id:string|null; created_at:string;
};
export type HistoryItem = {
 id:string; type:TransactionType; quantity:number; reason:string|null; created_at:Date;
 reverses_id:string|null; reversal_id:string|null;
 tool:{id:string;tool_code:string;name:string;unit:string;active:boolean};
 location:{id:string;location_code:string;name:string;active:boolean};
 actor:{id:string;employee_code:string;name:string;active:boolean};
 machine:{id:string;machine_code:string;name:string;active:boolean}|null;
};
export const transactionLabels:Record<TransactionType,string> = {
 ISSUE:'出庫', RECEIVE:'入庫', ADJUSTMENT:'棚卸調整', REVERSAL:'逆取引', RETURN:'返品',
};
export const operationPermissions:Record<Operation,readonly string[]> = {
 issue:['inventory:issue'], receive:['inventory:receive','inventory:adjust'],
 adjust:['inventory:adjust'], reverse:['inventory:adjust'],
};
