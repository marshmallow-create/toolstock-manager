import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { databaseFixture } from './helpers/database';
import { MastersService } from '../src/lib/masters/service';
let fixture: Awaited<ReturnType<typeof databaseFixture>>, server: ChildProcess, origin: string;
let toolId: string, locationId: string, logs = '';
const base = { tool_code: 'HTTP-TOOL', name: 'HTTP架空ドリル', category: 'DRILL', manufacturer: '架空メーカー', model: 'HTTP-MODEL', unit: '本', safety_stock: '2', reorder_point: '5', target_stock: '10' };
const cookie = (role: string) => 'toolstock_session=' + fixture.tokens[role];
const request = (path: string, role?: string, options: RequestInit = {}) => fetch(origin + path, { redirect: 'manual', ...options, headers: { ...(role ? { Cookie: cookie(role) } : {}), ...options.headers } });
const post = (path: string, role: string | undefined, body: unknown, from?: string) => request(path, role, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from ?? origin }, body: JSON.stringify(body) });
const form = (path: string, role: string, body: Record<string, string>) => request(path, role, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin }, body: new URLSearchParams(body) });

before(async () => {
 fixture = await databaseFixture('masters_http');
 const service = new MastersService(fixture.db);
 toolId = (await service.createTool(fixture.tokens.ADMIN, {...base,unit_price:"1234.56"})).id;
 locationId = (await service.createMaster(fixture.tokens.ADMIN, 'locations', { location_code: 'HTTP-SHELF', name: 'HTTP架空棚' })).id;
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
  assert.equal((await post('/api/tools', role, base)).status, 403);
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
 const html = await detail.text(); assert.match(html, /HTTP架空棚/); assert.ok(!html.includes('1234.56')); assert.ok(!html.includes('HTTP架空商社'));
 const administrator = await request('/tools/' + toolId, 'ADMIN'); const adminHtml=await administrator.text(); assert.ok(!adminHtml.includes('supplier-items')); assert.ok(!adminHtml.includes('name="supplier_id"'));
 const editPrice=await request('/tools/'+toolId+'/edit','ADMIN');assert.match(await editPrice.text(),/name="unit_price"[^>]*value="1234\.56"/);
 for (const role of ['WORKER']) {
  for (const path of ['/tools/new', '/tools/' + toolId + '/edit']) assert.equal((await request(path, role)).status, 307);
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
 assert.match(categoryHtml, />DRILL<\/td>/);
 const categoryMiss = await request('/api/tools?tool_code=HTTP-TOOL&category=OTHER', 'WORKER');
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
 const created = await form('/api/tools', 'ADMIN', { tool_code: 'LIST-FORM', name: '一覧形式の工具', category: '切削工具', on_hand: '17', reorder_point: '4', order_quantity: '6', unit_price: '456.78', department: '組立部', shelf_code: 'SHELF-FORM' });
 assert.equal(created.status, 303);
 assert.equal(created.headers.get('location'), origin + '/dashboard?saved=1');
 const listed = await request('/api/tools?tool_code=LIST-FORM', 'ADMIN');
 const row = (await listed.json()).tools[0];
 assert.equal(row.on_hand, 17); assert.equal(row.reorder_point, 4); assert.equal(row.unit_price, '456.78'); assert.equal(row.order_quantity, 6); assert.equal(row.on_order, 0);
 assert.equal(row.category, '切削工具'); assert.equal(row.department, '組立部'); assert.deepEqual(row.shelf_codes, ['SHELF-FORM']);
 const list = await request('/dashboard?tool_code=LIST-FORM', 'ADMIN');
 const listHtml = await list.text();
 for (const value of ['一覧形式の工具', '組立部', 'SHELF-FORM', '456.78']) assert.ok(listHtml.includes(value));
 const worker = await request('/api/tools?tool_code=LIST-FORM', 'WORKER');
 assert.equal((await worker.json()).tools[0].unit_price, null);
 const editPage = await request('/tools/' + row.id + '/edit', 'ADMIN');
 assert.match(await editPage.text(), /name="shelf_code"[^>]*value="SHELF-FORM"/);
 const changed = await form('/api/tools/' + row.id, 'ADMIN', { ...base, tool_code: 'LIST-FORM', unit: '個', active: 'true', shelf_code: 'SHELF-CHANGED' });
 assert.equal(changed.status, 303);
 const after = (await (await request('/api/tools?tool_code=LIST-FORM', 'ADMIN')).json()).tools[0];
 assert.equal(after.shelf_code, 'SHELF-CHANGED'); assert.equal(after.on_hand, 17);
 const other = await new MastersService(fixture.db).createTool(fixture.tokens.ADMIN, { tool_code: 'OTHER-LEDGER', name: '別工具', on_hand: 3, shelf_code: 'OTHER-SHELF' });
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


test('all pages use the dashboard workspace frame and authenticated controls',async()=>{
 const baseline=await (await request('/dashboard','ADMIN')).text();const mainClass=baseline.match(/<main[^>]*class="([^"]+)"/)?.[1];const titleClass=baseline.match(/<h1[^>]*class="([^"]+)"/)?.[1];assert.ok(mainClass);assert.ok(titleClass);
 for(const path of ['/login','/dashboard','/history','/tools/new','/tools/'+toolId,'/tools/'+toolId+'/edit','/admin/users','/missing-workspace-page']){
  const response=await request(path,'ADMIN');assert.equal(response.status,path==='/missing-workspace-page'?404:200,path);const html=await response.text();
  assert.equal(html.match(/<main[^>]*class="([^"]+)"/)?.[1],mainClass,path);
  assert.equal(html.match(/<h1[^>]*class="([^"]+)"/)?.[1],titleClass,path);
  assert.equal([...html.matchAll(/<main\b/g)].length,1,path);
  if(path!=='/login'){assert.ok(html.includes('action="/api/auth/logout"'),path);assert.ok(html.includes('aria-label="ログイン情報"'),path);}
 }
});
