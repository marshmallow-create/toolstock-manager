import { auth,mutate,requestToken } from '@/lib/auth/server';
import type { Role } from '@/lib/auth/permissions';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;
 return mutate(request,'/admin/users?saved=1','/admin/users',async body=>({body:{user:await auth().updateUser(requestToken(request),id,{name:body.name as string,role:body.role as Role,active:(body.active==='true'?true:body.active==='false'?false:body.active) as boolean,password:body.password as string|undefined})}}));
}
