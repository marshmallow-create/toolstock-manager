import { Messages, inputClass } from '@/components/masters';
import { Brand } from '@/components/brand';
export default async function Login({searchParams}:{searchParams:Promise<{error?:string;password_changed?:string}>}) {
 const {error,password_changed}=await searchParams;
 return <main className="login-screen min-h-dvh">
 <div className="login-card">
  <div className="login-photo"><Brand /></div>
  <section aria-labelledby="login-title" className="login-form w-full max-w-md">
  <h1 id="login-title" className="page-title">ログイン</h1>
  <p className="my-5 text-sm leading-relaxed text-slate-600">社員IDとパスワードを入力してください。</p>
  <Messages search={{error}} />
  {password_changed==='1'&&<p role="status" className="mb-4 text-sm text-green-800">パスワードを変更しました。新しいパスワードでログインしてください。</p>}
  <form method="post" action="/api/auth/login" className="grid gap-5 text-sm">
   <label className="grid gap-1">社員ID<input required name="employee_code" autoComplete="username" maxLength={32} className={inputClass} /></label>
   <label className="grid gap-1">パスワード<input required type="password" name="password" autoComplete="current-password" maxLength={128} className={inputClass} /></label>
   <button className="ui-button login-submit mt-1 w-full">ログイン</button>
  </form>
  <div className="login-note">
   <p>共有端末では作業後にログアウトしてください。</p>
   <p>30分間操作がない場合、またはログインから8時間でセッションが終了します。</p>
  </div>
 </section>
 </div>
 </main>;
}
