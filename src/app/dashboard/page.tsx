import { pageUser } from '@/lib/auth/server';
import { can } from '@/lib/auth/permissions';
import { ToolsList } from '@/components/tools-list';
import { WorkspaceShell } from '@/components/workspace-shell';
import { queryText, type Search } from '@/components/masters';
import { getDb } from '@/lib/db';
export default async function Dashboard({ searchParams }: { searchParams: Promise<Search> }) {
 const user = await pageUser('inventory:read'), search = await searchParams;
 const pendingOrderCount = await getDb().orderListEntry.count();
 return <WorkspaceShell title="マイページ" user={user} page="dashboard" pendingOrderCount={pendingOrderCount}>
  {queryText(search.denied) && <p role="alert" className="mb-3 rounded bg-red-50 p-4 text-red-800">この画面にアクセスする権限がありません。</p>}
  <section aria-labelledby="tools-heading"><h2 id="tools-heading" className="mb-3 text-xl font-bold">工具一覧</h2><ToolsList search={search} canExport={can(user.role,'tools:export')} /></section>
 </WorkspaceShell>;
}
