import Link from 'next/link';
import { cookies } from 'next/headers';
import { auth,COOKIE,pageUser } from '@/lib/auth/server';
import { roleLabels } from '@/lib/auth/permissions';
function Roles(){return Object.entries(roleLabels).map(([role,label])=><option key={role} value={role}>{label}</option>);}
export default async function Users({searchParams}:{searchParams:Promise<{error?:string;saved?:string}>}) {
 const actor=await pageUser('users:manage');
 const users=await auth().listUsers((await cookies()).get(COOKIE)?.value);
 const {error,saved}=await searchParams;
 return <main className="mx-auto max-w-5xl p-6 md:p-12">
  <Link href="/dashboard" className="underline">ダッシュボードへ</Link><h1 className="my-6 text-3xl font-bold">ユーザー・権限管理</h1>
  {error&&<p role="alert" className="mb-4 rounded bg-red-50 p-4 text-red-800">{error.slice(0,200)}</p>}
  {saved&&<p role="status" className="mb-4 rounded bg-green-50 p-4 text-green-900">保存しました。</p>}
  <section className="mb-8 rounded-xl bg-white p-6"><h2 className="mb-4 text-xl font-bold">ユーザー登録</h2>
   <form method="post" action="/api/admin/users" className="grid gap-4 sm:grid-cols-2">
    <label className="grid gap-1">社員ID<input name="employee_code" required pattern="[A-Z0-9_-]+" maxLength={32} className="rounded border p-2" /></label>
    <label className="grid gap-1">氏名<input name="name" required maxLength={80} className="rounded border p-2" /></label>
    <label className="grid gap-1">ロール<select name="role" className="rounded border p-2"><Roles /></select></label>
    <label className="grid gap-1">初期パスワード（12〜128文字）<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" className="rounded border p-2" /></label>
    <button className="rounded bg-blue-900 p-3 text-white sm:col-span-2">登録する</button>
   </form>
  </section>
  <h2 className="mb-4 text-xl font-bold">登録済みユーザー</h2><div className="grid gap-4">{users.map(user=><section key={user.id} className="rounded-xl bg-white p-5">
   <h3 className="mb-3 font-bold">{user.employee_code}{user.id===actor.id?'（自分）':''}</h3>
   <form method="post" action={'/api/admin/users/'+user.id} className="grid items-end gap-4 sm:grid-cols-2">
    <label className="grid gap-1">氏名<input name="name" required maxLength={80} defaultValue={user.name} className="rounded border p-2" /></label>
    <label className="grid gap-1">ロール<select name="role" defaultValue={user.role} className="rounded border p-2"><Roles /></select></label>
    <label className="grid gap-1">状態<select name="active" defaultValue={String(user.active)} className="rounded border p-2"><option value="true">有効</option><option value="false">無効</option></select></label>
    <label className="grid gap-1">新しいパスワード（変更する場合のみ）<input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" className="rounded border p-2" /></label>
    <button className="rounded border border-blue-900 p-2 sm:col-span-2">保存する</button>
   </form>
  </section>)}</div>
  <p className="mt-6 text-sm">権限・状態・パスワードを変更すると対象者のセッションを失効させます。過去の履歴は保持します。自分自身の無効化・降格はできません。</p>
 </main>;
}
