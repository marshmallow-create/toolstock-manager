import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth/service';
import { can, roleLabels } from '@/lib/auth/permissions';
import { DashboardMenu } from './dashboard-menu';
type WorkspacePage = 'dashboard' | 'history' | 'tool-new' | 'users' | 'login' | 'other';
export function WorkspaceShell({ title, user, page = 'other', children }: { title: string; user?: Viewer; page?: WorkspacePage; children: ReactNode }) {
 const links = user ? [
  { page: 'dashboard', permission: 'inventory:read', href: '/dashboard', label: 'マイページ' },
  { page: 'history', permission: 'history:own', href: '/history', label: '入出庫履歴' },
  { page: 'tool-new', permission: 'masters:write', href: '/tools/new', label: '工具登録' },
  { page: 'users', permission: 'users:manage', href: '/admin/users', label: 'ユーザー・権限管理' },
 ].filter(link => link.page !== page && can(user.role, link.permission)).map(({ href, label }) => ({ href, label })) : [];
 return <main className="mx-auto w-full max-w-[1600px] px-4 py-5 md:px-6">
  {page === 'history' && <nav aria-label="メインナビゲーション" className="mb-3 text-sm"><Link href="/dashboard" className="underline">マイページへ戻る</Link></nav>}
  <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
   <h1 className="text-2xl font-bold">{title}</h1>
   {user ? <div className="flex items-center gap-3">{page !== 'history' && <DashboardMenu links={links} />}<form method="post" action="/api/auth/logout"><button className="rounded border bg-white px-4 py-2">ログアウト</button></form></div> : <p className="text-sm">ToolStock Manager</p>}
  </header>
  {user && <section aria-label="ログイン情報" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-white px-4 py-3 shadow-sm"><p className="font-medium">{user.name} さん</p><p className="text-sm">社員ID: {user.employee_code} / {roleLabels[user.role]}</p></section>}
  <div className="mt-5 text-sm">{children}</div>
 </main>;
}
