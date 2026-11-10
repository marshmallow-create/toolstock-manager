'use client';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass } from './masters';

export function InventoryCancelForm({ transactionId, requestKey, returnTo = '/history' }: { transactionId: string; requestKey: string; returnTo?: string }) {
 const [saving, setSaving] = useState(false), [refreshing, startTransition] = useTransition(), [error, setError] = useState('');
 const inFlight = useRef(false), router = useRouter();
 async function cancel(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (inFlight.current || refreshing) return;
  inFlight.current = true; setSaving(true); setError('');
  try {
   const response = await fetch('/api/inventory/reverse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction_id: transactionId, request_key: requestKey, return_to: returnTo }) });
   if (response.status === 401) { router.replace('/login'); return; }
   const result = await response.json().catch(() => null);
   if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : '取消に失敗しました。再試行してください。');
   // Refresh the current route without navigating or changing its query/scroll.
   startTransition(() => router.refresh());
  } catch (e) { setError(e instanceof Error ? e.message : '通信に失敗しました。再試行してください。'); }
  finally { inFlight.current = false; setSaving(false); }
 }
 return <form method="post" action="/api/inventory/reverse" onSubmit={cancel} className="mt-2 grid w-64 gap-2 rounded border bg-slate-50 p-3" aria-busy={saving || refreshing}>
  <input type="hidden" name="request_key" value={requestKey} /><input type="hidden" name="transaction_id" value={transactionId} /><input type="hidden" name="return_to" value={returnTo} />
  <p>元の記録を残して全量を取り消します。</p>
  {error && <p role="alert" className="text-red-800">{error}</p>}
  <button disabled={saving || refreshing} className={buttonClass}>{saving || refreshing ? '取消中…' : 'この入出庫を取り消す'}</button>
 </form>;
}
