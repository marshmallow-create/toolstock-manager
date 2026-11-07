import type { Prisma } from '../../generated/prisma/client';
export async function recordedUnitPrice(tx: Prisma.TransactionClient, tool: { id: string; unit_price: Prisma.Decimal | null }) {
 if (tool.unit_price !== null) return tool.unit_price;
 const legacy = await tx.supplierItem.findFirst({ where: { tool_id: tool.id, preferred: true, supplier_id_record: { active: true } }, select: { unit_price: true } });
 return legacy?.unit_price ?? null;
}
