import { InventoryPage } from '@/components/inventory';
import type { Search } from '@/components/masters';
export default async function Issue({ searchParams }: { searchParams: Promise<Search> }) { return <InventoryPage mode="issue" search={await searchParams} />; }
