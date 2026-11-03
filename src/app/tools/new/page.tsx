import { pageUser } from '@/lib/auth/server';
import { Shell, Messages, ToolForm, type Search } from '@/components/masters';
export default async function NewTool({ searchParams }: { searchParams: Promise<Search> }) {
 await pageUser('masters:write');
 return <Shell title="工具登録"><Messages search={await searchParams} /><ToolForm action="/api/tools" /></Shell>;
}
