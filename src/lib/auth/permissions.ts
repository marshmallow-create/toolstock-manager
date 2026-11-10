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
 'tools:update':['ADMIN'],
 'tools:import':['ADMIN'],
 'masters:write':['ADMIN'],
 'users:manage':['ADMIN'],
};
export function can(role:string, permission:string) { return permissions[permission]?.includes(role as Role) ?? false; }
