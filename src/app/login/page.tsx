import Link from 'next/link';
export default async function Login({searchParams}:{searchParams:Promise<{error?:string}>}) {
 const {error}=await searchParams;
 return <main className="mx-auto max-w-md p-6 pt-16">
  <Link href="/" className="text-sm underline">ToolStock Manager</Link>
  <h1 className="my-6 text-3xl font-bold">ログイン</h1>
  <p className="mb-6">社員IDとパスワードを入力してください。共有端末では作業後にログアウトしてください。</p>
  {error&&<p role="alert" className="mb-4 rounded bg-red-50 p-4 text-red-800">{error.slice(0,200)}</p>}
  <form method="post" action="/api/auth/login" className="grid gap-5 rounded-xl bg-white p-6 shadow-sm">
   <label className="grid gap-2">社員ID<input required name="employee_code" autoComplete="username" maxLength={32} className="rounded border p-3" /></label>
   <label className="grid gap-2">パスワード<input required type="password" name="password" autoComplete="current-password" maxLength={128} className="rounded border p-3" /></label>
   <button className="rounded bg-blue-900 p-3 font-bold text-white">ログイン</button>
  </form>
  <p className="mt-5 text-sm">30分間操作がない場合、またはログインから8時間でセッションが終了します。</p>
 </main>;
}
