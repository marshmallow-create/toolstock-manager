'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
export function DashboardMenu({ links }: { links: { href: string; label: string }[] }) {
 const [open, setOpen] = useState(false), id = useId();
 const container = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
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
 return <div ref={container} className="relative">
  <button ref={button} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="flex items-center gap-2 rounded border bg-white px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
   <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5"><path d="M4 6h16M4 12h16M4 18h16" /></svg>メニュー
  </button>
  <nav id={id} aria-label="利用できる機能" hidden={!open} className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-2.5rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
   <ul>{links.map(link => <li key={link.href}><Link href={link.href} onClick={() => setOpen(false)} className="block rounded-lg px-4 py-3 text-blue-900 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-700">{link.label}</Link></li>)}</ul>
  </nav>
 </div>;
}
