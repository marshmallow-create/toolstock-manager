import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth/service';
import { can, roleLabels } from '@/lib/auth/permissions';
import { DashboardMenu } from './dashboard-menu';
import { Brand } from './brand';
type WorkspacePage = 'dashboard' | 'analytics' | 'history' | 'orders' | 'tool-new' | 'users' | 'login' | 'other';
export function WorkspaceShell({ title, user, page = 'other', children, pendingOrderCount = 0 }: { title: string; user?: Viewer; page?: WorkspacePage; children: ReactNode; pendingOrderCount?: number }) {
 const links = user ? [
  { page: 'dashboard', permission: 'inventory:read', href: '/dashboard', label: 'マイページ' },
  { page: 'history', permission: 'history:own', href: '/history', label: '入出庫履歴' },
  { page: 'orders', permission: 'inventory:read', href: '/orders', label: '発注リスト' },
  { page: 'tool-new', permission: 'tools:create', href: '/tools/new', label: '工具登録' },
  { page: 'analytics', permission: 'history:all', href: '/analytics', label: 'ダッシュボード' },
  { page: 'password', permission: 'password:change', href: '/account/password', label: 'パスワード変更' },
  { page: 'users', permission: 'users:manage', href: '/admin/users', label: 'ユーザー・権限管理' },
 ].filter(link => link.page !== page && can(user.role, link.permission)).map(({ href, label }) => ({ href, label })) : [];
 return <main className="workspace">
  <div className="workspace-bar">
   <div className="workspace-width mx-auto max-w-[1600px] flex flex-wrap items-center justify-between gap-3">
    <Brand />
    {user && <section aria-label="ログイン情報" className="account-strip">
     <div className="account-identity">
      <p className="font-semibold">{user.name} さん</p>
      <p className="account-meta">社員ID: {user.employee_code} / {roleLabels[user.role]}</p>
     </div>
     <form method="post" action="/api/auth/logout"><button className="logout-button">ログアウト</button></form>
    </section>}
   </div>
  </div>
  <div className="workspace-width mx-auto max-w-[1600px] pb-10">
  {user && page !== 'dashboard' && <nav aria-label="メインナビゲーション" className="back-nav"><Link href="/dashboard">マイページへ戻る</Link></nav>}
  <header className={page === 'dashboard' ? 'page-header workspace-hero' : 'page-header'}>
   <h1 className="page-title">{title}</h1>
   {user && page === 'dashboard' && <DashboardMenu links={links} pendingOrderCount={pendingOrderCount} />}
  </header>
  <div className="min-w-0 text-sm">{children}</div>
  </div>
 </main>;
}
