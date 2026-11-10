import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertBackupTarget } from '../scripts/backup-target.mjs';

test('バックアップ先はDATABASE_URLと同じComposeのDBエンドポイントだけを許可する', () => {
 for (const host of ['localhost', '127.0.0.1']) assert.deepEqual(assertBackupTarget(new URL(`postgresql://toolstock:secret@${host}:5432/toolstock_dev`), '127.0.0.1:5432\n'), { host: '127.0.0.1', port: '5432', database: 'toolstock_dev' });
 for (const value of ['postgresql://toolstock:secret@localhost:5433/toolstock_dev', 'postgresql://toolstock:secret@localhost:5432/production', 'postgresql://toolstock:secret@remote.example:5432/toolstock_dev']) assert.throws(() => assertBackupTarget(new URL(value), '127.0.0.1:5432'));
 assert.throws(() => assertBackupTarget(new URL('postgresql://toolstock@localhost/toolstock_dev'), '0.0.0.0:5432'));
});
