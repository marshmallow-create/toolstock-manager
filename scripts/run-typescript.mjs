import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const targets = {
  'cleanup-migration': { entry: 'tests/cleanup-migration.test.ts', args: ['--test'] },
  'tool-import': { entry: 'tests/tool-import.test.ts', args: ['--test'] },
  'tool-workbook': { entry: 'tests/tool-workbook.test.ts', args: ['--test'] },
  'tool-import-http': { entry: 'tests/tool-import-http.test.ts', args: ['--test'] },
  permissions: { entry: 'tests/permissions.test.ts', args: ['--test'] },
  'roles-migration': { entry: 'tests/roles-migration.test.ts', args: ['--test'] },
  inventory: { entry: 'tests/inventory.test.ts', args: ['--test'] },
  'inventory-http': { entry: 'tests/inventory-http.test.ts', args: ['--test'] },
  seed: { entry: 'prisma/seed.ts', args: [] },
  test: { entry: 'tests/database.test.ts', args: ['--test'] },
  auth: { entry: 'tests/auth.test.ts', args: ['--test'] },
  http: { entry: 'tests/auth-http.test.ts', args: ['--test'] },
  setup: { entry: 'scripts/setup-dev-users.ts', args: [] },
  masters: { entry: 'tests/masters.test.ts', args: ['--test'] },
  'masters-http': { entry: 'tests/masters-http.test.ts', args: ['--test'] },
};
const name = process.argv[2];
if (!Object.hasOwn(targets, name)) throw new Error('Usage: node scripts/run-typescript.mjs ' + Object.keys(targets).join('|'));
const target = targets[name];
const outfile = resolve(root, '.cache/typescript', `${name}.mjs`);
await build({
  absWorkingDir: root, entryPoints: [target.entry], outfile,
  bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22',
});
const result = spawnSync(process.execPath, [...target.args, outfile], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
