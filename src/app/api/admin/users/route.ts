import { auth,errorResponse,mutate,requestToken } from '@/lib/auth/server';
import type { Role } from '@/lib/auth/permissions';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{return Response.json({users:await auth().listUsers(requestToken(request))},{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}
}
export async function POST(request:Request){
 return mutate(request,'/admin/users?saved=1','/admin/users',async body=>({status:201,body:{user:await auth().createUser(requestToken(request),{employee_code:body.employee_code as string,name:body.name as string,role:body.role as Role,password:body.password as string})}}));
}
