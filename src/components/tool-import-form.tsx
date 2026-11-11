'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass, inputClass, panelClass } from './masters';
import { categoryLabel } from '@/lib/tool-options';
import type { ImportPreviewRow } from '@/lib/masters/tool-import';
import { formatPrice } from '@/lib/format-price';

type Preview={count:number;valid:boolean;previewToken?:string;rows:(ImportPreviewRow&{before?:Record<string,string>;changes?:string[]})[]};
const columns=[['tool_code','品目コード'],['name','品目名'],['category','カテゴリー'],['on_hand','在庫'],['reorder_point','発注ライン'],['order_quantity','発注数'],['unit_price','単価'],['department','部門'],['shelf_code','棚番']];
export function ToolImportForm() {
 const router=useRouter();
 const [mode,setMode]=useState<'create'|'update'>('create');
 const inFlight=useRef(false);
 const updating=mode==='update', verb=updating?'変更':'登録';
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function send(action:'preview'|'commit') {
  if(!file || inFlight.current)return;
  inFlight.current=true;
  setBusy(true);setError('');
  if(action==='preview')setPreview(null);
  try{
   const data=new FormData();data.set('file',file);data.set('action',action);
   data.set('mode',mode);if(preview?.previewToken)data.set('previewToken',preview.previewToken);
   const response=await fetch('/api/tools/import',{method:'POST',body:data});
   const result=await response.json();
   if(!response.ok){if(action==='commit')setPreview(null);throw new Error(result.error ?? '処理に失敗しました。');}
   if(action==='commit'){router.replace('/dashboard?saved=1');router.refresh();}
   else setPreview(result);
  }catch(error){setError(error instanceof Error?error.message:'処理に失敗しました。');}
  finally{inFlight.current=false;setBusy(false);}
 }
 const shown=(field:string,value:string|undefined)=>value==null||value===''?'—':field==='category'?categoryLabel(value):field==='unit_price'?formatPrice(value):value;
 return <>
  <section className={'mb-3 max-w-4xl '+panelClass}>
   <fieldset disabled={busy} className="mb-4 flex flex-wrap gap-3"><legend className="mb-2 font-semibold">操作を選択</legend>{(['create','update'] as const).map(value=><label key={value} className="ui-secondary inline-flex cursor-pointer items-center gap-2"><input type="radio" name="import-mode" value={value} checked={mode===value} onChange={()=>{setMode(value);setFile(null);setPreview(null);setError('');}} />{value==='create'?'新規登録':'一括変更'}</label>)}</fieldset>
   <h2 className="mb-2 text-xl font-bold">Excelでまとめて{verb}</h2>
   <p className="mb-3 text-slate-600">{updating?'品目コードで既存工具を照合します。変更する項目だけ入力してください。空欄は現在の値を保持します。':'テンプレートに新しい工具を入力し、内容を確認して登録します。'}</p>
   <a href={updating?'/api/tools/import/template?mode=update':'/api/tools/import/template'} className="ui-secondary inline-flex">{verb}用Excelテンプレートをダウンロード</a>
   <form className="mt-5 grid gap-3" onSubmit={event=>{event.preventDefault();void send('preview');}}>
    <label className="grid gap-1">Excelファイル（.xlsx）<input key={mode} type="file" accept=".xlsx" required disabled={busy} className={inputClass} onChange={event=>{setPreview(null);setError('');setFile(event.target.files?.[0] ?? null);}} /></label>
    <p className="text-sm text-slate-600">最大200件・2MB。{updating?'未登録の品目コードやファイル内の重複は変更できません。0に変更する場合は0を入力してください。':'既存の品目コードやファイル内の重複は登録できません。'}</p>
    <button disabled={!file || busy} className={buttonClass}>{busy?'処理中…':'内容を確認する'}</button>
   </form>
  </section>
  {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-red-800">{error}</p>}
  {preview && <section aria-labelledby="import-preview" className={'mb-3 '+panelClass}>
   <h2 id="import-preview" className="mb-2 text-xl font-bold">{verb}内容の確認</h2>
   <p role="status" className="mb-3">{preview.count}件{preview.valid?`：まだ${verb}されていません。内容を確認して確定してください。`:`：${preview.rows.filter(row=>row.errors.length).length}行にエラーがあります。Excelを修正して選び直してください。`}</p>
   <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2">
    <thead><tr><th scope="col">行番号</th>{columns.map(([field,label])=><th key={field} scope="col">{label}</th>)}<th scope="col">確認結果</th></tr></thead>
    <tbody>{preview.rows.map(row=><tr key={row.rowNumber} className={row.errors.length?'bg-red-50':''}>
     <td className="border-b">{row.rowNumber}</td>{columns.map(([field])=><td key={field} className="border-b">{updating&&row.changes?.includes(field)?<><span className="text-slate-500">{shown(field,row.before?.[field])}</span><span aria-label="から" className="mx-2">→</span><strong className="text-blue-900">{shown(field,row.values[field])}</strong></>:shown(field,row.values[field])}</td>)}
     <td className="border-b">{row.errors.length?<ul className="text-red-800">{row.errors.map((message,index)=><li key={index}>{message}</li>)}</ul>:updating&&!row.changes?.length?'変更なし':`${verb}可能`}</td>
    </tr>)}</tbody>
   </table></div>
   <p className="my-3 text-sm text-slate-600">エラーがある場合は1件も{verb}しません。{updating?'確認後に工具情報や在庫が変わった場合は、再確認が必要です。':'確定時に最新の登録状況を再確認します。'}</p>
   <button disabled={!preview.valid || busy || (updating&&!preview.rows.some(row=>row.changes?.length))} className={buttonClass} onClick={()=>void send('commit')}>{busy?'処理中…':`${updating?preview.rows.filter(row=>row.changes?.length).length:preview.count}件を一括${verb}する`}</button>
  </section>}
  <Link href="/tools/new" className="inline-block py-2">1件ずつ登録する画面へ</Link>
 </>;
}
