import Link from 'next/link';
import { WorkspaceShell } from '@/components/workspace-shell';
import { AnalyticsFilters } from '@/components/analytics-filters';
import { AnalyticsResults } from '@/components/analytics-results';
import { pageUser } from '@/lib/auth/server';
import { AuthError } from '@/lib/auth/service';
import { pageToken } from '@/lib/masters/server';
import { getDb } from '@/lib/db';
import { analyticsFilters } from '@/lib/analytics/summary';
import { readAnalytics } from '@/lib/analytics/read';
import type { Search } from '@/components/masters';

export default async function Analytics({searchParams}:{searchParams:Promise<Search>}) {
 const actor=await pageUser('history:all');
 await pageUser('prices:read');
 const query=await searchParams;
 let filters;
 try { filters=analyticsFilters(query); } catch(error) {
  if(!(error instanceof AuthError)||error.status!==400)throw error;
  return <WorkspaceShell title="使用状況・コスト分析" user={actor} page="analytics"><p role="alert" className="mb-4 rounded-lg bg-red-50 p-4 text-red-800">{error.message}</p><Link href="/analytics" className="ui-secondary">条件をリセットする</Link></WorkspaceShell>;
 }
 const {current,previous,tools}=await readAnalytics(getDb(),await pageToken(),filters);
 return <WorkspaceShell title="使用状況・コスト分析" user={actor} page="analytics">
  <p className="mb-4 text-slate-600">工具の出庫実績と金額を、期間ごとに確認できます。</p>
  <AnalyticsFilters key={[filters.period,filters.from,filters.to,filters.category,filters.toolId,filters.sort].join(':')} {...filters} tools={tools}/>
  <AnalyticsResults current={current} previous={previous} filters={filters}/>
 </WorkspaceShell>;
}
