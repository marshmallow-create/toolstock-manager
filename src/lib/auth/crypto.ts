import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
const params = { N:32768, r:8, p:1, maxmem:64*1024*1024 };
function derive(password:string,salt:string):Promise<Buffer> {
 return new Promise((resolve,reject)=>scrypt(password,salt,64,params,(error,key)=>error?reject(error):resolve(key)));
}
export async function hashPassword(password:string) {
 if(typeof password!=='string'||password.length<12||password.length>128) throw new Error('パスワードは12〜128文字で設定してください');
 const salt=randomBytes(16).toString('hex');
 return 'scrypt$'+salt+'$'+(await derive(password,salt)).toString('hex');
}
export async function verifyPassword(password:string,stored:string|null) {
 if(typeof password!=='string'||password.length>128) return false;
 const match=stored?.match(/^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/);
 const salt=match?.[1]??'0'.repeat(32), expected=Buffer.from(match?.[2]??'0'.repeat(128),'hex');
 const actual=await derive(password,salt);
 return timingSafeEqual(actual,expected)&&!!match;
}
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export const createToken=()=>randomBytes(32).toString('base64url');
