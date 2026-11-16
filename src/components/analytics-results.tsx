import Link from 'next/link';
import { categoryLabel } from '@/lib/tool-options';
import { formatMoney } from '@/lib/format-price';
import { moneyChange, type AnalyticsFilters, type summarizeTransactions } from '@/lib/analytics/summary';
import { panelClass } from './masters';

type Summary = ReturnType<typeof summarizeTransactions>;
const yen = (value:string) => '¥'+formatMoney(value);
const count = (value:number) => value.toLocaleString('ja-JP');
function comparison(current:string,previous:string,incomplete:boolean,unavailable:boolean) {
 if(unavailable)return '金額未登録のため比較できません';
 const change=moneyChange(current,previous),positive=!change.difference.startsWith('-')&&change.difference!=='0.00';
 return `${incomplete?'判明分の比較：':'前期間比：'}${positive?'+':''}${yen(change.difference)}${change.percent===null?'':`（${Number(change.percent)>0?'+':''}${change.percent}%）`}`;
}
function historyLink(filters:AnalyticsFilters,toolId?:string) {
 const q=new URLSearchParams({from:filters.from,to:filters.to,type:'ISSUE'});
 if(filters.category)q.set('category',filters.category);
 if(toolId??filters.toolId)q.set('tool_id',(toolId??filters.toolId)!);
 return '/history?'+q;
}
export function AnalyticsResults({ current, previous, filters }: { current:Summary; previous:Summary; filters:AnalyticsFilters }) {
 const incomplete=current.missingIssue+current.missingReceive;
 const maxTrend=Math.max(1,...current.trend.flatMap(p=>[Number(p.issueAmount),Number(p.receiveAmount)]));
 const maxCategory=Math.max(1,...current.categories.map(c=>Number(c.amount)));
 return <>
  <p className="mb-3 text-slate-600">集計期間：{filters.from} 〜 {filters.to} <span className="ml-2 inline-block text-xs">比較期間：{filters.previousFrom} 〜 {filters.previousTo}（日本時間）</span></p>
  <section aria-label="主要数値" className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
   {[
    {label:'出庫金額',value:current.issueCount>0&&current.missingIssue===current.issueCount?'—':yen(current.issueAmount),missing:current.missingIssue,detail:comparison(current.issueAmount,previous.issueAmount,current.missingIssue+previous.missingIssue>0,(current.issueCount>0&&current.missingIssue===current.issueCount)||(previous.issueCount>0&&previous.missingIssue===previous.issueCount))},
    {label:'入庫金額',value:current.receiveCount>0&&current.missingReceive===current.receiveCount?'—':yen(current.receiveAmount),missing:current.missingReceive,detail:comparison(current.receiveAmount,previous.receiveAmount,current.missingReceive+previous.missingReceive>0,(current.receiveCount>0&&current.missingReceive===current.receiveCount)||(previous.receiveCount>0&&previous.missingReceive===previous.receiveCount))},
    {label:'出庫数量',value:count(current.issueQuantity),missing:0,detail:'期間内に出庫した数量の合計'},
    {label:'使用工具数',value:count(current.toolCount)+'種類',missing:0,detail:'期間内に出庫した工具の種類数'},
   ].map(card=><article key={card.label} className={panelClass+' min-w-0 p-5'}>
    <h2 className="font-semibold text-slate-600">{card.label}{card.missing>0?'（判明分）':''}</h2>
    <p className="my-2 break-words text-2xl font-bold tabular-nums text-blue-800">{card.value}</p><p className="text-xs text-slate-500">{card.detail}</p>
   </article>)}
  </section>
  {(incomplete>0||previous.missingIssue+previous.missingReceive>0)&&<p role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">金額未登録：対象期間 {count(incomplete)}件 ／ 比較期間 {count(previous.missingIssue+previous.missingReceive)}件。金額と構成比は登録済みの金額から集計しています。数量・件数には未登録分も含みます。</p>}
  {current.issueCount+current.receiveCount===0 ? <p className={panelClass+' mb-5 p-6 text-center text-slate-500'}>対象期間の実績はありません。</p> : <div className="mb-5 grid items-start gap-4 xl:grid-cols-3">
   <section aria-labelledby="amount-trend" className={panelClass+' min-w-0 p-5 xl:col-span-2'}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="amount-trend" className="text-lg font-bold">入庫・出庫金額の推移</h2><p className="flex gap-4 text-xs"><span><span className="mr-1 inline-block size-2 rounded-full bg-blue-800"/>出庫</span><span><span className="mr-1 inline-block size-2 rounded-full bg-amber-400"/>入庫</span></p></div>
    <p className="mb-3 text-xs text-slate-500">{filters.granularity==='month'?'月別':'日別'} ／ 金額未登録分を除く</p>
    <div className="overflow-x-auto"><div className="flex h-56 items-end gap-2 border-b pb-1" style={{minWidth:Math.max(300,current.trend.length*48)}} role="img" aria-label="日付ごとの出庫金額と入庫金額の棒グラフ。数値は下の表で確認できます。">
     {current.trend.map(p=><div key={p.date} className="flex h-full min-w-10 flex-1 flex-col justify-end" title={`${p.date} 出庫 ${yen(p.issueAmount)} / 入庫 ${yen(p.receiveAmount)}`}>
      <div className="flex h-44 items-end justify-center gap-1"><div className="w-3 rounded-t bg-blue-800" style={{height:`${Number(p.issueAmount)/maxTrend*100}%`}}/><div className="w-3 rounded-t bg-amber-400" style={{height:`${Number(p.receiveAmount)/maxTrend*100}%`}}/></div>
      <span className="mt-2 text-center text-[10px] tabular-nums text-slate-500">{p.date.slice(5)}</span>
     </div>)}
    </div></div>
    <details className="mt-4"><summary className="cursor-pointer text-xs underline">推移の数値を表示</summary><div className="mt-2 max-h-72 overflow-auto"><table className="w-full text-sm"><caption className="sr-only">期間ごとの金額</caption><thead><tr><th scope="col" className="p-2 text-left">日付</th><th scope="col" className="numeric p-2">出庫金額</th><th scope="col" className="numeric p-2">入庫金額</th><th scope="col" className="numeric p-2">金額未登録</th></tr></thead><tbody>{current.trend.map(p=><tr key={p.date}><td className="p-2">{p.date}</td><td className="p-2 tabular-nums">{yen(p.issueAmount)}</td><td className="p-2 tabular-nums">{yen(p.receiveAmount)}</td><td className="p-2 tabular-nums">{p.missing}件</td></tr>)}</tbody></table></div></details>
   </section>
   <section aria-labelledby="category-cost" className={panelClass+' min-w-0 p-5'}><h2 id="category-cost" className="mb-4 text-lg font-bold">カテゴリー別の出庫金額</h2>
    {current.categories.length? <ul className="space-y-5">{current.categories.map(c=><li key={c.category}><div className="mb-1 flex flex-wrap justify-between gap-2"><span className="font-semibold">{categoryLabel(c.category)}</span><span className="tabular-nums">{c.known===0?'—':yen(c.amount)}</span></div><div aria-hidden="true" className="h-2 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-blue-700" style={{width:`${Number(c.amount)/maxCategory*100}%`}}/></div><p className="mt-1 text-right text-xs text-slate-500">構成比 {c.share===null?'—':c.share.toFixed(1)+'%'}{c.missing>0?` ／ 金額未登録${c.missing}件`:''}</p></li>)}</ul>:<p className="text-slate-500">出庫実績はありません。</p>}
   </section>
  </div>}
  <section aria-labelledby="tool-ranking" className={panelClass+' mb-4 min-w-0 p-5'}>
   <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 id="tool-ranking" className="text-lg font-bold">工具ランキング <span className="text-sm font-normal">上位10件・{filters.sort==='quantity'?'出庫数量順':'出庫金額順'}</span></h2><Link href={historyLink(filters)} className="text-sm underline">対象期間の出庫履歴へ</Link></div>
   {current.ranking.length?<div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm [&_td]:px-3 [&_td]:py-3 [&_th]:px-3 [&_th]:py-2"><caption className="sr-only">工具別の出庫実績</caption><thead><tr>{['順位','品目コード','品目名','カテゴリー','出庫数量','出庫金額','明細'].map((h,i)=><th key={h} scope="col" className={i===4||i===5?'numeric':''}>{h}</th>)}</tr></thead><tbody>{current.ranking.map((tool,index)=><tr key={tool.id} className="border-b"><td>{index+1}</td><td><Link href={'/tools/'+tool.id}>{tool.tool_code}</Link></td><td><Link href={'/tools/'+tool.id} className="font-semibold">{tool.name}</Link>{!tool.active&&<span className="ml-2 text-xs text-slate-500">無効</span>}</td><td>{categoryLabel(tool.category)}</td><td className="tabular-nums">{count(tool.quantity)}</td><td className="tabular-nums">{tool.known===0?'—':yen(tool.amount)}{tool.missing>0&&<span className="ml-1 text-xs text-slate-500">（判明分）</span>}</td><td><Link href={historyLink(filters,tool.id)}>明細</Link></td></tr>)}</tbody></table></div>:<p className="py-4 text-slate-500">対象期間の出庫実績はありません。</p>}
  </section>
  <p className="text-xs leading-relaxed text-slate-500">出庫は工具使用の目安です。金額は処理時点の保存金額で、取消済みの処理・取消・在庫調整・返品を除いて集計します。カテゴリーは現在の工具情報に基づきます。履歴画面には取消済みの処理も表示されます。</p>
 </>;
}
