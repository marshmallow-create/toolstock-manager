import { AuthError } from '../auth/service';
export type Input = Record<string, unknown>;
export type Kind = 'machines' | 'locations' | 'suppliers';
export const codeFields = { machines: 'machine_code', locations: 'location_code', suppliers: 'supplier_code' } as const;
export function kind(value: string): Kind {
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
export function toolData(input: Input, creating: boolean) {
 return { name: text(input.name, '工具名', 100), category: text(input.category, '分類', 64), manufacturer: text(input.manufacturer, 'メーカー', 100, true), model: text(input.model, '型番', 100, true), unit: text(input.unit, '単位', 16), active: creating && input.active === undefined ? true : boolean(input.active) };
}
export function policyData(input: Input, creating: boolean) {
 const fields = ['safety_stock', 'reorder_point', 'target_stock'] as const;
 const empty = creating && fields.every(key => input[key] === undefined);
 const [safety_stock, reorder_point, target_stock] = fields.map(key => empty ? 0 : integer(input[key], '在庫方針'));
 if (safety_stock > reorder_point || reorder_point > target_stock) throw new AuthError(400, '安全在庫≦発注点≦目標在庫で設定してください');
 return { safety_stock, reorder_point, target_stock };
}
export function masterData(input: Input, creating: boolean) {
 return { name: text(input.name, '名称', 100), active: creating && input.active === undefined ? true : boolean(input.active) };
}
export function email(value: unknown) {
 const result = text(value, 'メールアドレス', 254, true);
 if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new AuthError(400, 'メールアドレスを確認してください');
 return result || null;
}
export function conditionData(input: Input) {
 if (typeof input.unit_price !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(input.unit_price)) throw new AuthError(400, '単価は整数部12桁、小数部2桁以内の0以上の金額です');
 return { supplier_id: uuid(input.supplier_id), supplier_model: text(input.supplier_model, '発注先型番', 100, true) || null, unit_price: input.unit_price, order_multiple: integer(input.order_multiple, '発注単位', 1), lead_time_days: integer(input.lead_time_days, '納期日数'), preferred: input.preferred === undefined ? false : boolean(input.preferred) };
}
