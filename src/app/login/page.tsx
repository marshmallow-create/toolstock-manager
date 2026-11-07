import { WorkspaceShell } from '@/components/workspace-shell';
import { Messages, inputClass, buttonClass, panelClass } from '@/components/masters';
export default async function Login({searchParams}:{searchParams:Promise<{error?:string}>}) {
 const {error}=await searchParams;
 return <WorkspaceShell title="ログイン" page="login">
  <p className="mb-3">社員IDとパスワードを入力してください。共有端末では作業後にログアウトしてください。</p>
  <Messages search={{error}} />
  <form method="post" action="/api/auth/login" className={'grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] ' + panelClass}>
   <label className="grid gap-1">社員ID<input required name="employee_code" autoComplete="username" maxLength={32} className={inputClass} /></label>
   <label className="grid gap-1">パスワード<input required type="password" name="password" autoComplete="current-password" maxLength={128} className={inputClass} /></label>
   <button className={buttonClass + ' self-end'}>ログイン</button>
  </form>
  <p className="mt-3 text-sm">30分間操作がない場合、またはログインから8時間でセッションが終了します。</p>
 </WorkspaceShell>;
}
