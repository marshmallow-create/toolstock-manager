'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass, inputClass, panelClass } from './masters';
import { categoryLabel } from '@/lib/tool-options';
import type { ImportPreviewRow } from '@/lib/masters/tool-import';

type Preview={count:number;valid:boolean;rows:ImportPreviewRow[]};
const columns=[['tool_code','品目コード'],['name','品目名'],['category','カテゴリー'],['on_hand','在庫'],['reorder_point','発注ライン'],['order_quantity','発注数'],['unit_price','単価'],['department','部門'],['shelf_code','棚番']];
export function ToolImportForm() {
 const router=useRouter();
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function send(action:'preview'|'commit') {
  if(!file || busy)return;
  setBusy(true);setError('');
  if(action==='preview')setPreview(null);
  try{
   const data=new FormData();data.set('file',file);data.set('action',action);
   const response=await fetch('/api/tools/import',{method:'POST',body:data});
   const result=await response.json();
   if(!response.ok){if(action==='commit')setPreview(null);throw new Error(result.error ?? '処理に失敗しました。');}
   if(action==='commit'){router.replace('/dashboard?saved=1');router.refresh();}
   else setPreview(result);
  }catch(error){setError(error instanceof Error?error.message:'処理に失敗しました。');}
  finally{setBusy(false);}
 }
 return <>
  <section className={'mb-3 max-w-4xl '+panelClass}>
   <h2 className="mb-2 text-xl font-bold">Excelでまとめて登録</h2>
   <p className="mb-3 text-slate-600">テンプレートに工具を入力し、内容を確認して登録します。新規登録のみ対応しています。</p>
   <a href="/api/tools/import/template" className="ui-secondary inline-flex">Excelテンプレートをダウンロード</a>
   <form className="mt-5 grid gap-3" onSubmit={event=>{event.preventDefault();void send('preview');}}>
    <label className="grid gap-1">Excelファイル（.xlsx）<input type="file" accept=".xlsx" required disabled={busy} className={inputClass} onChange={event=>{setPreview(null);setError('');setFile(event.target.files?.[0] ?? null);}} /></label>
    <p className="text-sm text-slate-600">最大200件・2MB。既存の品目コードやファイル内の重複は登録できません。</p>
    <button disabled={!file || busy} className={buttonClass}>{busy?'処理中…':'内容を確認する'}</button>
   </form>
  </section>
  {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-red-800">{error}</p>}
  {preview && <section aria-labelledby="import-preview" className={'mb-3 '+panelClass}>
   <h2 id="import-preview" className="mb-2 text-xl font-bold">登録内容の確認</h2>
   <p role="status" className="mb-3">{preview.count}件{preview.valid?'：まだ登録されていません。内容を確認して確定してください。':`：${preview.rows.filter(row=>row.errors.length).length}行にエラーがあります。Excelを修正して選び直してください。`}</p>
   <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2">
    <thead><tr><th scope="col">行番号</th>{columns.map(([field,label])=><th key={field} scope="col">{label}</th>)}<th scope="col">確認結果</th></tr></thead>
    <tbody>{preview.rows.map(row=><tr key={row.rowNumber} className={row.errors.length?'bg-red-50':''}>
     <td className="border-b">{row.rowNumber}</td>{columns.map(([field])=><td key={field} className="border-b">{field==='category'?categoryLabel(row.values[field]):row.values[field] || '—'}</td>)}
     <td className="border-b">{row.errors.length?<ul className="text-red-800">{row.errors.map((message,index)=><li key={index}>{message}</li>)}</ul>:'登録可能'}</td>
    </tr>)}</tbody>
   </table></div>
   <p className="my-3 text-sm text-slate-600">エラーがある場合は1件も登録しません。確定時に最新の登録状況を再確認します。</p>
   <button disabled={!preview.valid || busy} className={buttonClass} onClick={()=>void send('commit')}>{busy?'処理中…':`${preview.count}件を一括登録する`}</button>
  </section>}
  <Link href="/tools/new" className="inline-block py-2">1件ずつ登録する画面へ</Link>
 </>;
}
