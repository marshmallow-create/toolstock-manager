import { Messages, inputClass } from '@/components/masters';
export default async function Login({searchParams}:{searchParams:Promise<{error?:string}>}) {
 const {error}=await searchParams;
 return <main className="mx-auto flex min-h-dvh w-full items-center justify-center px-4 py-8 sm:px-6">
 <section aria-labelledby="login-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
  <header className="mb-6 text-center">
   <span className="brand-mark mb-3" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.25l8 4.5" /></svg></span>
   <p className="mb-2 text-sm font-semibold tracking-wide text-slate-500">ToolStock Manager</p>
   <h1 id="login-title" className="text-2xl font-bold">ログイン</h1>
  </header>
  <p className="mb-6 text-sm leading-relaxed text-slate-600">社員IDとパスワードを入力してください。共有端末では作業後にログアウトしてください。</p>
  <Messages search={{error}} />
  <form method="post" action="/api/auth/login" className="grid gap-5 text-sm">
   <label className="grid gap-1">社員ID<input required name="employee_code" autoComplete="username" maxLength={32} className={inputClass} /></label>
   <label className="grid gap-1">パスワード<input required type="password" name="password" autoComplete="current-password" maxLength={128} className={inputClass} /></label>
   <button className="ui-button mt-1 w-full">ログイン</button>
  </form>
  <p className="mt-6 border-t border-slate-100 pt-5 text-xs leading-relaxed text-slate-500">30分間操作がない場合、またはログインから8時間でセッションが終了します。</p>
 </section>
 </main>;
}
