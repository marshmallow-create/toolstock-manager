import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { databaseFixture } from './helpers/database';
import { MastersService } from '../src/lib/masters/service';
let fixture: Awaited<ReturnType<typeof databaseFixture>>, server: ChildProcess, origin: string;
let toolId: string, locationId: string, logs = '';
const base = { tool_code: 'HTTP-TOOL', name: 'HTTP架空ドリル', category: 'DRILL', unit: '本', safety_stock: '2', reorder_point: '5', target_stock: '10' };
const cookie = (role: string) => 'toolstock_session=' + fixture.tokens[role];
const request = (path: string, role?: string, options: RequestInit = {}) => fetch(origin + path, { redirect: 'manual', ...options, headers: { ...(role ? { Cookie: cookie(role) } : {}), ...options.headers } });
const post = (path: string, role: string | undefined, body: unknown, from?: string) => request(path, role, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from ?? origin }, body: JSON.stringify(body) });
const form = (path: string, role: string, body: Record<string, string>) => request(path, role, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin }, body: new URLSearchParams(body) });

test('廃止したデータ管理の画面・APIは全利用者に404を返しメニューにも表示しない', async () => {
 for (const role of [undefined, 'WORKER', 'ADMIN']) {
  assert.equal((await request('/admin/data', role)).status, 404);
  for (const table of ['tools', 'stock-balances', 'users', 'audit', 'sessions']) {
   assert.equal((await request('/api/admin/data/' + table, role)).status, 404);
   assert.equal((await post('/api/admin/data/' + table, role, {})).status, 404);
  }
  if (role) assert.ok(!(await (await request('/dashboard', role)).text()).includes('href="/admin/data"'));
 }
});

before(async () => {
 fixture = await databaseFixture('masters_http');
 const service = new MastersService(fixture.db);
 toolId = (await service.createTool(fixture.tokens.ADMIN, {...base,unit_price:"1234.56"})).id;
 locationId = (await fixture.db.location.create({data:{location_code:'HTTP-SHELF',name:'HTTP架空棚'}})).id;
 const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
 const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve()));
 origin = 'http://127.0.0.1:' + port;
 const database = new URL(fixture.url); database.searchParams.set('schema', fixture.schema); database.searchParams.set('options', '-c search_path=' + fixture.schema);
 server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: { ...process.env, DATABASE_URL: database.href, APP_ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
 server.stdout?.on('data', data => logs += String(data)); server.stderr?.on('data', data => logs += String(data));
 for (let i = 0; i < 150; i++) {
  if (server.exitCode !== null) throw new Error(logs);
  try { await fetch(origin + '/login'); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
 }
 throw new Error('HTTP server timeout');
}, { timeout: 25000 });
after(async () => {
 if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
 await fixture?.close();
});

test('マスタAPIは匿名401、全2ロールの在庫参照、管理者の条件閲覧、作業者の単価非公開', async () => {
 for (const path of ['/api/tools', '/api/tools/' + toolId]) assert.equal((await request(path)).status, 401);
 for (const role of ['WORKER', 'ADMIN']) {
  const response = await request('/api/tools?q=http-tool', role); assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal((await response.json()).tools[0].id, toolId);
  const detail = await request('/api/tools/' + toolId, role); assert.equal(detail.status, 200);
  const data = await detail.json();
  if (role === 'WORKER') { assert.ok(!('supplier_items' in data.tool)); assert.ok(!JSON.stringify(data).includes('1234.56')); }
  else {assert.ok(!('supplier_items' in data.tool));assert.equal(data.tool.unit_price,'1234.56');}
 }
 assert.equal((await request('/api/masters/suppliers', 'WORKER')).status, 404);
 assert.equal((await request('/api/masters/suppliers', 'ADMIN')).status, 404);
});

test('マスタAPIの書込権限、Origin、入力検証、重複コード、未存在ID', async () => {
 for (const role of ['WORKER']) {
  assert.equal((await post('/api/tools/' + toolId, undefined, { ...base, active: true })).status, 401);
  assert.equal((await post('/api/masters/locations', role, { location_code: 'NO', name: '禁止' })).status, 404);
  assert.equal((await post('/api/tools/' + toolId + '/initial-stock', role, { location_id: locationId, quantity: 1, request_key: randomUUID() })).status, 403);
 }
 assert.equal((await post('/api/tools', 'ADMIN', base, 'https://evil.invalid')).status, 403);
 assert.equal((await post('/api/tools', 'ADMIN', base)).status, 409);
 assert.equal((await post('/api/tools', 'ADMIN', { ...base, tool_code: 'INVALID', safety_stock: '1e2' })).status, 400);
 assert.equal((await request('/api/tools/not-uuid', 'ADMIN')).status, 400);
 assert.equal((await request('/api/tools/' + randomUUID(), 'ADMIN')).status, 404);
 assert.equal((await request('/api/masters/users', 'ADMIN')).status, 404);
 assert.equal((await request('/api/tools?page=bad', 'ADMIN')).status, 400);
});

test('工具情報変更は管理者だけに表示し、作業者の直接アクセス・フォーム・API保存を拒否する', async () => {
 const service=new MastersService(fixture.db);
 const tool=await service.createTool(fixture.tokens.ADMIN,{...base,tool_code:'WORKER-EDIT',unit_price:'987.65',on_hand:7});
 const detail=await (await request('/tools/'+tool.id,'WORKER')).text();
 assert.ok(!detail.includes('href="/tools/'+tool.id+'/edit"'));
 const page=await request('/tools/'+tool.id+'/edit','WORKER');assert.equal(page.status,307);
 assert.ok(page.headers.get('location')?.includes('/dashboard?denied=1'));
 const response=await form('/api/tools/'+tool.id,'WORKER',{...base,tool_code:tool.tool_code,active:'true',name:'作業者編集済み',on_hand:'9',expected_on_hand:'7'});
 assert.equal(response.status,403);
 const after=await service.toolDetail(fixture.tokens.ADMIN,tool.id);
 assert.equal(after.name,tool.name);assert.equal(after.on_hand,7);assert.equal(after.unit_price,'987.65');
 const json=await post('/api/tools/'+tool.id,'WORKER',{...base,tool_code:tool.tool_code,active:true,name:'API編集済み'});
 assert.equal(json.status,403);assert.ok(!(await json.text()).includes('987.65'));
 const adminDetail=await (await request('/tools/'+tool.id,'ADMIN')).text();assert.ok(adminDetail.includes('href="/tools/'+tool.id+'/edit"'));
 assert.equal((await request('/tools/'+tool.id+'/edit','ADMIN')).status,200);
 const saved=await form('/api/tools/'+tool.id,'ADMIN',{...base,tool_code:tool.tool_code,active:'true',name:'管理者編集済み',on_hand:'9',expected_on_hand:'7'});assert.equal(saved.status,303);
 assert.equal((await fixture.db.tool.findUniqueOrThrow({where:{id:tool.id}})).name,'管理者編集済み');
});

test('作業者のメニュー・登録画面・フォーム送信から工具登録できる', async () => {
 const dashboard = await (await request('/dashboard', 'WORKER')).text();
 assert.match(dashboard, /href="\/tools\/new"/); assert.ok(!dashboard.includes('href="/admin/users"'));
 const page = await request('/tools/new', 'WORKER'); assert.equal(page.status, 200);
 const html = await page.text(); assert.ok(html.includes('action="/api/tools"')); assert.ok(html.includes('name="on_hand"'));
 const response = await form('/api/tools', 'WORKER', { tool_code: 'WORKER-CREATE', name: '作業者登録工具', category: 'DRILL', on_hand: '6', order_quantity: '3', reorder_point: '5', unit_price: '123.45', shelf_code: 'W-01', department: '17361' });
 assert.equal(response.status, 303); assert.equal(new URL(response.headers.get('location')!).pathname, '/dashboard');
 const tool = await fixture.db.tool.findUniqueOrThrow({ where: { tool_code: 'WORKER-CREATE' } });
 const detail = await new MastersService(fixture.db).toolDetail(fixture.tokens.ADMIN, tool.id);
 assert.equal(detail.on_hand, 6); assert.equal(detail.order_quantity, 3); assert.equal(detail.policy?.reorder_point, 5);
 assert.equal(detail.unit_price, '123.45'); assert.equal(detail.department, '17361'); assert.equal(detail.shelf_code, 'W-01');
 assert.equal((await post('/api/tools/' + tool.id, 'WORKER', { ...base, tool_code: tool.tool_code, unit: detail.unit, active: true })).status, 403);
 assert.equal((await post('/api/tools', undefined, { ...base, tool_code: 'ANONYMOUS' })).status, 401);
 assert.equal((await post('/api/tools', 'WORKER', { ...base, tool_code: 'BAD-ORIGIN' }, 'https://evil.invalid')).status, 403);
});

test('APIから初期在庫を登録し、再送・異内容再送・別キー再登録を制御する', async () => {
 const path = '/api/tools/' + toolId + '/initial-stock';
 const input = { location_id: locationId, quantity: 7, request_key: randomUUID() };
 const response = await post(path, 'ADMIN_ALT', input); assert.equal(response.status, 201);
 const first = await response.json();
 const replay = await post(path, 'ADMIN_ALT', input); assert.equal(replay.status, 201); assert.deepEqual(await replay.json(), first);
 assert.equal((await post(path, 'ADMIN_ALT', { ...input, quantity: 8 })).status, 409);
 assert.equal((await post(path, 'ADMIN_ALT', { ...input, request_key: randomUUID() })).status, 409);
 assert.equal(await fixture.db.inventoryTransaction.count({ where: { tool_id: toolId } }), 1);
});

test('工具検索・詳細・編集・マスタ画面は認証と権限で表示内容を分ける', async () => {
 for (const path of ['/tools', '/tools/' + toolId, '/tools/new', '/tools/' + toolId + '/edit']) {
  const response = await request(path); assert.equal(response.status, 307, path); assert.match(response.headers.get('location') ?? '', /login/);
 }
 for (const role of ['WORKER', 'ADMIN']) {
  const oldList = await request('/tools?tool_code=HTTP-TOOL&name=drill&page=2', role);
  assert.equal(oldList.status, 307);
  assert.equal(oldList.headers.get('location'), '/dashboard?tool_code=HTTP-TOOL&name=drill&page=2');
 }
 const list = await request('/dashboard?tool_code=HTTP-TOOL&name=' + encodeURIComponent('架空ドリル'), 'WORKER'); assert.equal(list.status, 200); assert.match(await list.text(), /HTTP架空ドリル/);
 const empty = await request('/dashboard?q=DOES-NOT-EXIST', 'WORKER'); assert.match(await empty.text(), /該当する工具はありません/);
 const detail = await request('/tools/' + toolId, 'WORKER'); assert.equal(detail.status, 200);
 const html = await detail.text(); assert.match(html, /工具情報/); assert.ok(!html.includes('保管場所別在庫')); assert.ok(!html.includes('select name="location_id"')); assert.ok(!html.includes('1234.56')); assert.ok(!html.includes('HTTP架空商社'));
 const administrator = await request('/tools/' + toolId, 'ADMIN'); const adminHtml=await administrator.text(); assert.ok(!adminHtml.includes('supplier-items')); assert.ok(!adminHtml.includes('name="supplier_id"'));
 const editPrice=await request('/tools/'+toolId+'/edit','ADMIN');assert.match(await editPrice.text(),/name="unit_price"[^>]*value="1234\.56"/);
 for (const role of ['WORKER']) {
  assert.equal((await request('/tools/new', role)).status, 200);
  assert.equal((await request('/tools/' + toolId + '/edit', role)).status, 307);
 }
 assert.equal((await request('/admin/masters', 'ADMIN_ALT')).status, 404);
 assert.equal((await request('/tools/' + randomUUID(), 'ADMIN')).status, 404);
 assert.equal((await request('/tools/not-uuid', 'ADMIN')).status, 404);
 const dashboard = await request('/dashboard', 'ADMIN_ALT'); const dashboardHtml = await dashboard.text();
 assert.match(dashboardHtml, /action="\/dashboard"/); assert.match(dashboardHtml, /HTTP-TOOL/);
 assert.doesNotMatch(dashboardHtml, /href="\/tools"/);
 assert.doesNotMatch(dashboardHtml, /保管場所管理|href="\/admin\/masters"/);
 const categoryMatch = await request('/dashboard?tool_code=HTTP-TOOL&category=DRILL', 'WORKER');
 const categoryHtml = await categoryMatch.text();
 assert.match(categoryHtml, /HTTP架空ドリル/);
 assert.match(categoryHtml, />ドリル<\/td>/);
 const categoryMiss = await request('/api/tools?tool_code=HTTP-TOOL&category=TAP', 'WORKER');
 assert.deepEqual((await categoryMiss.json()).tools, []);
});

test('HTML tool location and initial-stock forms save and redirect with 303', async () => {
 const created = await form('/api/tools', 'ADMIN_ALT', { ...base, tool_code: 'FORM-TOOL' }); assert.equal(created.status, 303);
 assert.match(created.headers.get('location') ?? '', /\/dashboard\?saved=1/);
 const tool = await fixture.db.tool.findUniqueOrThrow({ where: { tool_code: 'FORM-TOOL' } });
 const updated = await form('/api/tools/' + tool.id, 'ADMIN', { ...base, tool_code: 'FORM-TOOL', name: 'フォーム更新工具', active: 'true' }); assert.equal(updated.status, 303);
 const master=await form('/api/masters/locations','ADMIN',{location_code:'FORM-SHELF',name:'new shelf'});assert.equal(master.status,404);
 assert.equal((await form('/api/tools/' + tool.id + '/initial-stock', 'ADMIN', { location_id: locationId, quantity: '0', request_key: randomUUID() })).status, 303);
 const invalid = await form('/api/tools', 'ADMIN', { ...base, tool_code: '' }); assert.equal(invalid.status, 303); assert.match(invalid.headers.get('location') ?? '', /\/tools\/new\?error=/);
 const edit = await request('/tools/' + tool.id + '/edit', 'ADMIN'); assert.equal(edit.status, 200); assert.match(await edit.text(), /フォーム更新工具/);
});

test('新規登録画面の一覧と同じ項目から登録しカテゴリー・部門・単価・在庫・棚番を一覧に表示する', async () => {
 const page = await request('/tools/new', 'ADMIN'); assert.equal(page.status, 200);
 const html = await page.text();
 for (const label of ['品目コード', '品目名', 'カテゴリー', '在庫', '発注済み', '発注ライン', '発注数', '単価', '部門', '棚番']) assert.ok(html.includes(label), label);
 assert.ok(!html.includes('工具全体の在庫方針'));
 const created = await form('/api/tools', 'ADMIN', { tool_code: 'LIST-FORM', name: '一覧形式の工具', category: 'DRILL', on_hand: '17', reorder_point: '4', order_quantity: '6', unit_price: '456.78', department: '17362', shelf_code: 'SHELF-FORM' });
 assert.equal(created.status, 303);
 assert.equal(created.headers.get('location'), origin + '/dashboard?saved=1');
 const listed = await request('/api/tools?tool_code=LIST-FORM', 'ADMIN');
 const row = (await listed.json()).tools[0];
 assert.equal(row.on_hand, 17); assert.equal(row.reorder_point, 4); assert.equal(row.unit_price, '456.78'); assert.equal(row.order_quantity, 6); assert.equal(row.on_order, 0);
 assert.equal(row.category, 'DRILL'); assert.equal(row.department, '17362'); assert.deepEqual(row.shelf_codes, ['SHELF-FORM']);
 const list = await request('/dashboard?tool_code=LIST-FORM', 'ADMIN');
 const listHtml = await list.text();
 for (const value of ['一覧形式の工具', '17362', 'SHELF-FORM', '456.78']) assert.ok(listHtml.includes(value));
 const worker = await request('/api/tools?tool_code=LIST-FORM', 'WORKER');
 assert.equal((await worker.json()).tools[0].unit_price, null);
 const editPage = await request('/tools/' + row.id + '/edit', 'ADMIN');
 assert.match(await editPage.text(), /name="shelf_code"[^>]*value="SHELF-FORM"/);
 const changed = await form('/api/tools/' + row.id, 'ADMIN', { ...base, tool_code: 'LIST-FORM', unit: '個', active: 'true', shelf_code: 'SHELF-CHANGED' });
 assert.equal(changed.status, 303);
 const after = (await (await request('/api/tools?tool_code=LIST-FORM', 'ADMIN')).json()).tools[0];
 assert.equal(after.shelf_code, 'SHELF-CHANGED'); assert.equal(after.on_hand, 17);
 const other = await new MastersService(fixture.db).createTool(fixture.tokens.ADMIN, { tool_code: 'OTHER-LEDGER', category: 'DRILL', name: '別工具', on_hand: 3, shelf_code: 'OTHER-SHELF' });
 const ownStock = await fixture.db.stockBalance.findFirstOrThrow({ where: { tool_id: row.id } });
 const otherStock = await fixture.db.stockBalance.findFirstOrThrow({ where: { tool_id: other.id } });
 for (const mode of ['issue', 'receive']) {
  const response = await request('/tools/' + row.id + '?operation=' + mode, 'WORKER');
  assert.equal(response.status, 200);
  const text = await response.text(), main = text.slice(text.indexOf('<main'), text.indexOf('</main>'));
  assert.ok(main.includes('SHELF-CHANGED'));
  assert.match(main, new RegExp('type="hidden"[^>]*name="location_id"[^>]*value="' + ownStock.location_id + '"'));
  assert.ok(!main.includes(otherStock.location_id)); assert.ok(!main.includes('@tool/'));
 }
});

test('失効したセッションではマスタ更新を拒否する', async () => {
 const token = (await fixture.auth.login('ADMIN_ALT', fixture.password)).token;
 await fixture.auth.logout(token);
 const response = await request('/api/tools', undefined, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: 'toolstock_session=' + token }, body: JSON.stringify({ ...base, tool_code: 'EXPIRED' }) });
 assert.equal(response.status, 401);
 assert.equal(await fixture.db.tool.count({ where: { tool_code: 'EXPIRED' } }), 0);
});

test('コード入力のHTML patternがブラウザのUnicode Sets構文で有効かつ空白を拒否する', async () => {
 for (const path of ['/tools/new']) {
  const response = await request(path, 'ADMIN'); assert.equal(response.status, 200);
  const html = await response.text();
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(match => match[0]).filter(input => /name="(?:tool|machine|location|supplier)_code"/.test(input));
  assert.ok(inputs.length >= 1);
  for (const input of inputs) {
   const pattern = input.match(/pattern="([^"]+)"/)?.[1]; assert.ok(pattern);
   const constraint = new RegExp('^(?:' + pattern + ')$', 'v');
   assert.equal(constraint.test('DEMO-TOOL_01'), true);
   assert.equal(constraint.test('invalid code'), false);
  }
 }
});
test('retired equipment supplier and purchasing-condition APIs return 404',async()=>{for(const role of [undefined,'WORKER','ADMIN'])for(const path of ['/api/masters/machines','/api/masters/suppliers','/api/tools/'+toolId+'/supplier-items','/api/tools/'+toolId+'/supplier-items/'+randomUUID()]){assert.equal((await request(path,role)).status,404);assert.equal((await post(path,role,{})).status,404);}const html=await (await request('/admin/masters','ADMIN')).text();assert.ok(!html.includes('name="machine_code"'));assert.ok(!html.includes('name="supplier_code"'));});


test('ログインは中央カード、業務画面は共通フレームと認証操作を表示する',async()=>{
 const baseline=await (await request('/dashboard','ADMIN')).text();const mainClass=baseline.match(/<main[^>]*class="([^"]+)"/)?.[1];const titleClass=baseline.match(/<h1[^>]*class="([^"]+)"/)?.[1];assert.ok(mainClass);assert.ok(titleClass);
 for(const path of ['/login','/dashboard','/history','/tools/new','/tools/'+toolId,'/tools/'+toolId+'/edit','/admin/users','/missing-workspace-page']){
  const response=await request(path,'ADMIN');assert.equal(response.status,path==='/missing-workspace-page'?404:200,path);const html=await response.text();
  if(path==='/login') { assert.ok(html.includes('max-w-md')); assert.ok(html.includes('min-h-dvh')); }
  else assert.equal(html.match(/<main[^>]*class="([^"]+)"/)?.[1],mainClass,path);
  assert.equal(html.match(/<h1[^>]*class="([^"]+)"/)?.[1],titleClass,path);
  assert.equal([...html.matchAll(/<main\b/g)].length,1,path);
  if(path!=='/login'){assert.ok(html.includes('action="/api/auth/logout"'),path);assert.ok(html.includes('aria-label="ログイン情報"'),path);}
 }
});

test('編集フォームの在庫・発注ライン・発注数が保存され不要な入力は表示しない', async () => {
 const service = new MastersService(fixture.db);
 const tool = await service.createTool(fixture.tokens.ADMIN, { ...base, tool_code: 'EDIT-FIELDS', on_hand: 7, order_quantity: 3 });
 const html = await (await request('/tools/' + tool.id + '/edit', 'ADMIN')).text();
 const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
 for (const [field, value] of [['on_hand', '7'], ['order_quantity', '3'], ['reorder_point', '5']]) assert.match(main, new RegExp('name="' + field + '"[^>]*value="' + value + '"'));
 for (const removed of ['メーカー（任意）', '型番（任意）', '数量単位（例：本、個）', '工具全体の在庫方針', '工具番号は変更できません。']) assert.ok(!main.includes(removed));
 const inputs = Object.fromEntries([...main.matchAll(/<input\b[^>]*>/g)].map(([tag]) => [tag.match(/name="([^"]+)"/)?.[1], tag.match(/value="([^"]*)"/)?.[1] ?? '']).filter(([name]) => name));
 for (const [, name, options] of main.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) inputs[name] = options.match(/<option\b[^>]*value="([^"]*)"[^>]*selected=""/)?.[1] ?? options.match(/<option\b[^>]*value="([^"]*)"/)?.[1] ?? '';
 const response = await form('/api/tools/' + tool.id, 'ADMIN', { ...inputs, active: 'true', on_hand: '9', reorder_point: '4', order_quantity: '8' });
 assert.equal(response.status, 303); assert.equal(new URL(response.headers.get('location')!).pathname, '/tools/' + tool.id);
 const detail = await service.toolDetail(fixture.tokens.ADMIN, tool.id);
 assert.equal(detail.on_hand, 9); assert.equal(detail.order_quantity, 8); assert.equal(detail.policy?.reorder_point, 4);
 assert.ok(!('manufacturer' in detail)); assert.ok(!('model' in detail)); assert.equal(detail.unit, base.unit);
});

test('カテゴリーと部門は指定候補の選択式で候補外の保存を拒否する', async () => {
 for (const path of ['/tools/new', '/tools/' + toolId + '/edit', '/dashboard', '/history']) {
  const html = await (await request(path, 'ADMIN')).text();
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const categories = main.match(/<select\b[^>]*name="category"[^>]*>([\s\S]*?)<\/select>/)?.[1]; assert.ok(categories, path);
  assert.deepEqual([...categories.matchAll(/<option\b[^>]*value="([^"]+)"/g)].map(match => match[1]), ['DRILL', 'END_MILL', 'TAP', 'REAMER', 'INSERT']);
  for (const label of ['ドリル', 'エンドミル', 'タップ', 'リーマ', 'チップ']) assert.ok(categories.includes('>' + label + '</option>'));
  if (path === '/tools/new' || path.endsWith('/edit')) {
   const departments = main.match(/<select\b[^>]*name="department"[^>]*>([\s\S]*?)<\/select>/)?.[1]; assert.ok(departments);
   assert.deepEqual([...departments.matchAll(/<option\b[^>]*value="([^"]+)"/g)].map(match => match[1]), ['17314', '17361', '17362', '17363']);
  }
 }
 for (const invalid of [{ category: 'その他' }, { department: '17360' }]) {
  assert.equal((await post('/api/tools', 'ADMIN', { ...base, tool_code: 'INVALID-OPTIONS', ...invalid })).status, 400);
  assert.equal((await post('/api/tools/' + toolId, 'ADMIN', { ...base, active: true, ...invalid })).status, 400);
 }
});

test('入出庫・工具情報・工具変更履歴の順に表示し、変更内容と操作者を確認できる', async () => {
 const service = new MastersService(fixture.db);
 const input = { ...base, tool_code: 'CHANGE-HISTORY', on_hand: 5, unit_price: '876.54', shelf_code: 'A-01' };
 const tool = await service.createTool(fixture.tokens.ADMIN, input);
 const saved = await form('/api/tools/' + tool.id, 'ADMIN', { tool_code: tool.tool_code, name: tool.name, category: tool.category, unit: tool.unit, active: 'true', shelf_code: 'B-02', unit_price: '987.65', reorder_point: '5' });
 assert.equal(saved.status, 303);
 for (const role of ['ADMIN', 'WORKER']) {
  const response = await request('/tools/' + tool.id, role); assert.equal(response.status, 200);
  const html = await response.text(), main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const history = main.match(/<section\b[^>]*aria-labelledby="tool-change-history"[^>]*>([\s\S]*?)<\/section>/)?.[1]; assert.ok(history);
  assert.ok(main.indexOf('id="tool-information"') < main.indexOf('id="tool-change-history"'));
  assert.ok(main.indexOf('aria-label="入出庫"') < main.indexOf('id="tool-information"'));
  for (const label of ['変更日時', '変更内容', '操作者', 'A-01', 'B-02', 'ADMIN']) assert.ok(history.includes(label), label);
  assert.doesNotMatch(history, /安全在庫|目標在庫|数量単位|メーカー|型番/);
  assert.match(history, /\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/);
  if (role === 'WORKER') { assert.ok(!html.includes('876.54')); assert.ok(!html.includes('987.65')); }
  else { assert.ok(history.includes('876.54')); assert.ok(history.includes('987.65')); }
 }
});
