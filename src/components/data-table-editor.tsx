'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tableDefinitions, type Cell, type DataRow, type Field, type TableData } from '@/lib/data-manager/definitions';
import { inputClass, buttonClass, panelClass } from './masters';

type Edits = Record<string, Record<string, Cell>>;
const same = (left: Cell | undefined, right: Cell | undefined) => String(left ?? '') === String(right ?? '');
const timestamp = (value: Cell) => value ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(String(value))) : '—';
const leaveMessage = '保存していない変更があります。変更を破棄して移動しますか？';

export function DataTableEditor({ tableKey, initialData, query, initialError }: { tableKey: string; initialData: TableData; query: string; initialError: string }) {
 const table = tableDefinitions.find(table => table.key === tableKey)!;
 const [data, setData] = useState(initialData), [edits, setEdits] = useState<Edits>({});
 const [busy, setBusy] = useState(false), [error, setError] = useState(initialError), [notice, setNotice] = useState('');
 const count = Object.keys(edits).length;
 const router = useRouter(), allowLeave = useRef(false), pending = useRef<{ signature: string; key: string } | null>(null);
 const groups = [...new Set(tableDefinitions.map(table => table.group))];
 const dirty = count > 0;
 useEffect(() => {
  if (!dirty) return;
  const currentUrl = window.location.href;
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  const guardedState = { ...window.history.state, dataManagerGuard: true };
  // Older browsers need a same-URL entry so Back reaches the current route
  // before App Router can restore another page and unmount these drafts.
  if (!navigation) window.history.pushState(guardedState, '', currentUrl);
  function unload(event: BeforeUnloadEvent) { if (!allowLeave.current) { event.preventDefault(); event.returnValue = ''; } }
  function navigate(event: Event) {
   const movement = event as Event & { navigationType: string; destination: { url: string } };
   if (allowLeave.current || movement.navigationType !== 'traverse' || movement.destination.url === currentUrl || !event.cancelable) return;
   if (!window.confirm(leaveMessage)) event.preventDefault(); else allowLeave.current = true;
  }
  function historyNavigation(event: PopStateEvent) {
   if (allowLeave.current) return;
   event.stopImmediatePropagation();
   if (window.confirm(leaveMessage)) { allowLeave.current = true; window.history.back(); }
   else window.history.pushState(guardedState, '', currentUrl);
  }
  function click(event: MouseEvent) {
   if (!(event.target instanceof Element)) return;
   const link = event.target.closest('a[href]');
   if (!(link instanceof HTMLAnchorElement) || link.href === window.location.href || event.defaultPrevented) return;
   if (!window.confirm(leaveMessage)) { event.preventDefault(); event.stopPropagation(); }
   else allowLeave.current = true;
  }
  window.addEventListener('beforeunload', unload);
  document.addEventListener('click', click, true);
  if (navigation) navigation.addEventListener('navigate', navigate);
  else window.addEventListener('popstate', historyNavigation, true);
  return () => {
   window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true);
   if (navigation) navigation.removeEventListener('navigate', navigate);
   else {
    window.removeEventListener('popstate', historyNavigation, true);
    if (!allowLeave.current && window.history.state?.dataManagerGuard && window.location.href === currentUrl) window.history.back();
   }
  };
 }, [dirty]);
 function canLeave() {
  if (busy) return false;
  if (count && !window.confirm(leaveMessage)) return false;
  allowLeave.current = true;
  return true;
 }
 function pageHref(page: number) { return '/admin/data?' + new URLSearchParams({ table: tableKey, q: query, page: String(page) }); }
 function change(row: DataRow, field: Field, value: Cell) {
  if (busy) return;
  if (!edits[row.id] && count >= 20) { setError('一度に編集できるのは20行です。先に現在の変更を保存してください。'); return; }
  setNotice('');
  setEdits(previous => {
   const next = { ...previous }, values = { ...next[row.id] };
   if (same(row.values[field.key], value)) delete values[field.key]; else values[field.key] = value;
   if (Object.keys(values).length) next[row.id] = values; else delete next[row.id];
   return next;
  });
 }
 async function save() {
  if (busy || !count) return;
  setBusy(true); setError(''); setNotice('');
  const changes = data.rows.filter(row => edits[row.id]).map(row => ({ id: row.id, version: row.version, values: edits[row.id] }));
  const signature = JSON.stringify(changes);
  if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
  try {
   const response = await fetch('/api/admin/data/' + tableKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_key: pending.current.key, changes }) });
   if (response.status === 401) { allowLeave.current = true; router.replace('/login'); return; }
   const result = await response.json();
   if (!response.ok) throw new Error(result.error ?? '保存に失敗しました');
   setEdits({}); pending.current = null;
   setNotice(`${result.saved}行を保存しました。`);
   const updated = await fetch('/api/admin/data/' + tableKey + '?' + new URLSearchParams({ q: query, page: String(data.page) }), { cache: 'no-store' });
   if (updated.status === 401) { allowLeave.current = true; router.replace('/login'); return; }
   if (!updated.ok) { setError('保存は完了しました。一覧を再読み込みしてください。'); return; }
   setData(await updated.json());
  } catch (e) { setError(e instanceof Error ? e.message : '通信に失敗しました。変更内容を確認して再試行してください。'); }
  finally { setBusy(false); }
 }
 function fieldControl(row: DataRow, field: Field) {
  const value = Object.hasOwn(edits[row.id] ?? {}, field.key) ? edits[row.id][field.key] : row.values[field.key];
  if (field.readonly || !row.editable) {
   if (field.kind === 'date') return <span className="whitespace-nowrap text-xs text-slate-600">{timestamp(value)}</span>;
   if (field.kind === 'json') return <details><summary className="ui-link whitespace-nowrap">内容を見る</summary><pre className="mt-2 max-h-48 w-96 max-w-[70vw] overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-xs">{String(value ?? '')}</pre></details>;
   return <span className={'inline-block max-w-64 text-slate-600 ' + (field.key.endsWith('_code') || field.key === 'order_no' ? 'whitespace-nowrap' : 'break-words')}>{value === null || value === '' || value === undefined ? '—' : typeof value === 'boolean' ? value ? '有効' : '無効' : String(value)}</span>;
  }
  const changed = Object.hasOwn(edits[row.id] ?? {}, field.key);
  const className = inputClass + ' ' + (field.kind === 'number' ? 'min-w-28' : field.kind === 'price' ? 'min-w-36' : 'min-w-44') + (changed ? ' border-amber-500 bg-amber-50' : '');
  const identity = String(row.values.tool_code ?? row.values.employee_code ?? row.values.tool_id ?? row.id);
  const label = `${field.label}（${identity}）`;
  if (field.kind === 'boolean') return <select aria-label={label} disabled={busy} value={String(value ?? false)} onChange={event => change(row, field, event.target.value === 'true')} className={className}>
   <option value="false">{field.key === 'active' ? '無効' : field.key === 'revoke' ? '失効しない' : field.key === 'reset' ? '解除しない' : 'いいえ'}</option>
   <option value="true">{field.key === 'active' ? '有効' : field.key === 'revoke' ? '失効する' : field.key === 'reset' ? '解除する' : 'はい'}</option>
  </select>;
  if (field.kind === 'select') return <select aria-label={label} disabled={busy} value={String(value ?? '')} onChange={event => change(row, field, event.target.value)} className={className}>
   {!field.options?.some(option => option.value === String(value ?? '')) && <option value={String(value ?? '')}>{String(value || '未設定')}</option>}
   {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
  return <input aria-label={label} disabled={busy} type={field.kind === 'password' ? 'password' : field.kind === 'number' ? 'number' : 'text'} inputMode={field.kind === 'price' ? 'decimal' : field.kind === 'number' ? 'numeric' : undefined} min={field.kind === 'number' ? field.min ?? 0 : undefined} max={field.kind === 'number' ? 2147483647 : undefined} step={field.kind === 'number' ? 1 : undefined} maxLength={field.max ?? (field.kind === 'price' ? 15 : undefined)} autoComplete={field.kind === 'password' ? 'new-password' : 'off'} value={value === null || value === undefined ? '' : String(value)} onChange={event => change(row, field, event.target.value)} placeholder={field.kind === 'password' ? '変更する場合のみ' : field.key === 'correction_reason' ? '訂正する理由を入力' : undefined} className={className} />;
 }
 return <section aria-label="表形式のデータ管理">
  <form method="get" action="/admin/data" className={'mb-3 flex flex-wrap items-end gap-3 ' + panelClass} onSubmit={event => { if (!canLeave()) event.preventDefault(); }}>
   <label className="grid w-full gap-1 sm:w-auto">対象データ<select name="table" value={tableKey} className={inputClass + ' sm:w-60'} disabled={busy} onChange={event => { if (canLeave()) router.push('/admin/data?' + new URLSearchParams({ table: event.target.value })); }}>
    {groups.map(group => <optgroup key={group} label={group}>{tableDefinitions.filter(table => table.group === group).map(table => <option key={table.key} value={table.key}>{table.label}</option>)}</optgroup>)}
   </select></label>
   <label className="grid w-full min-w-0 gap-1 sm:w-auto sm:max-w-sm sm:flex-1">検索<input name="q" type="search" defaultValue={query} maxLength={100} placeholder="コード・名称などで検索" className={inputClass} disabled={busy} /></label>
   <button className={buttonClass} disabled={busy}>検索する</button>
  </form>
  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="text-lg font-bold">{table.label}</h2><p className="text-xs text-slate-500">{data.total}件 / {data.page}ページ（1ページ50件）</p></div>
   {table.mode !== 'readonly' && <div className="flex flex-wrap items-center gap-3">
    <span role="status" className={count ? 'text-sm font-semibold text-amber-800' : 'text-sm text-slate-500'}>{count ? `${count}行を編集中` : '未保存の変更はありません'}</span>
    <button type="button" className="ui-secondary disabled:opacity-50" disabled={!count || busy} onClick={() => { if (window.confirm('編集中の変更を元に戻しますか？')) { setEdits({}); setError(''); pending.current = null; } }}>変更を元に戻す</button>
    <button type="button" className={buttonClass} disabled={!count || busy} onClick={save}>{busy ? '保存中…' : '変更をまとめて保存'}</button>
   </div>}
  </div>
  {table.note && <p className="mb-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-slate-600">{table.note}</p>}
  {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
  {notice && <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-green-900">{notice}</p>}
  <div className="data-table max-h-[65vh] overflow-auto rounded-xl bg-white" tabIndex={0} role="region" aria-label={table.label + 'の編集表（横にスクロールできます）'} aria-busy={busy}>
   <table className="w-full text-left text-sm [&_th]:px-3 [&_th]:py-2.5 [&_td]:px-2 [&_td]:py-2">
    <caption className="sr-only">{table.label}。入力欄のあるセルを編集できます。変更行は色と文字で表示します。</caption>
    <thead className="sticky top-0 z-10"><tr><th scope="col" className="whitespace-nowrap border-b">行</th>{table.fields.map(field => <th key={field.key} scope="col" className="whitespace-nowrap border-b">{field.label}{field.readonly && <span className="sr-only">（表示のみ）</span>}</th>)}<th scope="col" className="whitespace-nowrap border-b">行ID</th></tr></thead>
    <tbody>{data.rows.map((row, index) => <tr key={row.id} className={edits[row.id] ? 'border-b bg-amber-50/60' : 'border-b'}>
     <th scope="row" className="px-3 py-2 align-top text-xs font-normal text-slate-500"><span>{(data.page - 1) * data.pageSize + index + 1}</span>{edits[row.id] && <span className="mt-1 block whitespace-nowrap font-semibold text-amber-800">変更あり</span>}{!row.editable && table.mode === 'correct' && <span className="mt-1 block whitespace-nowrap">訂正不可</span>}{edits[row.id] && <button type="button" disabled={busy} className="ui-link mt-2 whitespace-nowrap" onClick={() => setEdits(previous => { const next = { ...previous }; delete next[row.id]; return next; })}>元に戻す</button>}</th>
     {table.fields.map(field => <td key={field.key} className="align-top">{fieldControl(row, field)}</td>)}
     <td className="align-top"><details><summary className="ui-link whitespace-nowrap text-xs">IDを表示</summary><code className="mt-1 block text-xs">{row.id}</code></details></td>
    </tr>)}</tbody>
   </table>
   {!data.rows.length && <p className="px-3 py-8 text-center text-slate-500">該当するデータはありません。</p>}
  </div>
  <nav aria-label="データ管理のページ切り替え" className="mt-3 flex items-center gap-4 text-sm">
   {data.page > 1 && <a href={pageHref(data.page - 1)}>前のページ</a>}
   {data.page * data.pageSize < data.total && <a href={pageHref(data.page + 1)}>次のページ</a>}
   {data.page > 1 && !data.rows.length && <a href={pageHref(1)}>先頭ページへ</a>}
  </nav>
 </section>;
}
