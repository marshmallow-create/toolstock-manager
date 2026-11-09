import ExcelJS from 'exceljs';
import { fromBuffer, type Entry } from 'yauzl';
import { SaxesParser } from 'saxes';
import { AuthError } from '../auth/service';
import { toolCategories, toolDepartments } from '../tool-options';
import { MAX_IMPORT_ROWS, type ImportRow } from './tool-import';

export const MAX_WORKBOOK_BYTES = 2 * 1024 * 1024;
export const IMPORT_HEADERS = ['品目コード', '品目名', 'カテゴリー', '在庫', '発注ライン', '発注数', '単価', '部門', '棚番'];
export const IMPORT_FIELDS = ['tool_code', 'name', 'category', 'on_hand', 'reorder_point', 'order_quantity', 'unit_price', 'department', 'shelf_code'];

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
    const ref=tag.attributes.r,cell=typeof ref==='string'?ref.match(/^([A-I])([1-9]\d*)$/):null;
    if(++cells>(MAX_IMPORT_ROWS+1)*9 || !cell || Number(cell[2])>MAX_IMPORT_ROWS+1)throw new AuthError(400,'テンプレートの9列・200行を超えるセルがあります。');
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

export async function createToolTemplate() {
 const book=new ExcelJS.Workbook(), sheet=book.addWorksheet('工具登録');
 sheet.addRow(IMPORT_HEADERS); sheet.views=[{state:'frozen',ySplit:1}];
 sheet.columns=IMPORT_HEADERS.map((_,index)=>({width:index===1?30:18}));
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
 sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF285957'}};
 for(let row=2;row<=MAX_IMPORT_ROWS+1;row++){
  for(const column of ['A','B','C','H','I'])sheet.getCell(column+row).numFmt='@';
  sheet.getCell('C'+row).dataValidation={type:'list',allowBlank:false,formulae:['"'+toolCategories.map(option=>option.label).join(',')+'"'],showErrorMessage:true,errorStyle:'stop',error:'カテゴリーは候補から選択してください。'};
  sheet.getCell('H'+row).dataValidation={type:'list',allowBlank:true,formulae:['"'+toolDepartments.join(',')+'"'],showErrorMessage:true,errorStyle:'stop',error:'部門は候補から選択してください。'};
  for(const column of ['D','E','F'])sheet.getCell(column+row).dataValidation={type:'whole',operator:'between',allowBlank:true,formulae:[0,2147483647],showErrorMessage:true,errorStyle:'stop',error:'0以上の整数を入力してください。'};
  sheet.getCell('G'+row).numFmt='0.00';
 }
 const instructions=book.addWorksheet('入力方法');instructions.getColumn(1).width=105;
 for(const line of ['工具登録シートの2行目から入力してください。最大200件です。', '列の追加・削除・見出しの変更・セル結合・数式は使用できません。', '品目コード・品目名・カテゴリー・単価は必須です。在庫・発注ライン・発注数の空欄は0です。', 'カテゴリー：ドリル、エンドミル、タップ、リーマ、チップ', '部門：17314、17361、17362、17363。部門・棚番は空欄可。', '品目コードは半角英数字・ハイフン・アンダースコア32文字以内。先頭の0が必要な場合は文字列として入力してください。', '品目名・棚番は100文字以内。数量は0～2147483647の整数、単価は整数部12桁・小数部2桁以内。', '既存の品目コード・ファイル内の重複は登録できません。既存工具の更新には使用できません。', 'アップロードして確認した後、登録ボタンで確定します。エラーが1件でもあれば全件登録しません。'])instructions.addRow([line]);
 return Buffer.from(await book.xlsx.writeBuffer());
}

export async function parseToolWorkbook(buffer:Buffer):Promise<ImportRow[]> {
 if(buffer.length>MAX_WORKBOOK_BYTES)throw new AuthError(413,'ファイルは2MB以下にしてください。');
 await checkArchive(buffer);
 const book=new ExcelJS.Workbook();
 try{await book.xlsx.load(buffer as never,{ignoreNodes:['cols','dataValidations','conditionalFormatting','mergeCells','hyperlinks','drawing','extLst','rowBreaks','colBreaks','picture']});}
 catch{throw new AuthError(400,'Excelファイルを読み込めません。xlsx形式を確認してください。');}
 const sheet=book.getWorksheet('工具登録');
 if(!sheet)throw new AuthError(400,'「工具登録」シートがありません。テンプレートを使用してください。');
 const read=(cell:ExcelJS.Cell,row:number)=>{
  if(cell.value===null || cell.value===undefined)return '';
  if(typeof cell.value==='object')throw new AuthError(400,`${row}行目：数式や特殊な形式のセルは使用できません。値として入力してください。`);
  if(typeof cell.value==='boolean')throw new AuthError(400,`${row}行目：文字列または数値を入力してください。`);
  const value=String(cell.value).trim();
  if(value.length>1000)throw new AuthError(400,`${row}行目：セルの文字数が長すぎます。`);
  return value;
 };
 if(IMPORT_HEADERS.some((header,index)=>read(sheet.getRow(1).getCell(index+1),1)!==header))throw new AuthError(400,'列の見出しがテンプレートと一致しません。');
 const rows:ImportRow[]=[];
 sheet.eachRow((row,rowNumber)=>{
  row.eachCell((cell,column)=>{if(column>IMPORT_FIELDS.length && read(cell,rowNumber))throw new AuthError(400,`${rowNumber}行目：テンプレートにない列があります。`);});
  if(rowNumber===1)return;
  const values=Object.fromEntries(IMPORT_FIELDS.map((field,index)=>[field,read(row.getCell(index+1),rowNumber)]));
  if(Object.values(values).every(value=>value===''))return;
  rows.push({rowNumber,values});
  if(rows.length>MAX_IMPORT_ROWS)throw new AuthError(400,'一度に登録できるのは200件までです。');
 });
 if(!rows.length)throw new AuthError(400,'登録する行がありません。');
 return rows;
}
