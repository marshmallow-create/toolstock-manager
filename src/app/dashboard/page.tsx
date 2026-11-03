import Link from 'next/link';
import { pageUser } from '@/lib/auth/server';
import { can,permissionLabels,roleLabels } from '@/lib/auth/permissions';
export default async function Dashboard({searchParams}:{searchParams:Promise<{denied?:string}>}) {
 const user=await pageUser();const {denied}=await searchParams;
 return <main className="mx-auto max-w-4xl p-6 md:p-12">
  <header className="mb-8 flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-bold">ダッシュボード</h1><form method="post" action="/api/auth/logout"><button className="rounded border bg-white px-4 py-2">ログアウト</button></form></header>
  <section className="rounded-xl bg-white p-6 shadow-sm"><p className="text-xl">{user.name} さん</p><p className="mt-2">社員ID: {user.employee_code} / {roleLabels[user.role]}</p></section>
  {denied&&<p role="alert" className="mt-5 rounded bg-red-50 p-4 text-red-800">この画面にアクセスする権限がありません。</p>}
  <h2 className="mb-3 mt-8 text-xl font-bold">あなたの権限</h2>
  <ul className="grid gap-2 sm:grid-cols-2">{Object.entries(permissionLabels).filter(([permission])=>can(user.role,permission)).map(([permission,label])=><li key={permission} className="rounded bg-white p-3">{label}</li>)}</ul>
  <Link href="/tools" className="mt-6 mr-4 inline-block rounded bg-blue-900 px-5 py-3 text-white">工具・在庫を検索</Link>
  {can(user.role,'masters:write')&&<Link href="/admin/masters" className="mt-6 mr-4 inline-block rounded border px-5 py-3">設備・保管場所・仕入先の管理</Link>}
  {can(user.role,'users:manage')&&<Link href="/admin/users" className="mt-6 inline-block rounded bg-blue-900 px-5 py-3 text-white">ユーザー・権限管理</Link>}
  <p className="mt-8 text-sm">工具検索・マスタ管理・棚別在庫と初期在庫登録を利用できます。手動入出庫は次のフェーズで追加します。</p>
 </main>;
}
