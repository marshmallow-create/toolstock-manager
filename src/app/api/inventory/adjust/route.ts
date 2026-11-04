import { inventoryMutation } from '@/lib/inventory/server';
export async function POST(request: Request) { return inventoryMutation(request, 'adjust'); }
