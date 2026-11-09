import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { databaseFixture } from './helpers/database';
import { MastersService } from '../src/lib/masters/service';
import { tableDefinitions } from '../src/lib/data-manager/definitions';
let fixture: Awaited<ReturnType<typeof databaseFixture>>, server: ChildProcess, origin: string, toolId: string;
let logs = '';
const request = (path: string, role?: string, init: RequestInit = {}) => fetch(origin + path, { redirect: 'manual', ...init, headers: { ...(role ? { Cookie: 'toolstock_session=' + fixture.tokens[role] } : {}), ...init.headers } });
const post = (table: string, role: string | undefined, body: unknown, from?: string) => request('/api/admin/data/' + table, role, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from ?? origin }, body: JSON.stringify(body) });
before(async () => {
 fixture = await databaseFixture('data_http');
 toolId = (await new MastersService(fixture.db).createTool(fixture.tokens.ADMIN, { tool_code: 'DATA-HTTP', name: '表編集HTTP', category: 'DRILL', on_hand: 3 })).id;
 const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
 const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve())); origin = 'http://127.0.0.1:' + port;
 const url = new URL(fixture.url); url.searchParams.set('schema', fixture.schema); url.searchParams.set('options', '-c search_path=' + fixture.schema);
 server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: { ...process.env, APP_ORIGIN: origin, DATABASE_URL: url.href }, stdio: ['ignore', 'pipe', 'pipe'] });
 server.stdout?.on('data', data => logs += String(data)); server.stderr?.on('data', data => logs += String(data));
 for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error(logs); try { await fetch(origin + '/login'); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
 throw new Error('Server timeout: ' + logs);
}, { timeout: 25_000 });
after(async () => { if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fixture?.close(); });

test('画面・一覧・保存は管理者だけが利用でき、メニューから開ける', async () => {
 for (const role of [undefined, 'WORKER']) {
  assert.equal((await request('/admin/data', role)).status, 307);
  assert.equal((await request('/api/admin/data/tools', role)).status, role ? 403 : 401);
  assert.equal((await post('tools', role, {})).status, role ? 403 : 401);
 }
 const admin = await (await request('/dashboard', 'ADMIN')).text(); assert.ok(admin.includes('href="/admin/data"'));
 const worker = await (await request('/dashboard', 'WORKER')).text(); assert.ok(!worker.includes('href="/admin/data"'));
 for (const table of tableDefinitions) {
  const page = await request('/admin/data?table=' + table.key, 'ADMIN'); assert.equal(page.status, 200, table.key);
  const html = await page.text(); assert.ok(html.includes('マイページへ戻る')); assert.ok(html.includes(table.label));
  assert.ok(!html.includes('password_hash')); assert.ok(!html.includes('scrypt$'));
 }
});

test('表の検索・ページ切り替え・保存・競合・入力制約・Origin検証', async () => {
 const list = await request('/api/admin/data/tools?q=DATA-HTTP', 'ADMIN'); assert.equal(list.status, 200);
 assert.match(list.headers.get('cache-control') ?? '', /no-store/);
 const data = await list.json(); assert.equal(data.total, 1); assert.equal(data.rows[0].id, toolId);
 const body = { request_key: randomUUID(), changes: [{ ...data.rows[0], values: { name: '表から保存済み' } }] };
 assert.equal((await post('tools', 'ADMIN', body, 'https://invalid.example')).status, 403);
 assert.equal((await post('tools', 'ADMIN', body)).status, 200);
 assert.equal((await fixture.db.tool.findUniqueOrThrow({ where: { id: toolId } })).name, '表から保存済み');
 assert.equal((await post('tools', 'ADMIN', body)).status, 200);
 assert.equal((await post('tools', 'ADMIN', { ...body, request_key: randomUUID() })).status, 409);
 assert.equal((await post('tools', 'ADMIN', { ...body, changes: Array(21).fill(body.changes[0]) })).status, 400);
 assert.equal((await request('/api/admin/data/unknown', 'ADMIN')).status, 404);
 assert.equal((await request('/api/admin/data/tools?page=2', 'ADMIN')).status, 200);
 const audit = await (await request('/api/admin/data/audit', 'ADMIN')).json();
 assert.ok(!JSON.stringify(audit).includes('password_hash'));
});
