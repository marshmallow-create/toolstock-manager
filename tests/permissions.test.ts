import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/lib/auth/permissions';

const operations = ['inventory:read', 'inventory:issue', 'history:own', 'history:all', 'inventory:receive', 'inventory:reverse', 'tools:create', 'tools:update', 'masters:write', 'orders:read', 'orders:approve', 'users:manage', 'data:manage'];

test('worker can view stock issue receive and read own history', () => {
 for (const permission of operations) assert.equal(can('WORKER', permission), ['inventory:read', 'inventory:issue', 'inventory:receive', 'history:own', 'tools:create', 'tools:update'].includes(permission), permission);
});

test('管理者はすべての業務操作を実行できる', () => {
 for (const permission of operations) assert.equal(can('ADMIN', permission), true, permission);
 assert.equal(can('ADMIN', 'unknown:operation'), false);assert.equal(can('ADMIN','inventory:adjust'),false);
});

test('廃止されたロールと不明なロールはすべての業務操作を拒否する', () => {
 for (const role of ['STOCK_MANAGER', 'PURCHASER', 'UNKNOWN', '']) for (const permission of operations) assert.equal(can(role, permission), false, role + ':' + permission);
});
