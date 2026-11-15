import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parseToolWorkbook } from '../src/lib/masters/tool-workbook';
import { databaseFixture } from './helpers/database';
import { IMPORT_HEADERS } from '../src/lib/masters/tool-workbook';

let fixture:Awaited<ReturnType<typeof databaseFixture>>,server:ChildProcess,origin:string,logs='';

const request=(path:string,role?:string,options:RequestInit={})=>fetch(origin+path,{redirect:'manual',...options,headers:{...(role?{Cookie:'toolstock_session='+fixture.tokens[role]}:{}),...options.headers}});
async function workbook(code:string,category='ドリル'){
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('工具登録');sheet.addRow(IMPORT_HEADERS);sheet.addRow([code,'一括テスト工具',category,5,3,2,123.45,'17361','B-01']);
 return new Uint8Array(await book.xlsx.writeBuffer());
}
const upload=(data:Uint8Array,action='preview',role:string|null='ADMIN',name='tools.xlsx',from=origin)=>{
 const body=new FormData();body.set('file',new File([data as BlobPart],name));body.set('action',action);
 return request('/api/tools/import',role ?? undefined,{method:'POST',headers:{Origin:from},body});
};
const uploadUpdate=(data:Uint8Array,action='preview',previewToken='',role='ADMIN')=>{
 const body=new FormData();body.set('file',new File([data as BlobPart],'update.xlsx'));body.set('action',action);body.set('mode','update');body.set('previewToken',previewToken);
 return request('/api/tools/import',role,{method:'POST',headers:{Origin:origin},body});
};
before(async()=>{
 fixture=await databaseFixture('tool_import_http');
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));origin='http://127.0.0.1:'+port;
 const database=new URL(fixture.url);database.searchParams.set('schema',fixture.schema);database.searchParams.set('options','-c search_path='+fixture.schema);
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,DATABASE_URL:database.href,APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
 server.stdout?.on('data',data=>logs+=String(data));server.stderr?.on('data',data=>logs+=String(data));
 for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error(logs);try{await fetch(origin+'/login');return;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 throw Error('server timeout');
},{timeout:25000});
after(async()=>{if(server && server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}await fixture?.close();});

test('Excel画面とテンプレートは管理者だけに許可し、作業者へのリンクを表示しない',async()=>{
 assert.equal((await request('/tools/import')).status,307);
 assert.equal((await request('/api/tools/import/template')).status,401);
 for(const role of ['WORKER','ADMIN']){
  const html=await (await request('/tools/new',role)).text();assert.equal(html.includes('href="/tools/import"'),role==='ADMIN');
  const page=await request('/tools/import',role);assert.equal(page.status,role==='ADMIN'?200:307);
  const template=await request('/api/tools/import/template',role);assert.equal(template.status,role==='ADMIN'?200:403);
  if(role==='WORKER'){assert.ok(page.headers.get('location')?.includes('/dashboard?denied=1'));continue;}
  const importHtml=await page.text();assert.ok(importHtml.includes('内容を確認する'));
  assert.equal([...importHtml.matchAll(/href="\/api\/tools\/import\/template"/g)].length,1);
  assert.ok(importHtml.indexOf('共通テンプレート')<importHtml.indexOf('<fieldset'));
  assert.ok(template.headers.get('content-type')?.includes('spreadsheetml'));assert.match(template.headers.get('content-disposition')??'',/toolstock-template\.xlsx/);
  const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await template.arrayBuffer()) as never);assert.equal(book.worksheets[0].getCell('A1').value,'品目コード');
 }
 const data=await workbook('WORKER-DENIED');
 for(const action of ['preview','commit'])assert.equal((await upload(data,action,'WORKER')).status,403);
 assert.equal(await fixture.db.tool.count({where:{tool_code:'WORKER-DENIED'}}),0);
});
test('確認は書き込まず、確定で在庫・履歴を保存し再送は重複になる',async()=>{
 const buffer=await workbook('IMPORT-HTTP');
 const response=await upload(buffer);assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.valid,true);assert.equal(preview.rows[0].rowNumber,2);
 assert.equal(await fixture.db.tool.count(),0);
 const confirmed=await upload(buffer,'commit');assert.equal(confirmed.status,201);assert.deepEqual(await confirmed.json(),{count:1});
 const tool=await fixture.db.tool.findUniqueOrThrow({where:{tool_code:'IMPORT-HTTP'}});assert.equal(tool.department,'17361');assert.equal(tool.unit_price?.toFixed(2),'123.45');
 assert.equal((await fixture.db.stockBalance.findFirstOrThrow({where:{tool_id:tool.id}})).on_hand,5);
 assert.equal((await fixture.db.inventoryTransaction.findFirstOrThrow({where:{tool_id:tool.id}})).actor_user_id,fixture.users.ADMIN);
 assert.equal((await upload(buffer,'commit')).status,400);assert.equal(await fixture.db.tool.count(),1);
});
test('不正行・形式・サイズ・認証・Originを拒否する',async()=>{
 const invalid=await upload(await workbook('INVALID-IMPORT','その他'));const preview=await invalid.json();assert.equal(preview.valid,false);assert.ok(preview.rows[0].errors.length>0);
 assert.equal((await upload(await workbook('INVALID-IMPORT','その他'),'commit')).status,400);
 const good=await workbook('NO-AUTH');assert.equal((await upload(good,'preview',null)).status,401);
 assert.equal((await upload(good,'preview','ADMIN','tools.xlsx','https://evil.invalid')).status,403);
 assert.equal((await upload(good,'preview','ADMIN','tools.xls')).status,400);
 assert.equal((await upload(new Uint8Array(2*1024*1024+1))).status,413);
 assert.equal((await upload(new TextEncoder().encode('bad'))).status,400);
 assert.equal((await request('/api/tools/import','ADMIN',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,415);
 assert.equal(await fixture.db.tool.count({where:{tool_code:{in:['INVALID-IMPORT','NO-AUTH']}}}),0);
});

test('変更テンプレートとAPIで変更前後を確認し、空欄保持・権限・再送・競合を検証する',async()=>{
 const template=await request('/api/tools/import/template?mode=update','ADMIN');assert.equal(template.status,200);
 const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await template.arrayBuffer()) as never);
 const sheet=book.getWorksheet('工具登録・変更');assert.ok(sheet);assert.equal(sheet.getCell('G2').numFmt,'0');
 const page=await (await request('/tools/import','ADMIN')).text();assert.ok(page.includes('一括変更'));
 assert.equal((await request('/api/tools/import/template?mode=update','WORKER')).status,403);
 assert.equal((await request('/api/tools/import/template?mode=bad','ADMIN')).status,400);
 assert.equal((await upload(await workbook('UPDATE-HTTP'),'commit')).status,201);
 sheet.getRow(2).values=['UPDATE-HTTP','一括変更後','','0','','','1250','',''];
 const data=new Uint8Array(await book.xlsx.writeBuffer());
 assert.equal((await uploadUpdate(data,'preview','','WORKER')).status,403);
 const response=await uploadUpdate(data);assert.equal(response.status,200);const preview=await response.json();
 assert.equal(preview.valid,true);assert.equal(preview.rows[0].before.name,'一括テスト工具');assert.equal(preview.rows[0].values.name,'一括変更後');
 assert.equal((await uploadUpdate(data,'commit')).status,409);
 const result=await uploadUpdate(data,'commit',preview.previewToken);assert.equal(result.status,200);assert.deepEqual(await result.json(),{count:1});
 const tool=await fixture.db.tool.findUniqueOrThrow({where:{tool_code:'UPDATE-HTTP'}});assert.equal(tool.name,'一括変更後');assert.equal(tool.unit_price?.toString(),'1250');assert.equal(tool.department,'17361');assert.equal(tool.shelf_code,'B-01');
 assert.equal((await fixture.db.stockBalance.findFirstOrThrow({where:{tool_id:tool.id}})).on_hand,0);
 assert.equal(await fixture.db.auditLog.count({where:{action:'TOOL_UPDATED',entity_id:tool.id}}),1);
 assert.equal((await uploadUpdate(data,'commit',preview.previewToken)).status,409);
 sheet.getRow(2).getCell(2).value='在庫競合';
 const changed=new Uint8Array(await book.xlsx.writeBuffer()), current=await (await uploadUpdate(changed)).json();
 await fixture.db.stockBalance.updateMany({where:{tool_id:tool.id},data:{on_hand:1}});
 assert.equal((await uploadUpdate(changed,'commit',current.previewToken)).status,409);
 assert.equal((await fixture.db.tool.findUniqueOrThrow({where:{id:tool.id}})).name,'一括変更後');
});

test('作業者はExcel出力APIを直接呼んでも拒否され一覧にダウンロードを表示しない',async()=>{
 const denied=await request('/api/tools/export','WORKER');assert.equal(denied.status,403);
 const zipDenied=await request('/api/tools/export?tool_code=ZIP-EXPORT-&page=2','WORKER');assert.equal(zipDenied.status,403);
 const page=await request('/dashboard','WORKER');assert.equal(page.status,200);
 const html=await page.text();assert.doesNotMatch(html,/Excelダウンロード|\/api\/tools\/export/);
});

test('工具一覧Excelは認可・検索条件を守り無変更と編集後の一括変更に使用できる',async()=>{
 assert.equal((await request('/api/tools/export')).status,401);
 const created=await request('/api/tools','ADMIN',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({tool_code:'000-EXPORT',name:'出力工具',category:'DRILL',on_hand:7,reorder_point:3,order_quantity:2,unit_price:'125.55',department:'17314',shelf_code:'001'})});
 assert.equal(created.status,201,await created.clone().text());
 for(const role of ['ADMIN']){
  const file=await request('/api/tools/export?tool_code=000-export&name=出力&category=ドリル&page=999',role);
  assert.equal(file.status,200);assert.equal(file.headers.get('cache-control'),'no-store');
  assert.match(file.headers.get('content-disposition')??'',/attachment.*\.xlsx/);
  const data=new Uint8Array(await file.arrayBuffer()),rows=await parseToolWorkbook(Buffer.from(data),'update');
  assert.equal(rows.length,1);assert.equal(rows[0].values.tool_code,'000-EXPORT');assert.equal(rows[0].values.unit_price,'125.55');
  const preview=await uploadUpdate(data,'preview','','ADMIN');assert.equal(preview.status,200);
  const result=await preview.json();assert.equal(result.valid,true);assert.deepEqual(result.rows[0].changes,[]);
  const unchanged=await uploadUpdate(data,'commit',result.previewToken);assert.equal(unchanged.status,200);assert.equal((await unchanged.json()).count,0);
  assert.equal((await uploadUpdate(data,'preview','','WORKER')).status,403);
  const html=await (await request('/dashboard?tool_code=000-export&name=出力&category=DRILL&page=1',role)).text();
  const href=html.match(/href="([^\"]*\/api\/tools\/export[^\"]*)"/)?.[1];assert.ok(href);
  const link=new URL(href.replaceAll('&amp;','&'),origin);
  assert.equal(link.searchParams.get('tool_code'),'000-export');assert.equal(link.searchParams.get('name'),'出力');assert.equal(link.searchParams.has('page'),false);
  if(role==='ADMIN'){
   const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(data) as never);
   book.getWorksheet('工具変更')!.getCell('B2').value='Excelで変更';
   const edited=new Uint8Array(await book.xlsx.writeBuffer());
   const next=await (await uploadUpdate(edited)).json();assert.equal(next.valid,true);assert.deepEqual(next.rows[0].changes,['name']);
   assert.equal((await uploadUpdate(edited,'commit',next.previewToken)).status,200);
   const tool=await fixture.db.tool.findUniqueOrThrow({where:{tool_code:'000-EXPORT'}});assert.equal(tool.name,'Excelで変更');assert.equal(tool.unit_price?.toString(),'125.55');
  }
 }
 assert.equal((await request('/api/tools/export?category=不正','ADMIN')).status,400);
 const empty=await request('/api/tools/export?tool_code=NO-EXPORT-RESULT','ADMIN');assert.equal(empty.status,200);
 const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await empty.arrayBuffer()) as never);assert.equal(book.getWorksheet('工具変更')!.getCell('A2').value,null);
});

test('検索結果201件のExcel出力は全ページを200件と1件のZIPに分割する',async()=>{
 await fixture.db.tool.createMany({data:Array.from({length:201},(_,i)=>({tool_code:'ZIP-EXPORT-'+String(i).padStart(3,'0'),name:'分割出力',category:'DRILL'}))});
 const response=await request('/api/tools/export?tool_code=ZIP-EXPORT-&page=2','ADMIN');
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');
 const zip=await JSZip.loadAsync(await response.arrayBuffer());
 const files=Object.keys(zip.files).sort();assert.equal(files.length,2);
 const rows=await Promise.all(files.map(async name=>parseToolWorkbook(await zip.file(name)!.async('nodebuffer'),'update')));
 assert.deepEqual(rows.map(part=>part.length),[200,1]);assert.equal(rows[0][0].values.tool_code,'ZIP-EXPORT-000');assert.equal(rows[1][0].values.tool_code,'ZIP-EXPORT-200');
 await fixture.db.tool.deleteMany({where:{tool_code:{startsWith:'ZIP-EXPORT-'}}});
});
