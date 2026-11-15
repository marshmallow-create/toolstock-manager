import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { fromBuffer, type Entry } from 'yauzl';
import { SaxesParser } from 'saxes';
import { AuthError } from '../auth/service';
import { toolCategories, toolDepartments, categoryLabel } from '../tool-options';
import { MAX_IMPORT_ROWS, type ImportRow } from './tool-import';

export const MAX_WORKBOOK_BYTES = 2 * 1024 * 1024;
export const IMPORT_HEADERS = ['品目コード', '品目名', 'カテゴリー', '在庫', '発注ライン', '発注数', '発注単価', '部門', '棚番', '入数'];
export const IMPORT_FIELDS = ['tool_code', 'name', 'category', 'on_hand', 'reorder_point', 'order_quantity', 'unit_price', 'department', 'shelf_code', 'units_per_order'];
const LEGACY_HEADERS = [...IMPORT_HEADERS.slice(0, 9), '在庫単位', '発注単位', '入数'];
const LEGACY_FIELDS = [...IMPORT_FIELDS.slice(0, 9), 'unit', 'order_unit', 'units_per_order'];
export type WorkbookMode = 'create'|'update';
type ExportTool = {tool_code:string;name:string;category:string;on_hand:number;reorder_point:number;order_quantity:number;unit_price:string|null;department:string;shelf_code:string;units_per_order?:number};

export async function createToolExport(tools:readonly ExportTool[]) {
 const template=await createToolTemplate('update');
 const workbook=async(rows:readonly ExportTool[])=>{
  const book=new ExcelJS.Workbook();await book.xlsx.load(template as never);
  const sheet=book.getWorksheet('工具変更')!;
  rows.forEach((tool,index)=>{
   const values=[tool.tool_code,tool.name,categoryLabel(tool.category),tool.on_hand,tool.reorder_point,tool.order_quantity,tool.unit_price===null?'':Number(tool.unit_price),tool.department,tool.shelf_code,tool.units_per_order??''];
   values.forEach((value,column)=>{sheet.getCell(index+2,column+1).value=value;});
  });
  const instructions=book.getWorksheet('入力方法')!;
  instructions.addRow([rows.length?'検索条件に一致する工具の現在値です。品目コードは変更せず、変更対象以外の行は削除してください。':'検索条件に該当する工具はありません。']);
  instructions.addRow(['出力後に在庫などが変わる場合があります。変更しない項目は空欄にし、アップロード後の変更前後を確認してから確定してください。']);
  return Buffer.from(await book.xlsx.writeBuffer());
 };
 if(tools.length<=MAX_IMPORT_ROWS)return {buffer:await workbook(tools),contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename:'toolstock-update.xlsx'};
 const zip=new JSZip();
 for(let offset=0;offset<tools.length;offset+=MAX_IMPORT_ROWS){
  zip.file(`toolstock-update-${String(offset/MAX_IMPORT_ROWS+1).padStart(4,'0')}.xlsx`,await workbook(tools.slice(offset,offset+MAX_IMPORT_ROWS)));
 }
 return {buffer:await zip.generateAsync({type:'nodebuffer',compression:'STORE'}),contentType:'application/zip',filename:'toolstock-update.zip'};
}

function checkXml(xml:string,worksheet:boolean) {
 const parser=new SaxesParser({xmlns:false});let rows=0,cells=0,sheets=0;
 parser.on('doctype',()=>{throw new AuthError(400,'内部定義のあるExcelファイルは使用できません。');});
 parser.on('opentag',tag=>{
  const name=tag.name.split(':').pop();
  if(!worksheet){
   if(name==='definedName')throw new AuthError(400,'名前付き範囲は使用できません。テンプレートに値を貼り付けてください。');
   if(name==='sheet'){
    const id=tag.attributes.sheetId;
    if(++sheets>64 || typeof id!=='string' || !/^\d+$/.test(id) || Number(id)<1 || Number(id)>256)throw new AuthError(400,'Excelのシート構成を確認してください。');
   }
  }else{
   if(name==='mergeCell')throw new AuthError(400,'結合されたセルは使用できません。');
   if(name==='row'){
    const row=tag.attributes.r;
    if(++rows>MAX_IMPORT_ROWS+1 || typeof row!=='string' || !/^\d+$/.test(row) || Number(row)<1 || Number(row)>MAX_IMPORT_ROWS+1)throw new AuthError(400,'入力は見出しの次の200行以内にしてください。');
   }
   if(name==='c'){
    const ref=tag.attributes.r,cell=typeof ref==='string'?ref.match(/^([A-L])([1-9]\d*)$/):null;
    if(++cells>(MAX_IMPORT_ROWS+1)*LEGACY_FIELDS.length || !cell || Number(cell[2])>MAX_IMPORT_ROWS+1)throw new AuthError(400,'テンプレートの列・200行を超えるセルがあります。');
   }
  }
 });
 parser.write(xml).close();
}

// Bound actual expanded bytes before the workbook parser reads an uploaded ZIP.
async function checkArchive(buffer: Buffer) {
 await new Promise<void>((resolve,reject)=>{
  fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
   if(error || !zip) return reject(new AuthError(400,'Excelファイルを読み込めません。xlsx形式を確認してください。'));
   let total=0, entries=0, failed=false;
   const fail=(error:unknown)=>{if(failed)return;failed=true;zip.close();reject(error instanceof AuthError?error:new AuthError(400,'Excelファイルが破損しています。'));};
   zip.on('error',fail);zip.on('end',()=>{if(!failed)resolve();});
   zip.on('entry',(entry:Entry)=>{
    if(entry.fileName.split('/').some(part=>part==='.' || part==='..'))return fail(new AuthError(400,'Excelファイルの構造を確認してください。'));
    if(++entries>256 || total+entry.uncompressedSize>8*1024*1024) return fail(new AuthError(413,'展開後のExcelファイルが大きすぎます。'));
    if(entry.generalPurposeBitFlag & 1 || /vbaProject|externalLinks/i.test(entry.fileName)) return fail(new AuthError(400,'暗号化・マクロ・外部参照のあるExcelファイルは取り込めません。'));
    if(entry.fileName.endsWith('/'))return zip.readEntry();
    zip.openReadStream(entry,(error,stream)=>{
     if(error || !stream)return fail(error);
     const chunks:Buffer[]=[];const worksheet=/xl\/worksheets\/sheet\d+\.xml/.test(entry.fileName), workbook=entry.fileName==='xl/workbook.xml';
     stream.on('error',fail);
     stream.on('data',(chunk:Buffer)=>{
      total+=chunk.length;
      if(total>8*1024*1024){stream.destroy();return fail(new AuthError(413,'展開後のExcelファイルが大きすぎます。'));}
      if(worksheet || workbook)chunks.push(chunk);
     });
     stream.on('end',()=>{
      if(failed)return;
      const xml=Buffer.concat(chunks).toString('utf8');
      try{if(worksheet || workbook)checkXml(xml,worksheet);}catch(error){return fail(error);}
      zip.readEntry();
     });
    });
   });
   zip.readEntry();
  });
 });
}

export async function createToolTemplate(mode:WorkbookMode|'common'='create') {
 const sheetName=mode==='common'?'工具登録・変更':mode==='update'?'工具変更':'工具登録';
 const book=new ExcelJS.Workbook(), sheet=book.addWorksheet(sheetName);
 sheet.addRow(IMPORT_HEADERS); sheet.views=[{state:'frozen',ySplit:1}];
 sheet.columns=IMPORT_HEADERS.map((_,index)=>({width:index===1?30:18}));
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
 sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF285957'}};
 for(let row=2;row<=MAX_IMPORT_ROWS+1;row++){
  for(const column of ['A','B','C','H','I'])sheet.getCell(column+row).numFmt='@';
  sheet.getCell('C'+row).dataValidation={type:'list',allowBlank:mode!=='create',formulae:['"'+toolCategories.map(option=>option.label).join(',')+'"'],showErrorMessage:true,errorStyle:'stop',error:'カテゴリーは候補から選択してください。'};
  sheet.getCell('H'+row).dataValidation={type:'list',allowBlank:true,formulae:['"'+toolDepartments.join(',')+'"'],showErrorMessage:true,errorStyle:'stop',error:'部門は候補から選択してください。'};
  for(const column of ['D','E','F'])sheet.getCell(column+row).dataValidation={type:'whole',operator:'between',allowBlank:true,formulae:[0,2147483647],showErrorMessage:true,errorStyle:'stop',error:'0以上の整数を入力してください。'};
  sheet.getCell('G'+row).numFmt='0';
  sheet.getCell('J'+row).dataValidation={type:'whole',operator:'between',allowBlank:true,formulae:[1,2147483647],showErrorMessage:true,errorStyle:'stop',error:'入数は1以上の整数です。'};
 }
 const instructions=book.addWorksheet('入力方法');instructions.getColumn(1).width=105;
 for(const line of [
  `${sheetName}シートの2行目から入力してください。最大200件、ファイルは2MB以下です。`,
  '列の追加・削除・見出しの変更・セル結合・数式は使用できません。',
  ...(mode==='common'?['登録・変更の共通テンプレートです。画面で「新規登録」または「一括変更」を選んでアップロードしてください。','一括変更では既存工具の品目コードが必須です。変更する項目だけ入力し、空欄は現在値を保持します。0に変更する場合は0を入力してください。','一括変更では部門・棚番を空欄に変更できません。未登録の品目コード・ファイル内の重複は変更できません。']:[]),
  mode==='update'?'既存工具と一致する品目コードが必須です。他の項目は変更する値だけを入力してください。空欄の項目は変更しません。数量・発注単価の0は変更する値として扱います。':'新規登録では品目コード・品目名・カテゴリー・発注単価は必須です。在庫・発注ライン・発注数の空欄は0です。',
  'カテゴリー：ドリル、エンドミル、タップ、リーマ、チップ',
  '発注単価と入数は金額計算に使用します。発注済みへの加算数は発注数×入数です。',
  '入数は1以上の整数、登録時の空欄は1です。旧9列・12列のファイルも使用できます。旧形式の単位名は取り込みません。',
  mode==='update'?'部門：17314、17361、17362、17363。部門・棚番の空欄は変更しません。空欄への変更はできません。':'部門：17314、17361、17362、17363。新規登録では部門・棚番は空欄可。',
  '品目コードは半角英数字・ハイフン・アンダースコア32文字以内。先頭の0が必要な場合は文字列として入力してください。',
  '品目名・棚番は100文字以内。数量は0～2147483647の整数、発注単価は整数部12桁・小数部2桁以内。',
  '発注単価の小数は表示しません。小数部2桁以内の値は入力でき、入力した小数値を保持して取り込みます。',
  mode==='update'?'既存の品目コードで工具を特定して変更します。未登録の品目コード・ファイル内の重複は変更できません。':'新規登録では既存の品目コード・ファイル内の重複は登録できません。既存工具の更新は画面で一括変更を選んでください。',
  mode==='common'?'アップロードして確認した後、登録または変更ボタンで確定します。エラーが1件でもあれば全件処理しません。':mode==='update'?'アップロードして確認した後、変更ボタンで確定します。エラーが1件でもあれば全件変更しません。':'アップロードして確認した後、登録ボタンで確定します。エラーが1件でもあれば全件登録しません。',
 ])instructions.addRow([line]);
 return Buffer.from(await book.xlsx.writeBuffer());
}

export async function parseToolWorkbook(buffer:Buffer,mode:WorkbookMode='create'):Promise<ImportRow[]> {
 if(buffer.length>MAX_WORKBOOK_BYTES)throw new AuthError(413,'ファイルは2MB以下にしてください。');
 await checkArchive(buffer);
 const book=new ExcelJS.Workbook();
 try{await book.xlsx.load(buffer as never,{ignoreNodes:['cols','dataValidations','conditionalFormatting','mergeCells','hyperlinks','drawing','extLst','rowBreaks','colBreaks','picture']});}
 catch{throw new AuthError(400,'Excelファイルを読み込めません。xlsx形式を確認してください。');}
 const sheetName=mode==='update'?'工具変更':'工具登録';
 const sheet=book.getWorksheet(sheetName)??book.getWorksheet('工具登録・変更');
 if(!sheet)throw new AuthError(400,`「${sheetName}」シートがありません。テンプレートを使用してください。`);
 const read=(cell:ExcelJS.Cell,row:number)=>{
  if(cell.value===null || cell.value===undefined)return '';
  if(typeof cell.value==='object')throw new AuthError(400,`${row}行目：数式や特殊な形式のセルは使用できません。値として入力してください。`);
  if(typeof cell.value==='boolean')throw new AuthError(400,`${row}行目：文字列または数値を入力してください。`);
  const value=String(cell.value).trim();
  if(value.length>1000)throw new AuthError(400,`${row}行目：セルの文字数が長すぎます。`);
  return value;
 };
 const legacy=read(sheet.getRow(1).getCell(10),1)===''&&read(sheet.getRow(1).getCell(11),1)===''&&read(sheet.getRow(1).getCell(12),1)==='';
 const legacyUnits=read(sheet.getRow(1).getCell(10),1)===LEGACY_HEADERS[9];
 const fields=legacy?IMPORT_FIELDS.slice(0,9):legacyUnits?LEGACY_FIELDS:IMPORT_FIELDS;
 const headers=legacy?IMPORT_HEADERS.slice(0,9):legacyUnits?LEGACY_HEADERS:IMPORT_HEADERS;
 if(headers.some((header,index)=>{
  const actual=read(sheet.getRow(1).getCell(index+1),1);
  return actual!==header&&!(index===6&&actual==='単価');
 }))throw new AuthError(400,'列の見出しがテンプレートと一致しません。');
 const rows:ImportRow[]=[];
 sheet.eachRow((row,rowNumber)=>{
  row.eachCell((cell,column)=>{if(column>fields.length && read(cell,rowNumber))throw new AuthError(400,`${rowNumber}行目：テンプレートにない列があります。`);});
  if(rowNumber===1)return;
  const values=Object.fromEntries(fields.map((field,index)=>[field,read(row.getCell(index+1),rowNumber)]).filter(([field])=>field!=='unit'&&field!=='order_unit'));
  if(Object.values(values).every(value=>value===''))return;
  rows.push({rowNumber,values});
  if(rows.length>MAX_IMPORT_ROWS)throw new AuthError(400,`一度に${mode==='update'?'変更':'登録'}できるのは200件までです。`);
 });
 if(!rows.length)throw new AuthError(400,`${mode==='update'?'変更':'登録'}する行がありません。`);
 return rows;
}
