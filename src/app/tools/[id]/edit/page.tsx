import Link from 'next/link';
import { pageUser } from '@/lib/auth/server';
import { pageTool } from '@/lib/masters/server';
import { Shell, Messages, ToolForm, type Search } from '@/components/masters';
export default async function EditTool({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
 await pageUser('masters:write');
 const { id } = await params, tool = await pageTool(id);
 return <Shell title="工具の編集"><Link href={'/tools/' + tool.id} className="mb-5 inline-block underline">工具詳細へ戻る</Link><Messages search={await searchParams} /><ToolForm action={'/api/tools/' + tool.id} tool={tool} /></Shell>;
}
