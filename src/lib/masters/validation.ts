import { AuthError } from '../auth/service';
export type Input = Record<string, unknown>;
export type Kind = 'locations';
export const codeFields = { locations: 'location_code' } as const;
export function kind(value: string): Kind {
 if (value === 'machines' || value === 'suppliers') throw new AuthError(404, '対象が見つかりません');
 if (!Object.hasOwn(codeFields, value)) throw new AuthError(400, 'マスタの種類が不正です');
 return value as Kind;
}
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
 return { name: text(input.name, '品目名', 100), category: text(creating ? input.category ?? '未分類' : input.category, '分類', 64), manufacturer: text(input.manufacturer, 'メーカー', 100, true), model: text(input.model, '型番', 100, true), unit: text(creating ? input.unit ?? '個' : input.unit, '単位', 16), active: creating && input.active === undefined ? true : boolean(input.active),
  ...(creating || input.department !== undefined ? { department: text(input.department, '部門', 100, true) } : {}),
  ...(creating || input.shelf_code !== undefined ? { shelf_code: text(input.shelf_code, '棚番', Math.max(100, existingShelf.length), true) } : {}),
  ...(input.unit_price !== undefined ? { unit_price: price(input.unit_price) } : {}),
 };
}
export function price(value: unknown) {
 if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) throw new AuthError(400, '単価は整数部12桁、小数部2桁以内の0以上の金額です');
 return value;
}
export function policyData(input: Input, creating: boolean) {
 const fields = ['safety_stock', 'reorder_point', 'target_stock'] as const;
 const empty = creating && fields.every(key => input[key] === undefined);
 const lineOnly = creating && input.reorder_point !== undefined && input.safety_stock === undefined && input.target_stock === undefined;
 const values = lineOnly ? { safety_stock: 0, reorder_point: input.reorder_point, target_stock: input.reorder_point } : input;
 const [safety_stock, reorder_point, target_stock] = fields.map(key => empty ? 0 : integer(values[key], '在庫方針'));
 if (safety_stock > reorder_point || reorder_point > target_stock) throw new AuthError(400, '安全在庫≦発注点≦目標在庫で設定してください');
 return { safety_stock, reorder_point, target_stock };
}
export function masterData(input: Input, creating: boolean) {
 return { name: text(input.name, '名称', 100), active: creating && input.active === undefined ? true : boolean(input.active) };
}
