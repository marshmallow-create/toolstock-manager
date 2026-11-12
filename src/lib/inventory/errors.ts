import { AuthError } from '../auth/service';
export function translateError(error:unknown):never {
 if(error instanceof AuthError)throw error;
 const e=error as {code?:string;meta?:{code?:string;driverAdapterError?:{cause?:{originalCode?:string}}}};
 const codes=[e?.code,e?.meta?.code,e?.meta?.driverAdapterError?.cause?.originalCode];
 if(codes.some(code=>['55P03','40P01','57014','P2028','P2034'].includes(code??'')))throw new AuthError(409,'別の操作を処理中です。在庫を再確認して同じリクエストキーで再試行してください');
 if(e?.code==='P2002')throw new AuthError(409,'この操作は登録済みです。履歴を確認してください');
 throw error;
}
