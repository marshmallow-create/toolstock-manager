import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBackupTarget } from './backup-target.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = new URL(process.env.DATABASE_URL ?? '');
const database = decodeURIComponent(url.pathname.slice(1)), username = decodeURIComponent(url.username);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || database !== 'toolstock_dev' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(username)) throw Error('ローカルのtoolstock_devだけをバックアップできます');
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const filename = `toolstock-before-cleanup-${stamp}.dump`, temporary = '/tmp/' + filename;
const destination = path.join(root, 'backups', filename);
if (path.relative(root, destination).startsWith('..')) throw Error('バックアップ先が作業フォルダーの外です');
function docker(args) {
 const result = spawnSync('docker', ['compose', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
 if (result.error || result.status !== 0) throw Error(result.error?.message ?? result.stderr ?? 'Dockerの操作に失敗しました');
 return result.stdout;
}
const target = assertBackupTarget(url, docker(['port', 'db', '5432']));
await mkdir(path.dirname(destination), { recursive: true });
docker(['exec', '-T', 'db', 'pg_dump', '--username', username, '--format=custom', '--file', temporary, database]);
const entries = docker(['exec', '-T', 'db', 'pg_restore', '--list', temporary]);
if (!entries.includes('TABLE DATA public tools') || !entries.includes('TABLE DATA public inventory_transactions')) throw Error('バックアップに必要なテーブルが含まれていません');
docker(['cp', 'db:' + temporary, destination]);
const bytes = await readFile(destination);
if (bytes.subarray(0, 5).toString() !== 'PGDMP') throw Error('バックアップ形式を確認できません');
const metadata = { ...target, created_at: new Date().toISOString(), file: filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), verified_with: 'pg_restore --list' };
await writeFile(destination + '.json', JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata, null, 2));
