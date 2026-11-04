import { InventoryPage } from '@/components/inventory';
import type { Search } from '@/components/masters';
export default async function Receive({ searchParams }: { searchParams: Promise<Search> }) { return <InventoryPage mode="receive" search={await searchParams} />; }
