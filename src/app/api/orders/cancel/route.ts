import {auth,mutate,requestToken} from '@/lib/auth/server';
import {getDb} from '@/lib/db';
import {cancelOrderListEntry} from '@/lib/orders/write';

export async function POST(request:Request){
 return mutate(request,'/orders?saved=1','/orders',async body=>({body:{entry:await cancelOrderListEntry(getDb(),auth(),requestToken(request),body)}}));
}
