import { pageUser } from '@/lib/auth/server';
import { masters, pageToken } from '@/lib/masters/server';
import { Shell, Messages, Field, Active, panelClass, buttonClass, masterCode, type Search } from '@/components/masters';
const kinds = [{ kind: 'machines', label: '設備', code: 'machine_code' }, { kind: 'locations', label: '保管場所', code: 'location_code' }, { kind: 'suppliers', label: '仕入先', code: 'supplier_code' }] as const;
export default async function Masters({ searchParams }: { searchParams: Promise<Search> }) {
 await pageUser('masters:write');
 const token = await pageToken(), service = masters();
 const groups = await Promise.all(kinds.map(async group => ({ ...group, rows: await service.listMasters(token, group.kind) })));
 return <Shell title="設備・保管場所・仕入先の管理"><Messages search={await searchParams} />
  <p className="mb-6 text-sm">コードは登録後に変更できません。使わなくなったマスタは無効化して履歴を残します。</p>
  <nav aria-label="マスタの種類" className="mb-6 flex gap-5 underline">{groups.map(group => <a key={group.kind} href={'#' + group.kind}>{group.label}</a>)}</nav>
  <div className="grid gap-8">{groups.map(group => <section key={group.kind} id={group.kind} className={panelClass}><h2 className="mb-4 text-2xl font-bold">{group.label}</h2>
   <h3 className="mb-3 font-bold">新規登録</h3><form method="post" action={'/api/masters/' + group.kind} className="mb-6 grid gap-3 rounded bg-slate-50 p-4 sm:grid-cols-2">
    <Field label={group.label + 'コード'} name={group.code} required maxLength={32} pattern="[A-Za-z0-9_\x2D]+" /><Field label="名称" name="name" required maxLength={100} />
    {group.kind === 'suppliers' && <Field label="メールアドレス（任意）" type="email" name="email" maxLength={254} />}
    <button className={buttonClass + ' sm:col-span-2'}>{group.label}を登録する</button>
   </form>
   <h3 className="mb-3 font-bold">登録済み（{group.rows.length}件）</h3>{!group.rows.length && <p>まだ登録されていません。</p>}
   <div className="grid gap-4">{group.rows.map(row => <article key={row.id} className="rounded border p-4"><h4 className="mb-3 font-bold">{masterCode(row)}</h4>
    <form method="post" action={'/api/masters/' + group.kind + '/' + row.id} className="grid gap-3 sm:grid-cols-2"><Field label="名称" name="name" required maxLength={100} defaultValue={row.name} /><Active value={row.active} />
     {group.kind === 'suppliers' && <Field label="メールアドレス（任意）" type="email" name="email" maxLength={254} defaultValue={'email' in row ? row.email ?? '' : ''} />}
     <button className="rounded border border-blue-900 p-2 sm:col-span-2">変更を保存する</button>
    </form>
   </article>)}</div>
  </section>)}</div>
 </Shell>;
}
