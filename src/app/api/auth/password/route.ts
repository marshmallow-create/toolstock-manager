import {auth,mutate,requestToken} from '@/lib/auth/server';

export async function POST(request:Request){
 return mutate(request,'/login?password_changed=1','/account/password',async body=>{
  await auth().changePassword(requestToken(request),{current_password:body.current_password,password:body.password,password_confirmation:body.password_confirmation});
  return {token:null};
 });
}
