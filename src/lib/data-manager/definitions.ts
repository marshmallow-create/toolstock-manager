import { toolCategories, toolDepartments } from '../tool-options';

export type Field = {
 key: string; label: string; kind?: 'text' | 'number' | 'price' | 'boolean' | 'select' | 'date' | 'json' | 'password';
 readonly?: boolean; required?: boolean; max?: number; min?: number; nullable?: boolean;
 options?: readonly { value: string; label: string }[]; reference?: 'tool' | 'user' | 'location' | 'supplier' | 'purchaseOrder' | 'machine';
};
export type Definition = { key: string; model: string; label: string; group: string; fields: Field[]; search: string[]; mode?: 'readonly' | 'correct' | 'revoke' | 'reset'; note?: string };
const ro = (key: string, label: string, reference?: Field['reference']): Field => ({ key, label, readonly: true, reference });
const txt = (key: string, label: string, max = 100, required = true): Field => ({ key, label, max, required });
const num = (key: string, label: string, min = 0): Field => ({ key, label, kind: 'number', min, required: true });
const money = (nullable = false): Field => ({ key: 'unit_price', label: '単価', kind: 'price', nullable, required: !nullable });
const active: Field = { key: 'active', label: '状態', kind: 'boolean' };
const options = (values: string[]) => values.map(value => ({ value, label: value }));
const select = (key: string, label: string, values: string[]): Field => ({ key, label, kind: 'select', options: options(values), required: true });
const dates: Field[] = [{ ...ro('created_at', '作成日時'), kind: 'date' }, { ...ro('updated_at', '更新日時'), kind: 'date' }];
export const tableDefinitions: Definition[] = [
 { key: 'tools', model: 'tool', label: '工具', group: '工具・在庫', search: ['tool_code', 'name', 'shelf_code', 'department'], fields: [ro('tool_code', '品目コード'), txt('name', '品目名'), { key: 'category', label: 'カテゴリー', kind: 'select', options: toolCategories, required: true }, money(true), { key: 'department', label: '部門', kind: 'select', options: [{ value: '', label: '未設定' }, ...options([...toolDepartments])] }, txt('shelf_code', '棚番', 1000, false), txt('manufacturer', 'メーカー', 100, false), txt('model', '型番', 100, false), txt('unit', '単位', 16), active, ...dates] },
 { key: 'stocks', model: 'stockBalance', label: '在庫残高', group: '工具・在庫', search: [], fields: [ro('tool_id', '工具', 'tool'), ro('location_id', '保管場所', 'location'), num('on_hand', '実在庫'), num('reserved', '引当'), ...dates] },
 { key: 'policies', model: 'inventoryPolicy', label: '在庫方針', group: '工具・在庫', search: [], fields: [ro('tool_id', '工具', 'tool'), num('safety_stock', '安全在庫'), num('reorder_point', '発注点'), num('target_stock', '目標在庫'), ...dates] },
 { key: 'history', model: 'inventoryTransaction', label: '入出庫履歴', group: '履歴', mode: 'correct', note: '訂正理由を入力して保存すると、元の取引を残したまま取消・訂正を記録します。取消済みの履歴と逆取引は訂正できません。', search: ['reason'], fields: [ro('tool_id', '工具', 'tool'), ro('location_id', '保管場所', 'location'), ro('type', '取引種別'), num('quantity', '増減数量', -2147483647), money(true), { key: 'correction_reason', label: '訂正理由', max: 500 }, ro('actor_user_id', '操作者', 'user'), ro('reason', '元の理由'), ro('on_hand_after', '取引直後の在庫'), ro('reverses_id', '取消元ID'), ro('reversal_id', '取消取引ID'), ...dates] },
 { key: 'users', model: 'user', label: 'ユーザー', group: 'ユーザー・認証', search: ['employee_code', 'name'], fields: [ro('employee_code', '社員ID'), txt('name', '氏名', 80), { key: 'role', label: 'ロール', kind: 'select', options: [{ value: 'WORKER', label: '作業者' }, { value: 'ADMIN', label: '管理者' }] }, active, { key: 'password', label: '新しいパスワード', kind: 'password', max: 128 }, ...dates] },
 { key: 'candidates', model: 'reorderCandidate', label: '発注候補', group: '発注', search: [], fields: [ro('tool_id', '工具', 'tool'), select('status', '状態', ['OPEN', 'CONVERTED', 'DISMISSED']), num('quantity', '発注数', 1), ...dates] },
 { key: 'orders', model: 'purchaseOrder', label: '発注', group: '発注', search: ['order_no'], fields: [ro('order_no', '発注番号'), ro('supplier_id', '仕入先', 'supplier'), select('status', '状態', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'EXPORTED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED']), ro('requested_by', '申請者', 'user'), ro('approved_by', '承認者', 'user'), { ...ro('ordered_at', '発注日時'), kind: 'date' }, ...dates] },
 { key: 'order-items', model: 'purchaseOrderItem', label: '発注明細', group: '発注', search: ['supplier_model'], fields: [ro('order_id', '発注', 'purchaseOrder'), ro('tool_id', '工具', 'tool'), num('ordered_quantity', '発注数量', 1), num('received_quantity', '入荷済数量'), money(), txt('supplier_model', '仕入先型番', 100, false), num('order_multiple', '発注単位', 1), num('lead_time_days', 'リードタイム（日）'), ...dates] },
 { key: 'locations', model: 'location', label: '保管場所', group: '参照マスタ', search: ['location_code', 'name'], fields: [ro('location_code', '保管場所コード'), txt('name', '名称'), active, ...dates] },
 { key: 'machines', model: 'machine', label: '設備', group: '参照マスタ', search: ['machine_code', 'name'], fields: [ro('machine_code', '設備コード'), txt('name', '名称'), active, ...dates] },
 { key: 'suppliers', model: 'supplier', label: '仕入先', group: '参照マスタ', search: ['supplier_code', 'name', 'email'], fields: [ro('supplier_code', '仕入先コード'), txt('name', '名称'), { ...txt('email', 'メールアドレス', 254, false), nullable: true }, active, ...dates] },
 { key: 'supplier-items', model: 'supplierItem', label: '仕入条件', group: '参照マスタ', search: ['supplier_model'], fields: [ro('tool_id', '工具', 'tool'), ro('supplier_id', '仕入先', 'supplier'), { ...txt('supplier_model', '仕入先型番', 100, false), nullable: true }, money(), num('order_multiple', '発注単位', 1), num('lead_time_days', 'リードタイム（日）'), { key: 'preferred', label: '優先仕入先', kind: 'boolean' }, ...dates] },
 { key: 'audit', model: 'auditLog', label: '監査ログ', group: '履歴', mode: 'readonly', note: '監査ログは変更前後を確認するための記録です。編集・削除はできません。', search: ['action', 'entity_type'], fields: [ro('actor_user_id', '操作者', 'user'), ro('action', '操作'), ro('entity_type', '対象テーブル'), ro('entity_id', '対象ID'), { ...ro('details', '変更内容'), kind: 'json' }, ...dates] },
 { key: 'sessions', model: 'session', label: 'ログインセッション', group: 'ユーザー・認証', mode: 'revoke', note: 'ユーザー単位で全セッションを失効できます。認証キーは表示しません。', search: [], fields: [ro('employee_code', '社員ID'), ro('name', '氏名'), ro('count', 'セッション数'), { ...ro('last_seen_at', '最終利用'), kind: 'date' }, { key: 'revoke', label: '全セッションを失効', kind: 'boolean' }] },
 { key: 'login-attempts', model: 'loginAttempt', label: 'ログイン試行', group: 'ユーザー・認証', mode: 'reset', note: '社員IDごとのログイン失敗回数を確認し、ログイン制限を解除できます。未登録IDの試行はまとめて表示します。', search: [], fields: [ro('employee_code', '社員ID'), ro('name', '氏名'), ro('attempts', '失敗回数'), { ...ro('started_at', '開始日時'), kind: 'date' }, { key: 'reset', label: '制限を解除', kind: 'boolean' }] },
];
export type Cell = string | number | boolean | null;
export type DataRow = { id: string; version: string; values: Record<string, Cell>; editable: boolean };
export type TableData = { rows: DataRow[]; total: number; page: number; pageSize: number };
export type Change = { id: string; version: string; values: Record<string, unknown> };
export const virtualFields = new Set(['password', 'correction_reason', 'reversal_id', 'revoke', 'reset']);
