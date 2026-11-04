import { InventoryPage } from '@/components/inventory';
import type { Search } from '@/components/masters';
export default async function Adjust({ searchParams }: { searchParams: Promise<Search> }) { return <InventoryPage mode="adjust" search={await searchParams} />; }
