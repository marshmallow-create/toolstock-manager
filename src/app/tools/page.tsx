import { redirect } from 'next/navigation';
import { pageUser } from '@/lib/auth/server';
import type { Search } from '@/components/masters';
export default async function Tools({ searchParams }: { searchParams: Promise<Search> }) {
 await pageUser('inventory:read');
 const query = new URLSearchParams();
 for (const [key, value] of Object.entries(await searchParams)) {
  if (typeof value === 'string') query.set(key, value);
  else if (Array.isArray(value)) for (const item of value) query.append(key, item);
 }
 redirect('/dashboard' + (query.size ? '?' + query.toString() : ''));
}
