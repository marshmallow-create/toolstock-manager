export const roleLabels = { WORKER:'作業者', STOCK_MANAGER:'在庫管理者', PURCHASER:'購買担当', ADMIN:'管理者' } as const;
export type Role = keyof typeof roleLabels;
export const permissions: Record<string, readonly Role[]> = {
 'inventory:read':['WORKER','STOCK_MANAGER','PURCHASER','ADMIN'],
 'inventory:issue':['WORKER','STOCK_MANAGER','ADMIN'],
 'history:own':['WORKER','STOCK_MANAGER','PURCHASER','ADMIN'],
 'history:all':['STOCK_MANAGER','PURCHASER','ADMIN'],
 'inventory:receive':['STOCK_MANAGER','ADMIN'],
 'inventory:adjust':['STOCK_MANAGER','ADMIN'],
 'masters:write':['STOCK_MANAGER','ADMIN'],
 'orders:read':['STOCK_MANAGER','PURCHASER','ADMIN'],
 'orders:approve':['PURCHASER','ADMIN'],
 'users:manage':['ADMIN'],
};
export const permissionLabels:Record<string,string> = {
 'inventory:read':'在庫参照','inventory:issue':'手動出庫','history:own':'本人の履歴参照',
 'history:all':'全員の履歴参照','inventory:receive':'入庫','inventory:adjust':'棚卸調整',
 'masters:write':'マスタ編集','orders:read':'発注候補確認','orders:approve':'発注承認・発注書出力','users:manage':'ユーザー・権限管理',
};
export function can(role:string, permission:string) { return permissions[permission]?.includes(role as Role) ?? false; }
