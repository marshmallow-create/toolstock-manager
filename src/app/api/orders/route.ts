import {auth,errorResponse,requestToken,mutate} from '@/lib/auth/server';
import {registerOrder} from '@/lib/orders/write';
import {getDb} from '@/lib/db';
import {listOrders} from '@/lib/orders/list';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{return Response.json(await listOrders(getDb(),auth(),requestToken(request),Object.fromEntries(new URL(request.url).searchParams)),{headers:{'Cache-Control':'no-store'}});}
 catch(error){return errorResponse(error);}
}
export async function POST(request:Request){
 return mutate(request,'/orders?saved=1','/orders',async body=>({body:{order:await registerOrder(getDb(),auth(),requestToken(request),body)}}));
}
