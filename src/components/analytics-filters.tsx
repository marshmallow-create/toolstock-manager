'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toolCategories } from '@/lib/tool-options';
import { inputClass, panelClass } from './masters';

type Props = {
 period: string; from: string; to: string; category?: string; toolId?: string; sort: 'amount' | 'quantity';
 tools: {id:string;tool_code:string;name:string;active:boolean}[];
};
export function AnalyticsFilters({ period, from, to, category, toolId, sort, tools }: Props) {
 const [selectedPeriod,setSelectedPeriod] = useState(period);
 return <form method="get" action="/analytics" className={panelClass+' mb-5 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4'}>
  <label className="grid gap-1">期間<select name="period" value={selectedPeriod} onChange={e=>setSelectedPeriod(e.target.value)} className={inputClass}>
   <option value="month">今月</option><option value="last-month">先月</option><option value="year">今年</option><option value="custom">期間指定</option>
  </select></label>
  <label className="grid gap-1">カテゴリー<select name="category" defaultValue={category??''} className={inputClass}><option value="">すべて</option>{toolCategories.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
  <label className="grid gap-1">工具<select name="tool_id" defaultValue={toolId??''} className={inputClass}><option value="">すべて</option>{tools.map(tool=><option key={tool.id} value={tool.id}>{tool.tool_code} / {tool.name}{!tool.active?'（無効）':''}</option>)}</select></label>
  <label className="grid gap-1">ランキング順<select name="sort" defaultValue={sort} className={inputClass}><option value="amount">出庫金額順</option><option value="quantity">出庫数量順</option></select></label>
  {selectedPeriod==='custom' && <>
   <label className="grid gap-1">開始日（日本時間）<input type="date" name="from" defaultValue={from} required min="1900-01-01" max="9998-12-31" className={inputClass}/></label>
   <label className="grid gap-1">終了日（日本時間）<input type="date" name="to" defaultValue={to} required min="1900-01-01" max="9998-12-31" className={inputClass}/></label>
  </>}
  <div className="flex flex-wrap gap-2"><button className="ui-button">集計する</button><Link href="/analytics" className="ui-secondary">条件をクリア</Link></div>
  <p className="text-xs font-normal text-slate-500 sm:col-span-2 lg:col-span-4">今月・今年は本日まで集計します。期間指定は最大366日です。</p>
 </form>;
}
