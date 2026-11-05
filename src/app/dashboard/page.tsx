import Link from 'next/link';
import { pageUser } from '@/lib/auth/server';
import { can,permissionLabels,roleLabels } from '@/lib/auth/permissions';
export default async function Dashboard({searchParams}:{searchParams:Promise<{denied?:string}>}) {
 const user=await pageUser();const {denied}=await searchParams;
 return <main className="mx-auto max-w-4xl p-6 md:p-12">
  <header className="mb-8 flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-bold">マイページ</h1><form method="post" action="/api/auth/logout"><button className="rounded border bg-white px-4 py-2">ログアウト</button></form></header>
  <section className="rounded-xl bg-white p-6 shadow-sm"><p className="text-xl">{user.name} さん</p><p className="mt-2">社員ID: {user.employee_code} / {roleLabels[user.role]}</p></section>
  {denied&&<p role="alert" className="mt-5 rounded bg-red-50 p-4 text-red-800">この画面にアクセスする権限がありません。</p>}
  <div className="mt-8 grid items-start gap-8 md:grid-cols-2">
   <section aria-labelledby="permissions-heading">
    <h2 id="permissions-heading" className="mb-3 text-xl font-bold">あなたの権限</h2>
    <ul className="list-['・'] space-y-2 rounded-xl bg-white py-5 pl-10 pr-5 shadow-sm">{Object.entries(permissionLabels).filter(([permission])=>can(user.role,permission)).map(([permission,label])=><li key={permission} className="pl-1 leading-relaxed">{label}</li>)}</ul>
   </section>
   <nav aria-labelledby="actions-heading">
    <h2 id="actions-heading" className="mb-3 text-xl font-bold">利用できる機能</h2>
    <div className="grid grid-cols-1 gap-2 rounded-xl bg-white p-4 shadow-sm [&>a]:rounded-lg [&>a]:bg-blue-900 [&>a]:px-4 [&>a]:py-3 [&>a]:font-medium [&>a]:leading-relaxed [&>a]:text-white [&>a]:transition-colors [&>a:hover]:bg-blue-800 [&>a:focus-visible]:outline-2 [&>a:focus-visible]:outline-offset-2 [&>a:focus-visible]:outline-blue-700">
     <Link href="/tools">工具・在庫を検索</Link>
     {can(user.role,'inventory:issue')&&<Link href="/inventory/issue">手動出庫</Link>}
     {can(user.role,'inventory:receive')&&<Link href="/inventory/receive">理由付き手動入庫</Link>}
     {can(user.role,'inventory:adjust')&&<Link href="/inventory/adjust">棚卸</Link>}
     <Link href="/history">入出庫履歴</Link>
     {can(user.role,'masters:write')&&<Link href="/admin/masters">設備・保管場所・仕入先の管理</Link>}
     {can(user.role,'users:manage')&&<Link href="/admin/users">ユーザー・権限管理</Link>}
    </div>
   </nav>
  </div>
  <p className="mt-8 text-sm">工具検索・棚別在庫・手動出庫・理由付き手動入庫・棚卸・履歴を権限に応じて利用できます。</p>
 </main>;
}
