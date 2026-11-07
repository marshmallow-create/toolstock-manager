import Link from 'next/link';
import { cookies } from 'next/headers';
import { auth, COOKIE } from '@/lib/auth/server';
import { AuthError, type Viewer } from '@/lib/auth/service';
import { WorkspaceShell } from '@/components/workspace-shell';
import { buttonClass, panelClass } from '@/components/masters';
export default async function NotFound() {
 const token = (await cookies()).get(COOKIE)?.value;
 let user: Viewer | undefined;
 if (token) { try { user = await auth().authenticate(token); } catch (error) { if (!(error instanceof AuthError)) throw error; } }
 return <WorkspaceShell title="ページが見つかりません" user={user}>
  <section className={panelClass}><p className="mb-3">指定されたページは見つかりませんでした。</p><Link href={user ? '/dashboard' : '/login'} className={buttonClass + ' inline-block'}>{user ? 'マイページへ' : 'ログインへ'}</Link></section>
 </WorkspaceShell>;
}
