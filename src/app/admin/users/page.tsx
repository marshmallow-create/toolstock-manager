import { WorkspaceShell } from '@/components/workspace-shell';
import { Messages, inputClass, buttonClass, panelClass } from '@/components/masters';
import { cookies } from 'next/headers';
import { auth,COOKIE,pageUser } from '@/lib/auth/server';
import { roleLabels } from '@/lib/auth/permissions';
function Roles(){return Object.entries(roleLabels).map(([role,label])=><option key={role} value={role}>{label}</option>);}
export default async function Users({searchParams}:{searchParams:Promise<{error?:string;saved?:string}>}) {
 const actor=await pageUser('users:manage');
 const users=await auth().listUsers((await cookies()).get(COOKIE)?.value);
 const {error,saved}=await searchParams;
 return <WorkspaceShell title="ユーザー・権限管理" user={actor} page="users">
  <Messages search={{error,saved}} />
  <section className={'mb-4 ' + panelClass}><h2 className="mb-3 text-xl font-bold">ユーザー登録</h2>
   <form method="post" action="/api/admin/users" className="grid gap-3 sm:grid-cols-2">
    <label className="grid gap-1">社員ID<input name="employee_code" required pattern="[A-Z0-9_-]+" maxLength={32} className={inputClass} /></label>
    <label className="grid gap-1">氏名<input name="name" required maxLength={80} className={inputClass} /></label>
    <label className="grid gap-1">ロール<select name="role" className={inputClass}><Roles /></select></label>
    <label className="grid gap-1">初期パスワード（12〜128文字）<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" className={inputClass} /></label>
    <button className={buttonClass + ' sm:col-span-2'}>登録する</button>
   </form>
  </section>
  <h2 className="mb-3 text-xl font-bold">登録済みユーザー</h2><div className="grid gap-3">{users.map(user=><section key={user.id} className={panelClass}>
   <h3 className="mb-3 font-bold">{user.employee_code}{user.id===actor.id?'（自分）':''}</h3>
   <form method="post" action={'/api/admin/users/'+user.id} className="grid items-end gap-3 sm:grid-cols-2">
    <label className="grid gap-1">氏名<input name="name" required maxLength={80} defaultValue={user.name} className={inputClass} /></label>
    <label className="grid gap-1">ロール<select name="role" defaultValue={user.role} className={inputClass}><Roles /></select></label>
    <label className="grid gap-1">状態<select name="active" defaultValue={String(user.active)} className={inputClass}><option value="true">有効</option><option value="false">無効</option></select></label>
    <label className="grid gap-1">新しいパスワード（変更する場合のみ）<input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" className={inputClass} /></label>
    <button className="rounded border border-blue-900 px-4 py-2 text-sm sm:col-span-2">保存する</button>
   </form>
  </section>)}</div>
  <p className="mt-3 text-sm">権限・状態・パスワードを変更すると対象者のセッションを失効させます。過去の履歴は保持します。自分自身の無効化・降格はできません。</p>
 </WorkspaceShell>;
}
