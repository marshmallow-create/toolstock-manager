import { WorkspaceShell } from '@/components/workspace-shell';
import Link from 'next/link';
import { Messages, inputClass, buttonClass, panelClass, queryText, type Search } from '@/components/masters';
import { cookies } from 'next/headers';
import { auth,COOKIE,pageUser } from '@/lib/auth/server';
import { roleLabels } from '@/lib/auth/permissions';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, PASSWORD_LENGTH_LABEL } from '@/lib/auth/password-policy';
function Roles(){return Object.entries(roleLabels).map(([role,label])=><option key={role} value={role}>{label}</option>);}
export default async function Users({searchParams}:{searchParams:Promise<Search>}) {
 const actor=await pageUser('users:manage');
 const users=await auth().listUsers((await cookies()).get(COOKIE)?.value);
 const search=await searchParams;
 const employeeCode=queryText(search.employee_code).trim();
 const filteredUsers=users.filter(user=>user.employee_code.toUpperCase().includes(employeeCode.toUpperCase()));
 const pageSize=20;
 const pageCount=Math.max(1,Math.ceil(filteredUsers.length/pageSize));
 const requestedPage=Number(queryText(search.page));
 const page=Number.isSafeInteger(requestedPage)&&requestedPage>0?Math.min(requestedPage,pageCount):1;
 const visibleUsers=filteredUsers.slice((page-1)*pageSize,page*pageSize);
 const pageHref=(value:number)=>'/admin/users?'+new URLSearchParams({employee_code:employeeCode,page:String(value)});
 return <WorkspaceShell title="ユーザー・権限管理" user={actor} page="users">
  <Messages search={{ error: search.error }} />
  <section className={'mb-3 max-w-3xl ' + panelClass}><h2 className="mb-3 text-xl font-bold">ユーザー登録</h2>
   <form method="post" action="/api/admin/users" className="grid gap-3 sm:grid-cols-2">
    <label className="grid gap-1">社員ID<input name="employee_code" required pattern="[A-Z0-9_-]+" maxLength={32} className={inputClass} /></label>
    <label className="grid gap-1">氏名<input name="name" required maxLength={80} className={inputClass} /></label>
    <label className="grid gap-1">ロール<select name="role" className={inputClass}><Roles /></select></label>
    <label className="grid gap-1">初期パスワード（{PASSWORD_LENGTH_LABEL}）<input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} autoComplete="new-password" className={inputClass} /></label>
    <button className={buttonClass + ' sm:col-span-2'}>登録する</button>
   </form>
  </section>
  <section className={panelClass} aria-labelledby="registered-users">
   <h2 id="registered-users" className="mb-3 text-xl font-bold">登録済みユーザー</h2>
   <form method="get" action="/admin/users" className="mb-3 flex flex-wrap items-end gap-3">
    <label className="grid w-full gap-1 sm:w-72">社員IDで検索<input name="employee_code" type="search" defaultValue={employeeCode} placeholder="社員IDの一部を入力" className={inputClass} /></label>
    <button className={buttonClass}>検索する</button>
    <Link href="/admin/users" className="px-2 py-2 underline">検索をクリア</Link>
   </form>
   <p role="status" className="mb-3 text-slate-600">{filteredUsers.length}件{employeeCode && `（全${users.length}件）`}{filteredUsers.length>0 && ` / ${(page-1)*pageSize+1}〜${Math.min(page*pageSize,filteredUsers.length)}件を表示`}</p>
   <div className="hidden grid-cols-[1fr_1fr_7rem_5rem_4rem] gap-3 border-b border-slate-300 bg-slate-50 px-3 py-2 font-bold sm:grid" aria-hidden="true"><span>社員ID</span><span>氏名</span><span>ロール</span><span>状態</span><span>操作</span></div>
   <ul className="divide-y divide-slate-200">{visibleUsers.map(user=><li key={user.id}>
    <details className="group">
     <summary className="ui-disclosure grid cursor-pointer grid-cols-2 items-center gap-3 rounded px-3 py-3 focus-visible:outline-2 focus-visible:outline-blue-900 sm:grid-cols-[1fr_1fr_7rem_5rem_4rem]">
      <span className="break-all font-bold">{user.employee_code}{user.id===actor.id?'（自分）':''}</span>
      <span className="break-all">{user.name}</span>
      <span>{roleLabels[user.role]}</span>
      <span className={user.active?'text-green-800':'text-slate-500'}>{user.active?'有効':'無効'}</span>
      <span className="ui-link font-semibold"><span className="group-open:hidden">編集</span><span className="hidden group-open:inline">閉じる</span></span>
     </summary>
   <form method="post" action={'/api/admin/users/'+user.id} className="grid max-w-3xl items-end gap-3 border-t border-slate-100 bg-slate-50 p-3 sm:grid-cols-2">
    <label className="grid gap-1">氏名<input name="name" required maxLength={80} defaultValue={user.name} className={inputClass} /></label>
    <label className="grid gap-1">ロール<select name="role" defaultValue={user.role} className={inputClass}><Roles /></select></label>
    <label className="grid gap-1">状態<select name="active" defaultValue={String(user.active)} className={inputClass}><option value="true">有効</option><option value="false">無効</option></select></label>
    <label className="grid gap-1">新しいパスワード（変更する場合のみ）<input name="password" type="password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} autoComplete="new-password" className={inputClass} /></label>
    <button className={buttonClass + ' sm:col-span-2'}>保存する</button>
   </form>
    </details>
   </li>)}</ul>
   {filteredUsers.length===0 && <p className="py-6 text-center text-slate-600">{employeeCode?'該当する社員IDのユーザーはいません。':'登録済みユーザーはいません。'}</p>}
   {pageCount>1 && <nav aria-label="ユーザー一覧のページ切り替え" className="mt-3 flex items-center justify-between gap-3">
    {page>1?<Link href={pageHref(page-1)} className="rounded border px-3 py-2">前へ</Link>:<span />}
    <span>{page} / {pageCount}ページ</span>
    {page<pageCount?<Link href={pageHref(page+1)} className="rounded border px-3 py-2">次へ</Link>:<span />}
   </nav>}
  </section>
 </WorkspaceShell>;
}
