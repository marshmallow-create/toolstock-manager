import { auth, mutate, requestToken } from '@/lib/auth/server';
import { getDb } from '@/lib/db';
import { cancelOrder } from '@/lib/orders/write';

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params;
 return mutate(request,'/orders','/orders',async body=>{
  const order=await cancelOrder(getDb(),auth(),requestToken(request),id,body);
  return {body:{order},redirectTo:'/tools/'+order.tool_id+'?saved=1'};
 });
}
