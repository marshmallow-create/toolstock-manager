import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createToolTemplate, parseToolWorkbook, IMPORT_HEADERS } from '../src/lib/masters/tool-workbook';

async function workbook(rows: unknown[][]) {
 const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('工具登録');
 sheet.addRow(IMPORT_HEADERS); for (const row of rows) sheet.addRow(row);
 return Buffer.from(await book.xlsx.writeBuffer());
}
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
 await assert.rejects(parseToolWorkbook(await workbook([['A1','名前','ドリル',0,0,0,1,'','', '追加']])),/列/);
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
