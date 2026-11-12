import { errorResponse, requestToken } from '@/lib/auth/server';
import { masters } from '@/lib/masters/server';
import { createToolExport } from '@/lib/masters/tool-workbook';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request) {
 try {
  const tools=await masters().exportTools(requestToken(request),Object.fromEntries(new URL(request.url).searchParams));
  const file=await createToolExport(tools);
  return new Response(new Uint8Array(file.buffer),{headers:{
   'Content-Type':file.contentType,
   'Content-Disposition':`attachment; filename="${file.filename}"`,
   'Cache-Control':'no-store',
  }});
 } catch(error) { return errorResponse(error); }
}
