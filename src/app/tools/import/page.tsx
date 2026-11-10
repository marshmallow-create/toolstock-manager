import { pageUser } from '@/lib/auth/server';
import { WorkspaceShell } from '@/components/workspace-shell';
import { ToolImportForm } from '@/components/tool-import-form';

export default async function ImportTools() {
 const user=await pageUser('tools:import');
 return <WorkspaceShell title="工具の一括登録" user={user}><ToolImportForm /></WorkspaceShell>;
}
