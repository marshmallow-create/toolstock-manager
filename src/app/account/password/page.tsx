import {WorkspaceShell} from '@/components/workspace-shell';
import {Messages,inputClass,buttonClass,panelClass,type Search} from '@/components/masters';
import {pageUser} from '@/lib/auth/server';
import {MIN_PASSWORD_LENGTH,MAX_PASSWORD_LENGTH,PASSWORD_LENGTH_LABEL} from '@/lib/auth/password-policy';

export default async function Password({searchParams}:{searchParams:Promise<Search>}){
 const user=await pageUser('password:change');
 return <WorkspaceShell title="パスワード変更" user={user}>
  <Messages search={await searchParams}/>
  <section className={'max-w-md '+panelClass}>
   <p className="mb-4">パスワードを変更します。変更後は新しいパスワードでログインしてください。</p>
   <form action="/api/auth/password" method="post" className="grid gap-4">
    <label className="grid gap-1">現在のパスワード<input name="current_password" type="password" autoComplete="current-password" required maxLength={MAX_PASSWORD_LENGTH} className={inputClass}/></label>
    <label className="grid gap-1">新しいパスワード（{PASSWORD_LENGTH_LABEL}）<input name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} className={inputClass}/></label>
    <label className="grid gap-1">新しいパスワード（確認用）<input name="password_confirmation" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} className={inputClass}/></label>
    <button className={buttonClass}>パスワードを変更する</button>
   </form>
  </section>
 </WorkspaceShell>;
}
