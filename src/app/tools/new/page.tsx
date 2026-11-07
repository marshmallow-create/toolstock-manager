import { WorkspaceShell } from '@/components/workspace-shell';
import { pageUser } from '@/lib/auth/server';
import { Messages, ToolForm, type Search } from '@/components/masters';
export default async function NewTool({ searchParams }: { searchParams: Promise<Search> }) {
 const actor = await pageUser('masters:write');
 return <WorkspaceShell user={actor} page="tool-new" title="工具登録"><Messages search={await searchParams} /><ToolForm action="/api/tools" /></WorkspaceShell>;
}
