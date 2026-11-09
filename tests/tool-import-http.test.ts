import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import ExcelJS from 'exceljs';
import { databaseFixture } from './helpers/database';
import { IMPORT_HEADERS } from '../src/lib/masters/tool-workbook';

let fixture:Awaited<ReturnType<typeof databaseFixture>>,server:ChildProcess,origin:string,logs='';
const request=(path:string,role?:string,options:RequestInit={})=>fetch(origin+path,{redirect:'manual',...options,headers:{...(role?{Cookie:'toolstock_session='+fixture.tokens[role]}:{}),...options.headers}});
async function workbook(code:string,category='ドリル'){
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('工具登録');sheet.addRow(IMPORT_HEADERS);sheet.addRow([code,'一括テスト工具',category,5,3,2,123.45,'17361','B-01']);
 return new Uint8Array(await book.xlsx.writeBuffer());
}
const upload=(data:Uint8Array,action='preview',role:string|null='WORKER',name='tools.xlsx',from=origin)=>{
 const body=new FormData();body.set('file',new File([data as BlobPart],name));body.set('action',action);
 return request('/api/tools/import',role ?? undefined,{method:'POST',headers:{Origin:from},body});
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

test('作業者・管理者の画面とテンプレート、匿名の拒否',async()=>{
 assert.equal((await request('/tools/import')).status,307);
 assert.equal((await request('/api/tools/import/template')).status,401);
 for(const role of ['WORKER','ADMIN']){
  const html=await (await request('/tools/new',role)).text();assert.ok(html.includes('href="/tools/import"'));
  const page=await request('/tools/import',role);assert.equal(page.status,200);assert.ok((await page.text()).includes('内容を確認する'));
  const template=await request('/api/tools/import/template',role);assert.equal(template.status,200);assert.ok(template.headers.get('content-type')?.includes('spreadsheetml'));assert.match(template.headers.get('content-disposition')??'',/xlsx/);
  const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await template.arrayBuffer()) as never);assert.equal(book.worksheets[0].getCell('A1').value,'品目コード');
 }
});
test('確認は書き込まず、確定で在庫・履歴を保存し再送は重複になる',async()=>{
 const buffer=await workbook('IMPORT-HTTP');
 const response=await upload(buffer);assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.valid,true);assert.equal(preview.rows[0].rowNumber,2);
 assert.equal(await fixture.db.tool.count(),0);
 const confirmed=await upload(buffer,'commit');assert.equal(confirmed.status,201);assert.deepEqual(await confirmed.json(),{count:1});
 const tool=await fixture.db.tool.findUniqueOrThrow({where:{tool_code:'IMPORT-HTTP'}});assert.equal(tool.department,'17361');assert.equal(tool.unit_price?.toFixed(2),'123.45');
 assert.equal((await fixture.db.stockBalance.findFirstOrThrow({where:{tool_id:tool.id}})).on_hand,5);
 assert.equal((await fixture.db.inventoryTransaction.findFirstOrThrow({where:{tool_id:tool.id}})).actor_user_id,fixture.users.WORKER);
 assert.equal((await upload(buffer,'commit')).status,400);assert.equal(await fixture.db.tool.count(),1);
});
test('不正行・形式・サイズ・認証・Originを拒否する',async()=>{
 const invalid=await upload(await workbook('INVALID-IMPORT','その他'));const preview=await invalid.json();assert.equal(preview.valid,false);assert.ok(preview.rows[0].errors.length>0);
 assert.equal((await upload(await workbook('INVALID-IMPORT','その他'),'commit')).status,400);
 const good=await workbook('NO-AUTH');assert.equal((await upload(good,'preview',null)).status,401);
 assert.equal((await upload(good,'preview','WORKER','tools.xlsx','https://evil.invalid')).status,403);
 assert.equal((await upload(good,'preview','WORKER','tools.xls')).status,400);
 assert.equal((await upload(new Uint8Array(2*1024*1024+1))).status,413);
 assert.equal((await upload(new TextEncoder().encode('bad'))).status,400);
 assert.equal((await request('/api/tools/import','WORKER',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,415);
 assert.equal(await fixture.db.tool.count({where:{tool_code:{in:['INVALID-IMPORT','NO-AUTH']}}}),0);
});
