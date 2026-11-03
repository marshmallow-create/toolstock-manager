import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { databaseFixture } from './helpers/database';
import { MastersService } from '../src/lib/masters/service';
let fixture: Awaited<ReturnType<typeof databaseFixture>>, server: ChildProcess, origin: string;
let toolId: string, locationId: string, supplierId: string, logs = '';
const base = { tool_code: 'HTTP-TOOL', name: 'HTTP架空ドリル', category: 'DRILL', manufacturer: '架空メーカー', model: 'HTTP-MODEL', unit: '本', safety_stock: '2', reorder_point: '5', target_stock: '10' };
const cookie = (role: string) => 'toolstock_session=' + fixture.tokens[role];
const request = (path: string, role?: string, options: RequestInit = {}) => fetch(origin + path, { redirect: 'manual', ...options, headers: { ...(role ? { Cookie: cookie(role) } : {}), ...options.headers } });
const post = (path: string, role: string | undefined, body: unknown, from?: string) => request(path, role, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from ?? origin }, body: JSON.stringify(body) });
const form = (path: string, role: string, body: Record<string, string>) => request(path, role, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin }, body: new URLSearchParams(body) });

before(async () => {
 fixture = await databaseFixture('masters_http');
 const service = new MastersService(fixture.db);
 toolId = (await service.createTool(fixture.tokens.ADMIN, base)).id;
 locationId = (await service.createMaster(fixture.tokens.ADMIN, 'locations', { location_code: 'HTTP-SHELF', name: 'HTTP架空棚' })).id;
 supplierId = (await service.createMaster(fixture.tokens.ADMIN, 'suppliers', { supplier_code: 'HTTP-SUPPLIER', name: 'HTTP架空商社' })).id;
 await service.saveSupplierItem(fixture.tokens.ADMIN, toolId, undefined, { supplier_id: supplierId, unit_price: '1234.56', order_multiple: 5, lead_time_days: 7, preferred: true });
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

test('マスタAPIは匿名401、全4ロールの在庫参照、購買担当の条件閲覧、作業者の単価非公開', async () => {
 for (const path of ['/api/tools', '/api/tools/' + toolId, '/api/masters/locations']) assert.equal((await request(path)).status, 401);
 for (const role of ['WORKER', 'STOCK_MANAGER', 'PURCHASER', 'ADMIN']) {
  const response = await request('/api/tools?q=http-model', role); assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal((await response.json()).tools[0].id, toolId);
  const detail = await request('/api/tools/' + toolId, role); assert.equal(detail.status, 200);
  const data = await detail.json();
  if (role === 'WORKER') { assert.ok(!('supplier_items' in data.tool)); assert.ok(!JSON.stringify(data).includes('1234.56')); }
  else assert.equal(data.tool.supplier_items[0].unit_price, '1234.56');
 }
 assert.equal((await request('/api/masters/suppliers', 'WORKER')).status, 403);
 assert.equal((await request('/api/masters/suppliers', 'PURCHASER')).status, 200);
});

test('マスタAPIの書込権限、Origin、入力検証、重複コード、未存在ID', async () => {
 for (const role of ['WORKER', 'PURCHASER']) {
  assert.equal((await post('/api/tools', role, base)).status, 403);
  assert.equal((await post('/api/masters/locations', role, { location_code: 'NO', name: '禁止' })).status, 403);
  assert.equal((await post('/api/tools/' + toolId + '/initial-stock', role, { location_id: locationId, quantity: 1, request_key: randomUUID() })).status, 403);
 }
 assert.equal((await post('/api/tools', 'ADMIN', base, 'https://evil.invalid')).status, 403);
 assert.equal((await post('/api/tools', 'ADMIN', base)).status, 409);
 assert.equal((await post('/api/tools', 'ADMIN', { ...base, tool_code: 'INVALID', safety_stock: '1e2' })).status, 400);
 assert.equal((await request('/api/tools/not-uuid', 'ADMIN')).status, 400);
 assert.equal((await request('/api/tools/' + randomUUID(), 'ADMIN')).status, 404);
 assert.equal((await request('/api/masters/users', 'ADMIN')).status, 400);
 assert.equal((await request('/api/tools?page=bad', 'ADMIN')).status, 400);
});

test('APIから初期在庫を登録し、再送・異内容再送・別キー再登録を制御する', async () => {
 const path = '/api/tools/' + toolId + '/initial-stock';
 const input = { location_id: locationId, quantity: 7, request_key: randomUUID() };
 const response = await post(path, 'STOCK_MANAGER', input); assert.equal(response.status, 201);
 const first = await response.json();
 const replay = await post(path, 'STOCK_MANAGER', input); assert.equal(replay.status, 201); assert.deepEqual(await replay.json(), first);
 assert.equal((await post(path, 'STOCK_MANAGER', { ...input, quantity: 8 })).status, 409);
 assert.equal((await post(path, 'STOCK_MANAGER', { ...input, request_key: randomUUID() })).status, 409);
 assert.equal(await fixture.db.inventoryTransaction.count({ where: { tool_id: toolId } }), 1);
});

test('工具検索・詳細・編集・マスタ画面は認証と権限で表示内容を分ける', async () => {
 for (const path of ['/tools', '/tools/' + toolId, '/tools/new', '/tools/' + toolId + '/edit', '/admin/masters']) {
  const response = await request(path); assert.equal(response.status, 307, path); assert.match(response.headers.get('location') ?? '', /login/);
 }
 const list = await request('/tools?q=HTTP-MODEL', 'WORKER'); assert.equal(list.status, 200); assert.match(await list.text(), /HTTP架空ドリル/);
 const empty = await request('/tools?q=DOES-NOT-EXIST', 'WORKER'); assert.match(await empty.text(), /該当する工具はありません/);
 const detail = await request('/tools/' + toolId, 'WORKER'); assert.equal(detail.status, 200);
 const html = await detail.text(); assert.match(html, /HTTP架空棚/); assert.ok(!html.includes('1234.56')); assert.ok(!html.includes('HTTP架空商社'));
 const purchaser = await request('/tools/' + toolId, 'PURCHASER'); assert.match(await purchaser.text(), /1234.56/);
 for (const role of ['WORKER', 'PURCHASER']) {
  for (const path of ['/admin/masters', '/tools/new', '/tools/' + toolId + '/edit']) assert.equal((await request(path, role)).status, 307);
 }
 assert.equal((await request('/admin/masters', 'STOCK_MANAGER')).status, 200);
 assert.equal((await request('/tools/' + randomUUID(), 'ADMIN')).status, 404);
 assert.equal((await request('/tools/not-uuid', 'ADMIN')).status, 404);
 const dashboard = await request('/dashboard', 'STOCK_MANAGER'); assert.match(await dashboard.text(), /href="\/tools"/);
});

test('HTMLフォームで工具・マスタ・購買条件・初期在庫を保存し303で結果へ移動する', async () => {
 const created = await form('/api/tools', 'STOCK_MANAGER', { ...base, tool_code: 'FORM-TOOL' }); assert.equal(created.status, 303);
 assert.match(created.headers.get('location') ?? '', /\/tools\?saved=1/);
 const tool = await fixture.db.tool.findUniqueOrThrow({ where: { tool_code: 'FORM-TOOL' } });
 const updated = await form('/api/tools/' + tool.id, 'ADMIN', { ...base, tool_code: 'FORM-TOOL', name: 'フォーム更新工具', active: 'true' }); assert.equal(updated.status, 303);
 const master = await form('/api/masters/machines', 'ADMIN', { machine_code: 'FORM-MACHINE', name: '架空設備' }); assert.equal(master.status, 303);
 const machine = await fixture.db.machine.findUniqueOrThrow({ where: { machine_code: 'FORM-MACHINE' } });
 assert.equal((await form('/api/masters/machines/' + machine.id, 'ADMIN', { name: '設備更新', active: 'false' })).status, 303);
 assert.equal((await fixture.db.machine.findUniqueOrThrow({ where: { id: machine.id } })).active, false);
 const condition = { supplier_id: supplierId, unit_price: '10.25', order_multiple: '2', lead_time_days: '4', preferred: 'true', supplier_model: '架空型番' };
 assert.equal((await form('/api/tools/' + tool.id + '/supplier-items', 'ADMIN', condition)).status, 303);
 const item = await fixture.db.supplierItem.findFirstOrThrow({ where: { tool_id: tool.id } });
 assert.equal((await form('/api/tools/' + tool.id + '/supplier-items/' + item.id, 'ADMIN', { ...condition, unit_price: '11.50' })).status, 303);
 assert.equal((await form('/api/tools/' + tool.id + '/initial-stock', 'ADMIN', { location_id: locationId, quantity: '0', request_key: randomUUID() })).status, 303);
 const invalid = await form('/api/tools', 'ADMIN', { ...base, tool_code: '' }); assert.equal(invalid.status, 303); assert.match(invalid.headers.get('location') ?? '', /\/tools\/new\?error=/);
 const edit = await request('/tools/' + tool.id + '/edit', 'ADMIN'); assert.equal(edit.status, 200); assert.match(await edit.text(), /フォーム更新工具/);
});

test('失効したセッションではマスタ更新を拒否する', async () => {
 const token = (await fixture.auth.login('STOCK_MANAGER', fixture.password)).token;
 await fixture.auth.logout(token);
 const response = await request('/api/tools', undefined, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: 'toolstock_session=' + token }, body: JSON.stringify({ ...base, tool_code: 'EXPIRED' }) });
 assert.equal(response.status, 401);
 assert.equal(await fixture.db.tool.count({ where: { tool_code: 'EXPIRED' } }), 0);
});

test('コード入力のHTML patternがブラウザのUnicode Sets構文で有効かつ空白を拒否する', async () => {
 for (const path of ['/tools/new', '/admin/masters']) {
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
