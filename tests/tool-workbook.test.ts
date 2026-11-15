import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createToolTemplate, parseToolWorkbook, IMPORT_HEADERS } from '../src/lib/masters/tool-workbook';
import * as workbookApi from '../src/lib/masters/tool-workbook';

const exportTool = (index=0) => ({ tool_code: '000'+index, name: '=工具', category: 'DRILL', on_hand: 7, reorder_point: 3, order_quantity: 2, unit_price: '125.55', department: '17314', shelf_code: '001' });

test('発注単価の見出しで出力し、旧単価の9・10・12列Excelも取り込める',async()=>{
 const book=new ExcelJS.Workbook();await book.xlsx.load(await createToolTemplate('common') as never);
 assert.equal(book.getWorksheet('工具登録・変更')!.getCell('G1').value,'発注単価');
 for(const count of [9,10,12]){
  const legacy=new ExcelJS.Workbook(),sheet=legacy.addWorksheet('工具登録');
  const headers=['品目コード','品目名','カテゴリー','在庫','発注ライン','発注数','単価','部門','棚番'];
  sheet.addRow([...headers,...(count===10?['入数']:count===12?['在庫単位','発注単位','入数']:[])]);
  sheet.addRow(['OLD-'+count,'旧工具','ドリル',1,2,3,125.55,'17314','A-01',...(count===10?[10]:count===12?['個','箱',10]:[])]);
  const rows=await parseToolWorkbook(Buffer.from(await legacy.xlsx.writeBuffer()));
  assert.equal(rows[0].values.unit_price,'125.55');
 }
});

test('共通テンプレートは登録・変更の両モードで同じ入力行を読み込める',async()=>{
 const book=new ExcelJS.Workbook();await book.xlsx.load(await createToolTemplate('common') as never);
 const sheet=book.getWorksheet('工具登録・変更');assert.ok(sheet);
 assert.equal(sheet.getCell('C2').dataValidation.allowBlank,true);
 sheet.getRow(2).values=['COMMON','共通工具','ドリル',5,2,3,100,'17314','A-01',10];
 const buffer=Buffer.from(await book.xlsx.writeBuffer());
 const created=await parseToolWorkbook(buffer,'create'),updated=await parseToolWorkbook(buffer,'update');
 assert.deepEqual(created,updated);assert.equal(created[0].values.units_per_order,'10');
});

test('一覧Excelは変更形式で先頭0・小数単価・文字列を保持して読み戻せる',async()=>{
 assert.equal(typeof workbookApi.createToolExport,'function','Excel出力が提供される');
 const file=await workbookApi.createToolExport([exportTool()]);
 assert.match(file.filename,/\.xlsx$/);assert.match(file.contentType,/spreadsheetml/);
 const rows=await parseToolWorkbook(file.buffer,'update');
 assert.deepEqual(rows[0].values,{tool_code:'0000',name:'=工具',category:'ドリル',on_hand:'7',reorder_point:'3',order_quantity:'2',unit_price:'125.55',department:'17314',shelf_code:'001',units_per_order:''});
 const book=new ExcelJS.Workbook();await book.xlsx.load(file.buffer as never);
 assert.equal(book.getWorksheet('工具変更')!.getCell('G2').numFmt,'0');
});

test('200件まではExcelで201件以上は既存取り込み可能な200件ごとのZIPになる',async()=>{
 assert.equal(typeof workbookApi.createToolExport,'function');
 const exact=await workbookApi.createToolExport(Array.from({length:200},(_,i)=>exportTool(i)));
 assert.equal((await parseToolWorkbook(exact.buffer,'update')).length,200);
 const file=await workbookApi.createToolExport(Array.from({length:401},(_,i)=>exportTool(i)));
 assert.match(file.filename,/\.zip$/);assert.equal(file.contentType,'application/zip');
 const zip=await JSZip.loadAsync(file.buffer),names=Object.keys(zip.files).sort();
 assert.equal(names.length,3);
 const rows=await Promise.all(names.map(async name=>parseToolWorkbook(await zip.file(name)!.async('nodebuffer'),'update')));
 assert.deepEqual(rows.map(part=>part.length),[200,200,1]);
 assert.deepEqual(rows.flat().map(row=>row.values.tool_code),Array.from({length:401},(_,i)=>'000'+i));
});

test('該当なしのExcelは説明を含む空の変更テンプレートになる',async()=>{
 assert.equal(typeof workbookApi.createToolExport,'function');
 const file=await workbookApi.createToolExport([]),book=new ExcelJS.Workbook();await book.xlsx.load(file.buffer as never);
 assert.ok(book.getWorksheet('工具変更'));
 assert.match(book.getWorksheet('入力方法')!.getColumn(1).values.join('\n'),/該当する工具はありません/);
 await assert.rejects(parseToolWorkbook(file.buffer,'update'),/変更する行がありません/);
});

async function workbook(rows: unknown[][], mode: 'create'|'update' = 'create') {
 const book = new ExcelJS.Workbook(), sheet = book.addWorksheet(mode==='update'?'工具変更':'工具登録');
 sheet.addRow(IMPORT_HEADERS); for (const row of rows) sheet.addRow(row);
 return Buffer.from(await book.xlsx.writeBuffer());
}

test('登録と変更の単価は小数を表示せず入力した小数値を保持する',async()=>{
 for(const mode of ['create','update'] as const){
  const book=new ExcelJS.Workbook();await book.xlsx.load(await createToolTemplate(mode) as never);
  const sheet=book.getWorksheet(mode==='update'?'工具変更':'工具登録')!;
  assert.ok(sheet);
  assert.equal(sheet.getCell('G2').numFmt,'0');
  assert.equal(sheet.getCell('G201').numFmt,'0');
  sheet.getCell('A2').value='A1';sheet.getCell('G2').value=125.55;
  const rows=await parseToolWorkbook(Buffer.from(await book.xlsx.writeBuffer()),mode);
  assert.equal(rows[0].values.unit_price,'125.55');
 }
});

test('変更テンプレートは10列でカテゴリーの空欄と変更手順を案内する',async()=>{
 const book=new ExcelJS.Workbook();await book.xlsx.load(await createToolTemplate('update') as never);
 const sheet=book.getWorksheet('工具変更')!;
 assert.ok(sheet);assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1),IMPORT_HEADERS);
 assert.equal(sheet.getCell('C2').dataValidation.allowBlank,true);
 const instructions=book.getWorksheet('入力方法')!.getColumn(1).values.join('\n');
 assert.match(instructions,/既存.*品目コード/);assert.match(instructions,/空欄.*変更しません/);
 assert.match(instructions,/200/);assert.match(instructions,/2MB/);assert.match(instructions,/小数.*表示/);
 await assert.rejects(parseToolWorkbook(await createToolTemplate('update'),'update'),/変更する行がありません/);
});

test('変更の解析は部分入力の空欄と数量0を区別して実際の行番号を保持する',async()=>{
 const rows=await parseToolWorkbook(await workbook([['A1','','',0,'',0,'0.25','',''],[],['A2','新しい名前']],'update'),'update');
 assert.equal(rows.length,2);assert.equal(rows[1].rowNumber,4);
 assert.deepEqual(rows[0].values,{tool_code:'A1',name:'',category:'',on_hand:'0',reorder_point:'',order_quantity:'0',unit_price:'0.25',department:'',shelf_code:'',units_per_order:''});
 assert.equal(rows[1].values.name,'新しい名前');assert.equal(rows[1].values.unit_price,'');
});

test('登録と変更で別モードのシートは受け付けない',async()=>{
 await assert.rejects(parseToolWorkbook(await workbook([['A1']]),'update'),/「工具変更」シートがありません/);
 await assert.rejects(parseToolWorkbook(await workbook([['A1']],'update')),/「工具登録」シートがありません/);
});
test('テンプレートは正しい列・候補・説明を含むxlsxで空なら登録しない',async()=>{
 const buffer=await createToolTemplate(), book=new ExcelJS.Workbook(); await book.xlsx.load(buffer as never);
 const values=book.worksheets[0].getRow(1).values; assert.ok(Array.isArray(values)); assert.deepEqual(values.slice(1),IMPORT_HEADERS);
 assert.equal(book.worksheets[0].getCell('C2').dataValidation.type,'list');
 assert.ok(book.worksheets[0].getCell('H2').dataValidation.formulae?.[0].includes('17314'));
 assert.ok(book.getWorksheet('入力方法'));
 await assert.rejects(parseToolWorkbook(buffer), /登録する行がありません/);
});
test('数値・日本語・空行・実際の行番号を保持して解析する',async()=>{
 const buffer=await workbook([['A1','ドリル','ドリル',7,3,4,125.5,17314,'A-01'],[],['A2','タップ','タップ',0,0,0,'0.00','','']]);
 const rows=await parseToolWorkbook(buffer);
 assert.equal(rows.length,2);assert.equal(rows[1].rowNumber,4);
 assert.equal(rows[0].values.department,'17314');assert.equal(rows[0].values.unit_price,'125.5');
});
test('ヘッダー違い・数式・列追加・201件・不正xlsx・サイズ超過を拒否する',async()=>{
 const book=new ExcelJS.Workbook(), sheet=book.addWorksheet('工具登録');
 sheet.addRow(['違う見出し']);sheet.addRow(['A1']);
 await assert.rejects(parseToolWorkbook(Buffer.from(await book.xlsx.writeBuffer())),/見出し/);
 await assert.rejects(parseToolWorkbook(await workbook([['A1','名前','ドリル',{formula:'1+1',result:2}]])),/数式/);
 await assert.rejects(parseToolWorkbook(await workbook([['A1','名前','ドリル',0,0,0,1,'','','','','', '追加']])),/列/);
 await assert.rejects(parseToolWorkbook(await workbook(Array.from({length:201},(_,i)=>['A'+i,'名前','ドリル']))),/200/);
 await assert.rejects(parseToolWorkbook(Buffer.from('invalid')),/Excel/);
 await assert.rejects(parseToolWorkbook(Buffer.alloc(2*1024*1024+1)),/2MB/);
});

test('小さく圧縮された巨大なXMLと結合セルを展開前検査で拒否する',async()=>{
 await assert.rejects(parseToolWorkbook(await workbook([['A1','x'.repeat(9*1024*1024),'ドリル']])),/大きすぎ/);
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('工具登録');sheet.addRow(IMPORT_HEADERS);sheet.addRow(['A1']);sheet.mergeCells('A2:B2');
 await assert.rejects(parseToolWorkbook(Buffer.from(await book.xlsx.writeBuffer())),/結合/);
});

test('巨大な行・列・名前付き範囲でパーサーを膨張させない',async()=>{
 const buffer=await workbook([['A1','名前','ドリル',0,0,0,1]]);
 const change=async(entry:string,edit:(xml:string)=>string)=>{
  const zip=await JSZip.loadAsync(buffer);zip.file(entry,edit(await zip.file(entry)!.async('string')));return zip.generateAsync({type:'nodebuffer'});
 };
 await assert.rejects(parseToolWorkbook(await change('xl/worksheets/sheet1.xml',xml=>xml.replace('r="2"','r="1000000000"'))),/200行/);
 await assert.rejects(parseToolWorkbook(await change('xl/worksheets/sheet1.xml',xml=>xml.replace('r="A2"','r="XFD1048576"'))),/セル/);
 await assert.rejects(parseToolWorkbook(await change('xl/workbook.xml',xml=>xml.replace('</workbook>','<definedNames><definedName name="huge">工具登録!$A$1:$XFD$1048576</definedName></definedNames></workbook>'))),/名前付き/);
 const cols=await change('xl/worksheets/sheet1.xml',xml=>xml.replace('<sheetData>','<cols><col min="1" max="1000000000" width="20"/></cols><sheetData>'));
 assert.equal((await parseToolWorkbook(cols)).length,1);
 await assert.rejects(parseToolWorkbook(await change('xl/worksheets/sheet1.xml',xml=>xml.replace('r="2"','xmlns:x="urn:x" x:r="2" r="1000000000"'))),/200行/);
 await assert.rejects(parseToolWorkbook(await change('xl/worksheets/sheet1.xml',xml=>xml.replace('r="2"',`decoy=" r='2'" r="1000000000"`))),/200行/);
 await assert.rejects(parseToolWorkbook(await change('xl/workbook.xml',xml=>xml.replace('sheetId="1"','sheetId="1000000000"'))),/シート構成/);
 const nested=await JSZip.loadAsync(buffer);
 nested.file('xl/evil/xl/worksheets/sheet1.xml',(await nested.file('xl/worksheets/sheet1.xml')!.async('string')).replace('r="2"','r="1000000000"'));
 await assert.rejects(parseToolWorkbook(await nested.generateAsync({type:'nodebuffer'})),/200行/);
});

test('単位名を出力せず入数をExcelで往復し旧9列・12列も読み込める',async()=>{
 const result=await workbookApi.createToolExport([{...exportTool(),units_per_order:10}]);
 const row=(await parseToolWorkbook(result.buffer,'update'))[0];
 assert.ok(!('unit' in row.values));assert.ok(!('order_unit' in row.values));assert.equal(row.values.units_per_order,'10');
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('工具変更');
 sheet.addRow(IMPORT_HEADERS.slice(0,9));sheet.addRow(['0000','','','','','','6000']);
 const legacy=(await parseToolWorkbook(Buffer.from(await book.xlsx.writeBuffer()),'update'))[0];
 assert.equal(legacy.values.unit_price,'6000');assert.equal(legacy.values.units_per_order,undefined);
 const oldBook=new ExcelJS.Workbook(),oldSheet=oldBook.addWorksheet('工具変更');
 oldSheet.addRow([...IMPORT_HEADERS.slice(0,9),'在庫単位','発注単位','入数']);
 oldSheet.addRow(['0000','','','','','','6000','','','個','箱',10]);
 const old=(await parseToolWorkbook(Buffer.from(await oldBook.xlsx.writeBuffer()),'update'))[0];
 assert.equal(old.values.units_per_order,'10');assert.ok(!('unit' in old.values));assert.ok(!('order_unit' in old.values));
});
