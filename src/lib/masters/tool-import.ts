import type { PrismaClient, Prisma } from '../../generated/prisma/client';
import { AuthService, AuthError } from '../auth/service';
import { code, text, integer, price, categoryValue, departmentValue, type Input } from './validation';
import { conflict, createToolInTransaction } from './write';

export const MAX_IMPORT_ROWS = 200;
export type ImportRow = { rowNumber: number; values: Input };
export type ImportPreviewRow = { rowNumber: number; values: Record<string, string>; errors: string[] };
type ImportClient = Pick<Prisma.TransactionClient, 'tool'>;

async function inspectImport(db: ImportClient, rows: ImportRow[]) {
 if (!rows.length) throw new AuthError(400, '登録する行がありません。');
 if (rows.length > MAX_IMPORT_ROWS) throw new AuthError(400, '一度に登録できるのは200件までです。');
 const checks: [string, string, (value: unknown) => string | number][] = [
  ['tool_code', '品目コード', code], ['name', '品目名', value => text(value, '品目名', 100)],
  ['category', 'カテゴリー', categoryValue], ['on_hand', '在庫', value => integer(value === '' || value === undefined ? 0 : value, '在庫')],
  ['reorder_point', '発注ライン', value => integer(value === '' || value === undefined ? 0 : value, '発注ライン')],
  ['order_quantity', '発注数', value => integer(value === '' || value === undefined ? 0 : value, '発注数')],
  ['unit_price', '単価', price], ['department', '部門', departmentValue], ['shelf_code', '棚番', value => text(value, '棚番', 100, true)],
 ];
 const result: ImportPreviewRow[] = rows.map(row => {
  const values: Record<string, string> = {}, errors: string[] = [];
  for (const [field, label, validate] of checks) {
   values[field] = String(row.values[field] ?? '');
   try { values[field] = String(validate(row.values[field])); }
   catch (error) { if (!(error instanceof AuthError)) throw error; errors.push(`${label}：${error.message}`); }
  }
  return { rowNumber: row.rowNumber, values, errors };
 });
 const codes = result.map(row => row.values.tool_code);
 const existing = new Set((await db.tool.findMany({where:{tool_code:{in:codes}},select:{tool_code:true}})).map(tool=>tool.tool_code));
 const counts = new Map<string, number>(); for (const value of codes) counts.set(value,(counts.get(value) ?? 0)+1);
 for (const row of result) {
  if (existing.has(row.values.tool_code)) row.errors.push('品目コード：すでに登録されています。');
  if ((counts.get(row.values.tool_code) ?? 0) > 1) row.errors.push('品目コード：ファイル内で重複しています。');
 }
 return { rows: result, count: result.length, valid: result.every(row=>row.errors.length===0) };
}

export async function previewToolImport(db: PrismaClient, auth: AuthService, token: string | undefined, rows: ImportRow[]) {
 await auth.authenticate(token,'tools:import');
 return inspectImport(db, rows);
}
export async function commitToolImport(db: PrismaClient, auth: AuthService, token: string | undefined, rows: ImportRow[]) {
 await auth.authenticate(token,'tools:import');
 return conflict(() => auth.authorized(token,['tools:import'],async(tx,actor)=>{
  const preview = await inspectImport(tx,rows);
  if (!preview.valid) throw new AuthError(400,'登録できない行があります。内容を確認し直してください。');
  for (const row of preview.rows) await createToolInTransaction(tx,actor,row.values);
  return { count: preview.count };
 }));
}
