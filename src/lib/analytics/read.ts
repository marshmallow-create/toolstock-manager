import type { PrismaClient } from '../../generated/prisma/client';
import { AuthService } from '../auth/service';
import { categoryAliases } from '../tool-options';
import { summarizeTransactions, type AnalyticsFilters } from './summary';

export async function readAnalytics(db: PrismaClient, token: string | undefined, filters: AnalyticsFilters) {
 const auth = new AuthService(db);
 await auth.authenticate(token, 'history:all');
 await auth.authenticate(token, 'prices:read');
 const [transactions, tools] = await db.$transaction([
  db.inventoryTransaction.findMany({
   where: {
    type: { in: ['ISSUE', 'RECEIVE'] }, inventory_transactions_reverses_id_children: { is: null },
    ...(filters.toolId ? { tool_id: filters.toolId } : {}),
    ...(filters.category ? { tool_id_record: { category: { in: categoryAliases(filters.category), mode: 'insensitive' } } } : {}),
    OR: [
     { created_at: { gte: filters.start, lt: filters.end } },
     { created_at: { gte: filters.previousStart, lt: filters.previousEnd } },
    ],
   },
   select: { type: true, quantity: true, amount: true, created_at: true, tool_id_record: { select: { id: true, tool_code: true, name: true, category: true, active: true } } },
  }),
  db.tool.findMany({select:{id:true,tool_code:true,name:true,active:true},orderBy:{tool_code:'asc'}}),
 ], { isolationLevel: 'RepeatableRead' });
 const rows = transactions.map(({tool_id_record:tool,amount,...row})=>({...row,tool,amount:amount?.toFixed(2)??null}));
 return {
  current: summarizeTransactions(rows, filters),
  previous: summarizeTransactions(rows, {...filters,from:filters.previousFrom,to:filters.previousTo,start:filters.previousStart,end:filters.previousEnd}),
  tools,
 };
}
