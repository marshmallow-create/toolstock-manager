export const roleLabels = { WORKER:'作業者', ADMIN:'管理者' } as const;
export type Role = keyof typeof roleLabels;
export const permissions: Record<string, readonly Role[]> = {
 'inventory:read':['WORKER','ADMIN'],
 'inventory:issue':['WORKER','ADMIN'],
 'history:own':['WORKER','ADMIN'],
 'history:all':['ADMIN'],
 'inventory:receive':['WORKER','ADMIN'],
 'inventory:reverse':['ADMIN'],
 'tools:create':['WORKER','ADMIN'],
 'tools:update':['WORKER','ADMIN'],
 'masters:write':['ADMIN'],
 'orders:read':['ADMIN'],
 'orders:approve':['ADMIN'],
 'users:manage':['ADMIN'],
 'data:manage':['ADMIN'],
};
export const permissionLabels:Record<string,string> = {
 'inventory:read':'在庫参照','inventory:receive':'入庫','history:all':'入出庫履歴',
 'inventory:issue':'出庫','inventory:reverse':'入出庫の取消',
 'tools:create':'工具登録','tools:update':'工具情報変更','masters:write':'マスタ編集','orders:read':'発注候補確認','orders:approve':'発注承認・発注書出力','users:manage':'ユーザー・権限管理','data:manage':'データ管理',
};
export function can(role:string, permission:string) { return permissions[permission]?.includes(role as Role) ?? false; }
