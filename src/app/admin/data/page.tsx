import { notFound } from 'next/navigation';
import { pageUser } from '@/lib/auth/server';
import { pageToken } from '@/lib/masters/server';
import { getDb } from '@/lib/db';
import { DataManager } from '@/lib/data-manager/service';
import { tableDefinitions, type TableData } from '@/lib/data-manager/definitions';
import { AuthError } from '@/lib/auth/service';
import { WorkspaceShell } from '@/components/workspace-shell';
import { DataTableEditor } from '@/components/data-table-editor';
import { queryText, type Search } from '@/components/masters';
export default async function DataPage({ searchParams }: { searchParams: Promise<Search> }) {
 const actor = await pageUser('data:manage'), search = await searchParams;
 const key = queryText(search.table) || 'tools', table = tableDefinitions.find(table => table.key === key);
 if (!table) notFound();
 let data: TableData = { rows: [], total: 0, page: 1, pageSize: 50 }, error = '';
 try { data = await new DataManager(getDb()).list(await pageToken(), key, search); }
 catch (e) { if (e instanceof AuthError && e.status === 400) error = e.message; else throw e; }
 return <WorkspaceShell user={actor} title="データ管理" page="data">
  <DataTableEditor key={[key, queryText(search.q), queryText(search.page)].join(':')} tableKey={key} initialData={data} query={queryText(search.q)} initialError={error} />
 </WorkspaceShell>;
}
