import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth/service';
import { can, roleLabels } from '@/lib/auth/permissions';
import { DashboardMenu } from './dashboard-menu';
type WorkspacePage = 'dashboard' | 'history' | 'tool-new' | 'users' | 'data' | 'login' | 'other';
export function WorkspaceShell({ title, user, page = 'other', children }: { title: string; user?: Viewer; page?: WorkspacePage; children: ReactNode }) {
 const links = user ? [
  { page: 'dashboard', permission: 'inventory:read', href: '/dashboard', label: 'マイページ' },
  { page: 'history', permission: 'history:own', href: '/history', label: '入出庫履歴' },
  { page: 'tool-new', permission: 'tools:create', href: '/tools/new', label: '工具登録' },
  { page: 'users', permission: 'users:manage', href: '/admin/users', label: 'ユーザー・権限管理' },
  { page: 'data', permission: 'data:manage', href: '/admin/data', label: 'データ管理' },
 ].filter(link => link.page !== page && can(user.role, link.permission)).map(({ href, label }) => ({ href, label })) : [];
 return <main className="mx-auto w-full max-w-[1600px] px-4 py-5 md:px-6">
  <div className="mb-4 flex items-center gap-2.5"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.25l8 4.5" /></svg></span><span className="text-sm font-semibold tracking-wide text-slate-600">ToolStock Manager</span></div>
  {user && page !== 'dashboard' && <nav aria-label="メインナビゲーション" className="mb-3 text-sm"><Link href="/dashboard" className="underline">マイページへ戻る</Link></nav>}
  <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
   <h1 className="text-2xl font-bold">{title}</h1>
   {user ? <div className="flex items-center gap-2">{page === 'dashboard' && <DashboardMenu links={links} />}<form method="post" action="/api/auth/logout"><button className="ui-secondary">ログアウト</button></form></div> : null}
  </header>
  {user && <section aria-label="ログイン情報" className="account-strip flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-4 py-2.5"><p className="text-sm font-semibold">{user.name} さん</p><p className="text-xs text-slate-600">社員ID: {user.employee_code} / {roleLabels[user.role]}</p></section>}
  <div className="mt-4 text-sm">{children}</div>
 </main>;
}
