import { WorkspaceShell } from '@/components/workspace-shell';
import { pageUser } from '@/lib/auth/server';
import { Messages, ToolForm, type Search } from '@/components/masters';
import Link from 'next/link';
import { can } from '@/lib/auth/permissions';
export default async function NewTool({ searchParams }: { searchParams: Promise<Search> }) {
 const actor = await pageUser('tools:create');
 return <WorkspaceShell user={actor} page="tool-new" title="工具登録">{can(actor.role, 'tools:import') && <p className="mb-3"><Link href="/tools/import" className="ui-secondary inline-flex">Excelで一括登録する</Link></p>}<Messages search={await searchParams} /><ToolForm action="/api/tools" /></WorkspaceShell>;
}
