import { auth,errorResponse,requestToken } from '@/lib/auth/server';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{return Response.json({user:await auth().authenticate(requestToken(request))},{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}
}
