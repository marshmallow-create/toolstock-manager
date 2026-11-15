import { AuthError } from '../auth/service';
import { categoryCode, toolDepartments } from '../tool-options';
export type Input = Record<string, unknown>;
export function text(value: unknown, label: string, max: number, optional = false) {
 if (optional && (value === undefined || value === null)) return '';
 if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) throw new AuthError(400, label + 'を確認してください');
 return value.trim();
}
export function uuid(value: unknown) {
 if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new AuthError(400, 'IDが不正です');
 return value.toLowerCase();
}
export function integer(value: unknown, label: string, min = 0, max = 2147483647) {
 if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new AuthError(400, label + 'は範囲内の整数で入力してください');
 return value;
}
export function boolean(value: unknown) {
 if (value === 'true') return true;
 if (value === 'false') return false;
 if (typeof value !== 'boolean') throw new AuthError(400, '有効状態・優先設定を選択してください');
 return value;
}
export function code(value: unknown) {
 const result = text(value, 'コード', 32).toUpperCase();
 if (!/^[A-Z0-9_-]{1,32}$/.test(result)) throw new AuthError(400, 'コードは半角英数字・ハイフン・アンダースコア32文字以内です');
 return result;
}
export function unchangedCode(input: Input, field: string, before: string) {
 if (input[field] !== undefined && code(input[field]) !== before) throw new AuthError(400, '登録済みコードは変更できません');
}
export function toolData(input: Input, creating: boolean, existingShelf = '') {
 return { name: text(input.name, '品目名', 100), category: categoryValue(input.category), active: creating && input.active === undefined ? true : boolean(input.active),
  ...(creating || input.units_per_order !== undefined ? {units_per_order:integer(input.units_per_order ?? 1,'入数',1)} : {}),
  ...(creating || input.department !== undefined ? { department: departmentValue(input.department) } : {}),
  ...(creating || input.shelf_code !== undefined ? { shelf_code: text(input.shelf_code, '棚番', Math.max(100, existingShelf.length), true) } : {}),
  ...(input.unit_price !== undefined ? { unit_price: price(input.unit_price) } : {}),
 };
}
export function categoryValue(value: unknown, optional = false) {
 if (optional && (value === undefined || value === '')) return '';
 const category = categoryCode(value);
 if (!category) throw new AuthError(400, 'カテゴリーはドリル・エンドミル・タップ・リーマ・チップから選択してください');
 return category;
}
export function departmentValue(value: unknown) {
 const department = text(value, '部門', 100, true);
 if (department && !toolDepartments.some(option => option === department)) throw new AuthError(400, '部門は17314・17361・17362・17363から選択してください');
 return department;
}
export function price(value: unknown) {
 if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) throw new AuthError(400, '発注単価は整数部12桁、小数部2桁以内の0以上の金額です');
 return value;
}
export function policyData(input: Input, creating: boolean) {
 return { reorder_point: integer(creating ? input.reorder_point ?? 0 : input.reorder_point, '発注ライン') };
}
