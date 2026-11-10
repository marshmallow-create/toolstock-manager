import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { databaseFixture } from './helpers/database';
import { MastersService } from '../src/lib/masters/service';

let fixture: Awaited<ReturnType<typeof databaseFixture>>, server: ChildProcess, origin: string;
let toolId: string, locationId: string, logs = '';
const request = (path: string, role?: string, options: RequestInit = {}) => fetch(origin + path, { redirect: 'manual', ...options, headers: { ...(role ? { Cookie: 'toolstock_session=' + fixture.tokens[role] } : {}), ...options.headers } });
const post = (path: string, role: string | undefined, body: unknown, from?: string) => request(path, role, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from ?? origin }, body: JSON.stringify(body) });
const form = (path: string, role: string, body: Record<string, string>) => request(path, role, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin }, body: new URLSearchParams(body) });
const issueInput = () => ({ request_key: randomUUID(), tool_id: toolId, location_id: locationId, quantity: 1 });

before(async () => {
 fixture = await databaseFixture('inventory_http');
 const service = new MastersService(fixture.db), token = fixture.tokens.ADMIN;
 toolId = (await service.createTool(token, { tool_code: 'INV-HTTP', name: '履歴検証工具', category: 'DRILL', manufacturer: '', model: '', unit: '本', safety_stock: 0, reorder_point: 0, target_stock: 0 })).id;
 locationId = (await fixture.db.location.create({data:{location_code:'INV-SHELF',name:'履歴検証棚'}})).id;
 await service.registerInitialStock(token, toolId, { location_id: locationId, quantity: 100, request_key: randomUUID() });
 const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
 const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve())); origin = 'http://127.0.0.1:' + port;
 const database = new URL(fixture.url); database.searchParams.set('schema', fixture.schema); database.searchParams.set('options', '-c search_path=' + fixture.schema);
 server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: { ...process.env, DATABASE_URL: database.href, APP_ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
 server.stdout?.on('data', data => logs += String(data)); server.stderr?.on('data', data => logs += String(data));
 for (let i = 0; i < 150; i++) { if (server.exitCode !== null) throw new Error(logs); try { await fetch(origin + '/login'); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
 throw new Error('HTTP server timeout');
}, { timeout: 25000 });
after(async () => { if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fixture?.close(); });

test('在庫APIは匿名を拒否し、全ロールで履歴を参照できる', async () => {
 for (const path of ['/api/history', '/api/history/' + randomUUID()]) assert.equal((await request(path)).status, 401);
 for (const action of ['issue', 'receive', 'reverse']) assert.equal((await post('/api/inventory/' + action, undefined, {})).status, 401);
 for (const role of ['WORKER', 'ADMIN']) {
  const response = await request('/api/history', role); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const data = await response.json(); assert.equal(data.pageSize, 50); assert.ok(Array.isArray(data.items));
 }
});

test('出庫JSONは確定残高を返し、再送で履歴と在庫を増減させない', async () => {
 const input = { ...issueInput(), quantity: 3 };
 const response = await post('/api/inventory/issue', 'WORKER', input); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') ?? '', /no-store/);
 const first = await response.json(); assert.equal(first.transaction.quantity, -3); assert.equal(first.transaction.actor_user_id, fixture.users.WORKER); assert.equal(first.transaction.on_hand_before - first.transaction.on_hand_after, 3);
 const count = await fixture.db.inventoryTransaction.count();
 const replay = await post('/api/inventory/issue', 'WORKER', input); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), first); assert.equal(await fixture.db.inventoryTransaction.count(), count);
 assert.equal((await post('/api/inventory/issue', 'WORKER', { ...input, quantity: 4 })).status, 409);
 const detail = await request('/api/history/' + first.transaction.id, 'WORKER'); assert.equal(detail.status, 200); const data = await detail.json(); assert.ok(!('machine' in data.transaction));assert.equal(first.transaction.machine_id,null); assert.equal(data.transaction.tool.id, toolId); assert.ok(!JSON.stringify(data).includes('password_hash'));
});

test('在庫書込は権限・Origin・数量・設備・入力形式を検証する', async () => {
 assert.equal((await post('/api/inventory/issue', 'ADMIN', issueInput())).status, 200);
 for (const role of ['WORKER']) for (const action of ['reverse']) assert.equal((await post('/api/inventory/' + action, role, {})).status, 403);
 assert.equal((await post('/api/inventory/issue', 'WORKER', issueInput(), 'https://evil.invalid')).status, 403);
 for (const quantity of [0, -1, 1.5, '1e2', true, '']) assert.equal((await post('/api/inventory/issue', 'WORKER', { ...issueInput(), quantity })).status, 400);
 assert.equal((await post('/api/inventory/issue', 'WORKER', { ...issueInput(), machine_id: randomUUID() })).status, 400);
 assert.equal((await post('/api/inventory/issue', 'WORKER', { ...issueInput(), quantity: 2147483647 })).status, 409);
 assert.equal((await request('/api/inventory/issue', 'ADMIN', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
 assert.equal((await request('/api/inventory/issue', 'ADMIN', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'a'.repeat(9000) }) })).status, 413);
});

test('both roles receive without reason and own receipt cancellations remain visible',async()=>{
 for(const role of ['WORKER','ADMIN']){const received=await post('/api/inventory/receive',role,issueInput());assert.equal(received.status,200);const receipt=(await received.json()).transaction;assert.equal(receipt.reason,null);assert.equal((await request('/api/history/'+receipt.id,role)).status,200);if(role==='WORKER'){const cancelled=await post('/api/inventory/reverse','ADMIN',{request_key:randomUUID(),transaction_id:receipt.id,reason:'receipt correction'});assert.equal(cancelled.status,200);const id=(await cancelled.json()).transaction.id;assert.equal((await request('/api/history/'+id,'WORKER')).status,200);}}
 const issued=await post('/api/inventory/issue','WORKER',issueInput());const original=(await issued.json()).transaction;const input={request_key:randomUUID(),transaction_id:original.id,reason:'correction'};const reversed=await post('/api/inventory/reverse','ADMIN',input);assert.equal(reversed.status,200);const reversal=(await reversed.json()).transaction;assert.equal(reversal.quantity,1);assert.equal((await request('/api/history/'+reversal.id,'WORKER')).status,200);assert.equal((await post('/api/inventory/reverse','ADMIN',input)).status,200);assert.equal((await post('/api/inventory/reverse','ADMIN',{...input,request_key:randomUUID()})).status,409);
});

test('本人履歴は他人の取引・ID指定を隠し、検索入力を検証する', async () => {
 const response = await post('/api/inventory/issue', 'ADMIN', issueInput()); const id = (await response.json()).transaction.id;
 assert.equal((await request('/api/history/' + id, 'WORKER')).status, 404);
 const own = await request('/api/history?tool_id=' + toolId, 'WORKER'); assert.ok(!(await own.json()).items.some((item: { id: string }) => item.id === id));
 assert.equal((await request('/api/history?actor_user_id=' + fixture.users.ADMIN, 'WORKER')).status, 403);
 for (const query of ['from=2026-02-30', 'from=2026-11-05&to=2026-11-04', 'page=0', 'type=BOGUS', 'tool_id=bad','machine_id='+randomUUID()]) assert.equal((await request('/api/history?' + query, 'ADMIN')).status, 400);
 assert.equal((await request('/api/history/' + randomUUID(), 'ADMIN')).status, 404);
});

test('tool detail provides both inventory forms and independent operation pages are removed', async () => {
 for (const path of ['/tools/' + toolId, '/history']) { const response = await request(path); assert.equal(response.status, 307); assert.match(response.headers.get('location') ?? '', /login/); }
 for (const role of ['WORKER', 'ADMIN']) {
  for (const path of ['/inventory/issue', '/inventory/receive']) assert.equal((await request(path, role)).status, 404);
  const detail = await request('/tools/' + toolId, role); const content = await detail.text();
  for (const mode of ['receive', 'issue']) assert.match(content, new RegExp('action="/api/inventory/' + mode + '"'));
 }
 const response = await request('/tools/' + toolId, 'WORKER'); assert.equal(response.status, 200); const html = await response.text();
 assert.ok(!html.includes('name="machine_id"'));assert.ok(!html.includes('name="reason"')); assert.ok(!html.match(/<select\b[^>]*name="location_id"/)); assert.match(html, new RegExp('type="hidden"[^>]*name="location_id"[^>]*value="' + locationId + '"')); assert.match(html, /出庫後の見込み/); assert.ok(html.includes('id="inventory-receive"')); assert.ok(html.includes('id="inventory-issue"'));
 assert.equal((await request('/tools/bad', 'WORKER')).status, 404); assert.equal((await request('/tools/' + randomUUID(), 'WORKER')).status, 404);
 const otherIssue = await fixture.db.inventoryTransaction.findFirstOrThrow({ where: { tool_id: toolId, actor_user_id: fixture.users.ADMIN, type: 'ISSUE' } });
 const allowedReversal = await fixture.db.inventoryTransaction.findFirstOrThrow({ where: { tool_id: toolId, actor_user_id: fixture.users.ADMIN, type: 'REVERSAL', quantity: {gt:0} } });
 const reversedIssue = await fixture.db.inventoryTransaction.findUniqueOrThrow({ where: { id: allowedReversal.reverses_id! } }); assert.equal(reversedIssue.actor_user_id, fixture.users.WORKER);
 const detail = await request('/tools/' + toolId, 'WORKER'); const detailHtml = await detail.text(); assert.match(detailHtml, /直近の履歴/); assert.ok(!detailHtml.includes('href=\"/history/' + otherIssue.id + '\"')); assert.ok(!detailHtml.includes('href=\"/history/' + allowedReversal.id + '\"'));
 const dashboard = await request('/dashboard', 'WORKER'); const dashboardHtml = await dashboard.text(); assert.doesNotMatch(dashboardHtml, /href="\/inventory\/(issue|receive)/); assert.match(dashboardHtml, /href="\/history"/);
});

test('HTML入出庫は工具詳細へ戻り、取消は履歴一覧から実行できる', async () => {
 const input = issueInput();
 const response = await form('/api/inventory/issue', 'WORKER', Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)]))); assert.equal(response.status, 303);
 const target = new URL(response.headers.get('location')!); assert.equal(target.pathname, '/tools/' + toolId); assert.equal(target.searchParams.get('saved'), '1');
 const id = (await fixture.db.inventoryTransaction.findUniqueOrThrow({ where: { idempotency_key: 'phase4:' + input.request_key } })).id;
 const detail = await request(target.pathname + target.search, 'WORKER'); assert.equal(detail.status, 200); assert.ok((await detail.text()).includes('id="inventory-issue"'));
 const list = await request('/history?tool_id=' + toolId, 'ADMIN'); const html = await list.text();
 assert.ok(html.includes('action="/api/inventory/reverse"')); assert.ok(html.includes('value="' + id + '"'));
 assert.doesNotMatch(html, /<(?:input|textarea)\b[^>]*name="reason"/);
 for (const role of [undefined, 'WORKER', 'ADMIN']) assert.equal((await request('/history/' + id, role)).status, 404);
 assert.equal(/href="\/history\//.test(html), false);
 const worker = await request('/history?tool_id=' + toolId, 'WORKER'); assert.ok(!(await worker.text()).includes('action="/api/inventory/reverse"'));
 const reversed = await form('/api/inventory/reverse', 'ADMIN', { request_key: randomUUID(), transaction_id: id }); assert.equal(reversed.status, 303); assert.equal(new URL(reversed.headers.get('location')!).pathname, '/history');
 const received = await form('/api/inventory/receive', 'WORKER', { request_key: randomUUID(), tool_id: toolId, location_id: locationId, quantity: '2', reason: 'フォーム補充' }); assert.equal(received.status, 303); assert.equal(new URL(received.headers.get('location')!).pathname, '/tools/' + toolId);
 const invalid = await form('/api/inventory/issue', 'WORKER', { request_key: randomUUID(), tool_id: toolId, location_id: locationId, quantity: '0' }); assert.equal(invalid.status, 303);
 const error = new URL(invalid.headers.get('location')!); assert.equal(error.pathname, '/tools/' + toolId); assert.equal(error.searchParams.get('operation'), 'issue'); assert.ok(error.searchParams.get('error'));
});

test('取消理由を入力せず、検索条件とページ番号を維持し不正な移動先は保存前に拒否する', async () => {
 const service = new MastersService(fixture.db);
 const tool = await service.createTool(fixture.tokens.ADMIN, { tool_code: 'SAME-PAGE', name: 'ページ維持用', category: 'DRILL', on_hand: 100 });
 const stock = await fixture.db.stockBalance.findFirstOrThrow({ where: { tool_id: tool.id } });
 const rows = Array.from({ length: 51 }, (_, index) => ({ id: randomUUID(), tool_id: tool.id, location_id: stock.location_id, actor_user_id: fixture.users.ADMIN, type: 'ISSUE' as const, quantity: -1, on_hand_after: 99 - index, idempotency_key: 'page-test:' + randomUUID(), created_at: new Date(Date.now() + index * 1000) }));
 await fixture.db.inventoryTransaction.createMany({ data: rows });
 await fixture.db.stockBalance.update({ where: { id: stock.id }, data: { on_hand: 49 } });
 const query = new URLSearchParams({ tool_code: 'SAME-PAGE', category: 'DRILL', movement: 'ISSUE', actor_user_id: fixture.users.ADMIN, page: '2' });
 const returnTo = '/history?' + query;
 const listing = await request(returnTo, 'ADMIN'); assert.equal(listing.status, 200);
 const html = await listing.text(); assert.ok(html.includes('name="return_to"')); assert.ok(html.includes('page=2')); assert.doesNotMatch(html, /name="reason"/);
 for (const target of ['https://evil.invalid/history', '//evil.invalid/history', '/dashboard', 'javascript:alert(1)', '/\\[']) {
  const denied = await post('/api/inventory/reverse', 'ADMIN', { transaction_id: rows[0].id, request_key: randomUUID(), return_to: target });
  assert.equal(denied.status, 400);
 }
 assert.equal(await fixture.db.inventoryTransaction.count({ where: { reverses_id: rows[0].id } }), 0);
 const cancelled = await form('/api/inventory/reverse', 'ADMIN', { transaction_id: rows[0].id, request_key: randomUUID(), return_to: returnTo });
 assert.equal(cancelled.status, 303);
 const target = new URL(cancelled.headers.get('location')!); assert.equal(target.pathname, '/history');
 for (const [key, value] of query) assert.equal(target.searchParams.get(key), value);
 assert.equal(target.searchParams.get('saved'), '1');
 assert.equal((await fixture.db.stockBalance.findUniqueOrThrow({ where: { id: stock.id } })).on_hand, 50);
});

test('空の履歴検索条件を許可し、失効したセッションは在庫を変更できない', async () => {
 const history = await request('/api/history?from=&to=&tool_id=&machine_id=&actor_user_id=&type=', 'WORKER'); assert.equal(history.status, 200);
 const token = (await fixture.auth.login('ADMIN_ALT', fixture.password)).token; await fixture.auth.logout(token);
 const before = await fixture.db.inventoryTransaction.count();
 const response = await request('/api/inventory/issue', undefined, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: 'toolstock_session=' + token }, body: JSON.stringify(issueInput()) }); assert.equal(response.status, 401);
 assert.equal(await fixture.db.inventoryTransaction.count(), before);
});
test('stocktaking endpoints and pages are retired',async()=>{for(const role of [undefined,'WORKER','ADMIN']){assert.equal((await post('/api/inventory/adjust',role,{})).status,404);assert.equal((await request('/inventory/adjust',role)).status,404);}for(const action of ['issue','receive']){const html=await (await request('/tools/'+toolId,'WORKER')).text();assert.ok(!html.includes('name="machine_id"'));assert.ok(!html.includes('name="reason"'));}});


test('履歴の品目コード・カテゴリー・操作者の検索とページ切り替え', async () => {
 const tool = await new MastersService(fixture.db).createTool(fixture.tokens.ADMIN, { tool_code: 'HISTORY-FILTER', name: '履歴検索テスト工具', category: 'DRILL', on_hand: 0 });
 const stock = await fixture.db.stockBalance.findFirstOrThrow({ where: { tool_id: tool.id } });
 await fixture.db.inventoryTransaction.createMany({ data: Array.from({ length: 51 }, () => ({ tool_id: tool.id, location_id: stock.location_id, actor_user_id: fixture.users.WORKER, type: 'ISSUE' as const, quantity: -1, on_hand_after: 0, idempotency_key: randomUUID() })) });
 const query = new URLSearchParams({ tool_code: 'history-filter', category: 'DRILL', actor_user_id: fixture.users.WORKER });
 for (const role of ['ADMIN', 'WORKER']) {
  const response = await request('/history?' + query, role); assert.equal(response.status, 200);
  const html = await response.text(), form = html.match(/<form[^>]*action="\/history"[^>]*>([\s\S]*?)<\/form>/)?.[1]; assert.ok(form);
  for (const name of ['tool_code', 'category', 'actor_user_id']) assert.ok(form.includes('name="' + name + '"'));
  assert.ok(form.indexOf('name="tool_code"') < form.indexOf('name="category"'));
  assert.ok(form.indexOf('name="category"') < form.indexOf('name="actor_user_id"'));
  assert.ok(!form.includes('name="tool_id"')); assert.ok(!form.includes('>工具<'));
  const next = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;', '&')).find(href => href.includes('page=2'));
  assert.ok(next); const params = new URL(next, origin).searchParams;
  for (const [key, value] of query) assert.equal(params.get(key), value);
  const api = await (await request('/api/history?' + query + '&page=2', role)).json(); assert.equal(api.total, 51); assert.equal(api.items.length, 1); assert.equal(api.items[0].tool.id, tool.id);
 }
 const missing = new URLSearchParams(query); missing.set('category', 'TAP');
 assert.equal((await (await request('/api/history?' + missing, 'ADMIN')).json()).total, 0);
});

test('history uses workspace layout chronological column order and price range privacy',async()=>{
 await fixture.db.tool.update({where:{id:toolId},data:{unit_price:'210.50'}});
 const created=await post('/api/inventory/receive','WORKER',{...issueInput(),quantity:4});assert.equal(created.status,200);
 const id=(await created.json()).transaction.id;
 const admin=await request('/history?tool_id='+toolId+'&unit_price_min=210.50&unit_price_max=210.50','ADMIN');assert.equal(admin.status,200);const html=await admin.text();
 const headings=[...html.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map(m=>m[1]);
 assert.deepEqual(headings,['日時','品目コード','品目名','カテゴリー','入出庫履歴','数量','操作者','在庫数','単価']);
 assert.ok(html.includes('max-w-[1600px]'));assert.ok(html.includes('name="unit_price_min"'));assert.ok(html.includes('name="unit_price_max"'));assert.match(html,/210\.50/);assert.equal(/href="\/history\//.test(html),false);
 const api=await request('/api/history?tool_id='+toolId+'&unit_price_min=210.50&unit_price_max=210.50','ADMIN');const data=await api.json();assert.equal(data.total,1);assert.equal(data.items[0].quantity,4);assert.equal(data.items[0].unit_price,'210.50');
 const worker=await request('/history?tool_id='+toolId,'WORKER');const workerHtml=await worker.text();assert.ok(!workerHtml.includes('210.50'));assert.ok(!workerHtml.includes('name="unit_price_min"'));
 for (const content of [html, workerHtml]) {
  const main = content.slice(content.indexOf('<main'), content.indexOf('</main>'));
  assert.equal(/<button\b[^>]*aria-controls=/.test(main), false, '履歴にはメニューボタンを表示しない');
  assert.ok(main.includes('マイページへ戻る'), '履歴には戻るリンクを表示する');
  assert.ok(main.indexOf('マイページへ戻る') < main.indexOf('<h1'), '戻るリンクを履歴の見出しより上に表示する');
  assert.ok(/<a\b[^>]*href="\/dashboard"[^>]*>マイページへ戻る<\/a>/.test(main));
 }
 assert.equal((await request('/api/history?unit_price_min=210.50','WORKER')).status,403);
 assert.equal((await request('/api/history?unit_price_min=2&unit_price_max=1','ADMIN')).status,400);
});
