import {auth,errorResponse,requestToken} from '@/lib/auth/server';
import {getDb} from '@/lib/db';
import {listOrders} from '@/lib/orders/list';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{return Response.json(await listOrders(getDb(),auth(),requestToken(request),Object.fromEntries(new URL(request.url).searchParams)),{headers:{'Cache-Control':'no-store'}});}
 catch(error){return errorResponse(error);}
}
