import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {databaseFixture} from './helpers/database';
import {MastersService} from '../src/lib/masters/service';
let fixture:Awaited<ReturnType<typeof databaseFixture>>,server:ChildProcess,origin:string,toolId:string,locationId:string,logs='';
const request=(path:string,role?:string,options:RequestInit={})=>fetch(origin+path,{redirect:'manual',...options,headers:{...(role?{Cookie:'toolstock_session='+fixture.tokens[role]}:{}),...options.headers}});
const issue=(quantity:number,role='WORKER',request_key=randomUUID())=>request('/api/inventory/issue',role,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({tool_id:toolId,location_id:locationId,quantity,request_key})});
before(async()=>{
 fixture=await databaseFixture('orders_http');
 const tool=await new MastersService(fixture.db).createTool(fixture.tokens.ADMIN,{tool_code:'ORDER-HTTP',name:'発注対象ドリル',category:'DRILL',on_hand:10,reorder_point:5,order_quantity:7,unit_price:'1350.50',department:'17314'});toolId=tool.id;
 locationId=(await fixture.db.stockBalance.findFirstOrThrow({where:{tool_id:tool.id}})).location_id;
 const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));origin='http://127.0.0.1:'+port;
 const url=new URL(fixture.url);url.searchParams.set('schema',fixture.schema);url.searchParams.set('options','-c search_path='+fixture.schema);
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,DATABASE_URL:url.href,APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
 server.stdout?.on('data',d=>logs+=String(d));server.stderr?.on('data',d=>logs+=String(d));
 for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error(logs);try{await fetch(origin+'/login');return;}catch{await new Promise(r=>setTimeout(r,100));}}throw Error(logs);
},{timeout:25000});
after(async()=>{if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await fixture?.close();});

test('発注リストは認証が必要でメニューは入出庫履歴の直下に表示する',async()=>{
 assert.equal((await request('/orders')).status,307);assert.equal((await request('/api/orders')).status,401);
 for(const role of ['WORKER','ADMIN']){
  const html=await (await request('/dashboard',role)).text();assert.ok(html.indexOf('href="/history"')<html.indexOf('href="/orders"'));assert.ok(html.indexOf('href="/orders"')<html.indexOf('href="/tools/new"'));
  assert.equal((await request('/api/orders',role)).status,200);
  const page=await (await request('/orders',role)).text();assert.ok(page.includes('マイページへ戻る'));assert.ok(page.includes('発注リストに該当する工具はありません。'));
 }
 assert.equal((await request('/api/orders?page=bad','ADMIN')).status,400);
});

test('出庫後の厳密な境界判定と最新出庫の操作者、全ユーザーへの単価、管理者の発注登録欄を表示する',async()=>{
 assert.equal((await issue(5)).status,200);assert.equal((await (await request('/api/orders','ADMIN')).json()).total,0);
 const key=randomUUID(),first=await issue(1,'WORKER',key);assert.equal(first.status,200);const source=(await first.json()).transaction;
 assert.equal((await issue(1,'WORKER',key)).status,200);
 const result=await (await request('/api/orders','ADMIN')).json();assert.equal(result.total,1);assert.equal(result.items[0].quantity,7);assert.equal(result.items[0].actor.employee_code,'WORKER');assert.equal(result.items[0].created_at,source.created_at);
 for(const role of ['WORKER','ADMIN']){
  const api=await request('/api/orders',role);assert.match(api.headers.get('cache-control')??'',/no-store/);const data=await api.json();
  assert.equal(data.items.length,1);assert.equal(data.items[0].tool.department,'17314');assert.equal(data.items[0].unit_price,'1350.50');
  const html=await (await request('/orders',role)).text();
  assert.deepEqual([...html.matchAll(/<th\b[^>]*>(.*?)<\/th>/gs)].map(m=>m[1]),['日時','品目コード','品目名','カテゴリー','発注数','操作者','単価','部門','発注']);
  const cells=[...html.matchAll(/<td\b[^>]*>(.*?)<\/td>/gs)].map(m=>m[1]);assert.equal(cells.length,9);if(role==='ADMIN')assert.match(cells[8],/発注済みに登録/);else assert.equal(cells[8],'');assert.equal(cells[6],'¥1,351');assert.ok(!html.includes('1350.50'));
 }
 assert.equal((await issue(1,'ADMIN')).status,200);const latest=await (await request('/api/orders','ADMIN')).json();assert.equal(latest.total,1);assert.equal(latest.items[0].actor.employee_code,'ADMIN');
});

test('発注APIは認証・権限・Originを確認し箱発注から入出庫金額まで保持する',async()=>{
 const post=(path:string,role:string|undefined,body:unknown,from=origin)=>request(path,role,{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const service=new MastersService(fixture.db);
 await service.updateTool(fixture.tokens.ADMIN,toolId,{name:'発注対象ドリル',category:'DRILL',unit:'個',active:true,reorder_point:5,order_unit:'箱',units_per_order:10,unit_price:'5000'});
 const entries=await (await request('/api/orders','ADMIN')).json();
 const payload={tool_id:toolId,entry_id:entries.items[0].id,quantity:2,expected_units_per_order:10,request_key:randomUUID()};
 assert.equal((await post('/api/orders',undefined,payload)).status,401);
 assert.equal((await post('/api/orders','WORKER',payload)).status,403);
 assert.equal((await post('/api/orders','ADMIN',payload,'https://evil.invalid')).status,403);
 const created=await post('/api/orders','ADMIN',payload);assert.equal(created.status,200);const order=(await created.json()).order;
 assert.equal(order.stock_quantity,20);assert.equal((await post('/api/orders','ADMIN',payload)).status,200);
 const page=await (await request('/tools/'+toolId,'WORKER')).text();assert.match(page,/発注済み・未入庫/);assert.match(page,/name="tool_order_id"/);
 const receipt=await post('/api/inventory/receive','WORKER',{tool_id:toolId,location_id:locationId,quantity:1,quantity_unit:'order',tool_order_id:order.id,request_key:randomUUID()});
 assert.equal(receipt.status,200);assert.equal((await receipt.json()).transaction.quantity,10);
 const out=await issue(3);assert.equal(out.status,200);const id=(await out.json()).transaction.id;
 const history=(await (await request('/api/history/'+id,'WORKER')).json()).transaction;assert.equal(history.unit_price,'500.00');assert.equal(history.amount,'-1500.00');
 assert.equal((await service.toolDetail(fixture.tokens.ADMIN,toolId)).on_order,10);
 assert.equal((await post('/api/orders/'+order.id+'/cancel','WORKER',{request_key:randomUUID()})).status,403);
 const cancelled=await post('/api/orders/'+order.id+'/cancel','ADMIN',{request_key:randomUUID()});assert.equal(cancelled.status,200);
 assert.equal((await service.toolDetail(fixture.tokens.ADMIN,toolId)).on_order,0);
});
