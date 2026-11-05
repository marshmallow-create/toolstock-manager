import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { databaseFixture } from './helpers/database';
import { MastersService } from '../src/lib/masters/service';

let fixture: Awaited<ReturnType<typeof databaseFixture>>, server: ChildProcess, origin: string;
let toolId: string, locationId: string, machineId: string, logs = '';
const request = (path: string, role?: string, options: RequestInit = {}) => fetch(origin + path, { redirect: 'manual', ...options, headers: { ...(role ? { Cookie: 'toolstock_session=' + fixture.tokens[role] } : {}), ...options.headers } });
const post = (path: string, role: string | undefined, body: unknown, from?: string) => request(path, role, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from ?? origin }, body: JSON.stringify(body) });
const form = (path: string, role: string, body: Record<string, string>) => request(path, role, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin }, body: new URLSearchParams(body) });
const issueInput = () => ({ request_key: randomUUID(), tool_id: toolId, location_id: locationId, machine_id: machineId, quantity: 1 });

before(async () => {
 fixture = await databaseFixture('inventory_http');
 const service = new MastersService(fixture.db), token = fixture.tokens.ADMIN;
 toolId = (await service.createTool(token, { tool_code: 'INV-HTTP', name: '履歴検証工具', category: 'DRILL', manufacturer: '', model: '', unit: '本', safety_stock: 0, reorder_point: 0, target_stock: 0 })).id;
 locationId = (await service.createMaster(token, 'locations', { location_code: 'INV-SHELF', name: '履歴検証棚' })).id;
 machineId = (await service.createMaster(token, 'machines', { machine_code: 'INV-MACHINE', name: '履歴検証設備' })).id;
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
 for (const action of ['issue', 'receive', 'adjust', 'reverse']) assert.equal((await post('/api/inventory/' + action, undefined, {})).status, 401);
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
 const detail = await request('/api/history/' + first.transaction.id, 'WORKER'); assert.equal(detail.status, 200); const data = await detail.json(); assert.equal(data.transaction.machine.id, machineId); assert.equal(data.transaction.tool.id, toolId); assert.ok(!JSON.stringify(data).includes('password_hash'));
});

test('在庫書込は権限・Origin・数量・設備・入力形式を検証する', async () => {
 assert.equal((await post('/api/inventory/issue', 'ADMIN', issueInput())).status, 200);
 for (const role of ['WORKER']) for (const action of ['receive', 'adjust', 'reverse']) assert.equal((await post('/api/inventory/' + action, role, {})).status, 403);
 assert.equal((await post('/api/inventory/issue', 'WORKER', issueInput(), 'https://evil.invalid')).status, 403);
 for (const quantity of [0, -1, 1.5, '1e2', true, '']) assert.equal((await post('/api/inventory/issue', 'WORKER', { ...issueInput(), quantity })).status, 400);
 assert.equal((await post('/api/inventory/issue', 'WORKER', { ...issueInput(), machine_id: '' })).status, 400);
 assert.equal((await post('/api/inventory/issue', 'WORKER', { ...issueInput(), quantity: 2147483647 })).status, 409);
 assert.equal((await request('/api/inventory/issue', 'ADMIN', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
 assert.equal((await request('/api/inventory/issue', 'ADMIN', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'a'.repeat(9000) }) })).status, 413);
});

test('入庫・棚卸・逆取引が保存され、本人には管理者による取消が見える', async () => {
 const received = await post('/api/inventory/receive', 'ADMIN_ALT', { request_key: randomUUID(), tool_id: toolId, location_id: locationId, quantity: 4, reason: '手動補充' }); assert.equal(received.status, 200);
 const stock = await fixture.db.stockBalance.findUniqueOrThrow({ where: { tool_id_location_id: { tool_id: toolId, location_id: locationId } } });
 const adjusted = await post('/api/inventory/adjust', 'ADMIN', { request_key: randomUUID(), tool_id: toolId, location_id: locationId, counted_quantity: stock.on_hand + 2, expected_on_hand: stock.on_hand, expected_reserved: stock.reserved, reason: '実棚確認' }); assert.equal(adjusted.status, 200); assert.equal((await adjusted.json()).transaction.quantity, 2);
 const issued = await post('/api/inventory/issue', 'WORKER', issueInput()); const original = (await issued.json()).transaction;
 const input = { request_key: randomUUID(), transaction_id: original.id, reason: '設備選択の訂正' };
 const reversed = await post('/api/inventory/reverse', 'ADMIN', input); assert.equal(reversed.status, 200); const reversal = (await reversed.json()).transaction; assert.equal(reversal.reverses_id, original.id); assert.equal(reversal.quantity, 1);
 const replay = await post('/api/inventory/reverse', 'ADMIN', input); assert.equal(replay.status, 200); assert.equal((await replay.json()).transaction.id, reversal.id);
 assert.equal((await post('/api/inventory/reverse', 'ADMIN', { ...input, request_key: randomUUID() })).status, 409);
 assert.equal((await request('/api/history/' + reversal.id, 'WORKER')).status, 200);
 const history = await request('/api/history?tool_id=' + toolId + '&machine_id=' + machineId, 'WORKER'); const rows = (await history.json()).items; assert.ok(rows.some((row: { id: string }) => row.id === reversal.id));
});

test('本人履歴は他人の取引・ID指定を隠し、検索入力を検証する', async () => {
 const response = await post('/api/inventory/issue', 'ADMIN', issueInput()); const id = (await response.json()).transaction.id;
 assert.equal((await request('/api/history/' + id, 'WORKER')).status, 404);
 const own = await request('/api/history?tool_id=' + toolId, 'WORKER'); assert.ok(!(await own.json()).items.some((item: { id: string }) => item.id === id));
 assert.equal((await request('/api/history?actor_user_id=' + fixture.users.ADMIN, 'WORKER')).status, 403);
 for (const query of ['from=2026-02-30', 'from=2026-11-05&to=2026-11-04', 'page=0', 'type=BOGUS', 'tool_id=bad']) assert.equal((await request('/api/history?' + query, 'ADMIN')).status, 400);
 assert.equal((await request('/api/history/' + randomUUID(), 'ADMIN')).status, 404);
});

test('実画面の出庫フォームは設備を必須にし、棚の自動選択と期待残高を保持する', async () => {
 for (const path of ['/inventory/issue', '/inventory/receive', '/inventory/adjust', '/history']) { const response = await request(path); assert.equal(response.status, 307); assert.match(response.headers.get('location') ?? '', /login/); }
 for (const role of ['WORKER']) for (const path of ['/inventory/receive', '/inventory/adjust']) assert.equal((await request(path, role)).status, 307);
 assert.equal((await request('/inventory/issue', 'ADMIN')).status, 200);
 const response = await request('/inventory/issue?tool_id=' + toolId, 'WORKER'); assert.equal(response.status, 200); const html = await response.text();
 assert.match(html, /name="machine_id"[^>]*required/); const locationSelect = html.match(/<select\b[^>]*name="location_id"[^>]*>(.*?)<\/select>/s)?.[1] ?? ""; assert.ok(locationSelect.includes('value="' + locationId + '"')); assert.match(locationSelect, /<option[^>]*selected=""/); assert.match(html, /出庫後の見込み/); assert.match(html, /履歴検証棚/);
 const adjust = await request('/inventory/adjust?tool_id=' + toolId, 'ADMIN'); const adjustHtml = await adjust.text(); assert.match(adjustHtml, /name="expected_on_hand"/); assert.match(adjustHtml, /name="expected_reserved"/);
 assert.equal((await request('/inventory/issue?tool_id=bad', 'WORKER')).status, 404); assert.equal((await request('/inventory/issue?tool_id=' + randomUUID(), 'WORKER')).status, 404);
 const otherIssue = await fixture.db.inventoryTransaction.findFirstOrThrow({ where: { tool_id: toolId, actor_user_id: fixture.users.ADMIN, type: 'ISSUE' } });
 const allowedReversal = await fixture.db.inventoryTransaction.findFirstOrThrow({ where: { tool_id: toolId, actor_user_id: fixture.users.ADMIN, type: 'REVERSAL' } });
 const reversedIssue = await fixture.db.inventoryTransaction.findUniqueOrThrow({ where: { id: allowedReversal.reverses_id! } }); assert.equal(reversedIssue.actor_user_id, fixture.users.WORKER);
 const detail = await request('/tools/' + toolId, 'WORKER'); const detailHtml = await detail.text(); assert.match(detailHtml, /直近の履歴/); assert.ok(!detailHtml.includes('href=\"/history/' + otherIssue.id + '\"')); assert.ok(detailHtml.includes('href=\"/history/' + allowedReversal.id + '\"'));
 const dashboard = await request('/dashboard', 'WORKER'); const dashboardHtml = await dashboard.text(); assert.match(dashboardHtml, /href="\/inventory\/issue"/); assert.match(dashboardHtml, /href="\/history"/);
});

test('HTML入出庫・棚卸・取消は確定履歴へ303で移動し、エラー時は工具を保持する', async () => {
 const response = await form('/api/inventory/issue', 'WORKER', Object.fromEntries(Object.entries(issueInput()).map(([key, value]) => [key, String(value)]))); assert.equal(response.status, 303);
 const target = new URL(response.headers.get('location')!); assert.match(target.pathname, /^\/history\/[0-9a-f-]{36}$/);
 const detail = await request(target.pathname, 'ADMIN'); const html = await detail.text(); assert.match(html, /理由を付けて取り消す/); assert.match(html, /出庫前/);
 const id = target.pathname.split('/').pop()!;
 const reversed = await form('/api/inventory/reverse', 'ADMIN', { request_key: randomUUID(), transaction_id: id, reason: 'フォーム取消' }); assert.equal(reversed.status, 303); assert.match(reversed.headers.get('location') ?? '', /\/history\//);
 const received = await form('/api/inventory/receive', 'ADMIN', { request_key: randomUUID(), tool_id: toolId, location_id: locationId, quantity: '2', reason: 'フォーム補充' }); assert.equal(received.status, 303);
 const stock = await fixture.db.stockBalance.findUniqueOrThrow({ where: { tool_id_location_id: { tool_id: toolId, location_id: locationId } } });
 const adjusted = await form('/api/inventory/adjust', 'ADMIN', { request_key: randomUUID(), tool_id: toolId, location_id: locationId, counted_quantity: String(stock.on_hand + 1), expected_on_hand: String(stock.on_hand), expected_reserved: String(stock.reserved), reason: 'フォーム実棚' }); assert.equal(adjusted.status, 303);
 const invalid = await form('/api/inventory/issue', 'WORKER', { request_key: randomUUID(), tool_id: toolId, location_id: locationId, machine_id: machineId, quantity: '0' }); assert.equal(invalid.status, 303);
 const error = new URL(invalid.headers.get('location')!); assert.equal(error.pathname, '/inventory/issue'); assert.equal(error.searchParams.get('tool_id'), toolId); assert.ok(error.searchParams.get('error'));
});

test('空の履歴検索条件を許可し、失効したセッションは在庫を変更できない', async () => {
 const history = await request('/api/history?from=&to=&tool_id=&machine_id=&actor_user_id=&type=', 'WORKER'); assert.equal(history.status, 200);
 const token = (await fixture.auth.login('ADMIN_ALT', fixture.password)).token; await fixture.auth.logout(token);
 const before = await fixture.db.inventoryTransaction.count();
 const response = await request('/api/inventory/issue', undefined, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: 'toolstock_session=' + token }, body: JSON.stringify(issueInput()) }); assert.equal(response.status, 401);
 assert.equal(await fixture.db.inventoryTransaction.count(), before);
});
