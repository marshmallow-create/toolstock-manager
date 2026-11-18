'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
export function DashboardMenu({ links, pendingOrderCount = 0 }: { links: { href: string; label: string }[]; pendingOrderCount?: number }) {
 const [open, setOpen] = useState(false), id = useId();
 const container = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
 const warning = pendingOrderCount > 0 ? <span aria-label={'発注リストに工具が' + pendingOrderCount + '件残っています'} className="ml-2 inline-flex rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">{'要確認 ' + pendingOrderCount.toLocaleString('ja-JP') + '件'}</span> : null;
 useEffect(() => {
  if (!open) return;
  function outside(event: PointerEvent) {
   if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
  }
  function escape(event: KeyboardEvent) {
   if (event.key === 'Escape') { setOpen(false); button.current?.focus(); }
  }
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
 }, [open]);
 return <div ref={container} className="relative w-fit">
  <button ref={button} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="menu-button">
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4"><path d="M4 6h16M4 12h16M4 18h16" /></svg>メニュー{warning}
  </button>
  <nav id={id} aria-label="利用できる機能" hidden={!open} className="absolute left-0 z-20 mt-2 w-64 max-w-[calc(100vw-5rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
   <ul>{links.map(link => <li key={link.href}><Link href={link.href} onClick={() => setOpen(false)} className="menu-link block rounded-lg px-4 py-3 font-medium focus-visible:outline-2 focus-visible:outline-blue-700">{link.label}{link.href === '/orders' && warning}</Link></li>)}</ul>
  </nav>
 </div>;
}
