import { auth,mutate,requestToken } from '@/lib/auth/server';
export const runtime='nodejs';
export async function POST(request:Request) {
 return mutate(request,'/login','/login',async()=>{await auth().logout(requestToken(request));return {token:null};});
}
