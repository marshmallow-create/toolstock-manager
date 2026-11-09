import { AuthError } from '../auth/service';
import { MAX_WORKBOOK_BYTES } from './tool-workbook';

export async function readImportFile(request:Request) {
 const contentType=request.headers.get('content-type') ?? '';
 if(!contentType.startsWith('multipart/form-data;'))throw new AuthError(415,'Excelファイルを選択してください。');
 const limit=MAX_WORKBOOK_BYTES+64*1024;
 if(Number(request.headers.get('content-length'))>limit)throw new AuthError(413,'ファイルは2MB以下にしてください。');
 const reader=request.body?.getReader();if(!reader)throw new AuthError(400,'Excelファイルを選択してください。');
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new AuthError(413,'ファイルは2MB以下にしてください。');}chunks.push(value);}
 let data:FormData;
 try{data=await new Response(new Uint8Array(Buffer.concat(chunks)),{headers:{'content-type':contentType}}).formData();}
 catch{throw new AuthError(400,'アップロード内容を読み込めません。ファイルを選び直してください。');}
 const file=data.get('file'), action=data.get('action');
 if(!(file instanceof File) || !file.size)throw new AuthError(400,'Excelファイルを選択してください。');
 if(!/\.xlsx$/i.test(file.name))throw new AuthError(400,'拡張子が.xlsxのExcelファイルを選択してください。');
 if(file.size>MAX_WORKBOOK_BYTES)throw new AuthError(413,'ファイルは2MB以下にしてください。');
 if(action!=='preview' && action!=='commit')throw new AuthError(400,'取込操作を確認してください。');
 return {buffer:Buffer.from(await file.arrayBuffer()),action};
}
