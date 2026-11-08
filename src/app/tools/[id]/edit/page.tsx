import { WorkspaceShell } from '@/components/workspace-shell';
import Link from 'next/link';
import { pageUser } from '@/lib/auth/server';
import { pageTool } from '@/lib/masters/server';
import { Messages, ToolForm, type Search } from '@/components/masters';
export default async function EditTool({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
 const actor = await pageUser('tools:update');
 const { id } = await params, tool = await pageTool(id);
 return <WorkspaceShell user={actor} title="工具の編集"><Link href={'/tools/' + tool.id} className="mb-3 inline-block underline">工具詳細へ戻る</Link><Messages search={await searchParams} /><ToolForm action={'/api/tools/' + tool.id} tool={tool} /></WorkspaceShell>;
}
