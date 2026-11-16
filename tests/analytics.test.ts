import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsFilters, summarizeTransactions, moneyChange, type AnalyticsRow } from '../src/lib/analytics/summary';

test('今月は日本時間の日付を使い、前月の同日まで比較する', () => {
 const f = analyticsFilters({}, new Date('2026-11-15T15:00:00Z'));
 assert.equal(f.from, '2026-11-01'); assert.equal(f.to, '2026-11-16');
 assert.equal(f.start.toISOString(), '2026-10-31T15:00:00.000Z');
 assert.equal(f.end.toISOString(), '2026-11-16T15:00:00.000Z');
 assert.equal(f.previousFrom, '2026-10-01'); assert.equal(f.previousTo, '2026-10-16');
});

test('月末と閏年の比較日を実在する日へ丸める', () => {
 assert.equal(analyticsFilters({}, new Date('2024-03-31T03:00:00Z')).previousTo, '2024-02-29');
 const year = analyticsFilters({ period: 'year' }, new Date('2024-02-29T03:00:00Z'));
 assert.equal(year.previousTo, '2023-02-28'); assert.equal(year.granularity, 'month');
 const last = analyticsFilters({ period: 'last-month' }, new Date('2026-01-16T03:00:00Z'));
 assert.equal(last.from, '2025-12-01'); assert.equal(last.to, '2025-12-31');
 assert.equal(last.previousFrom, '2025-11-01'); assert.equal(last.previousTo, '2025-11-30');
});

test('任意期間は直前同日数と比較し不正条件を拒否する', () => {
 const f = analyticsFilters({period:'custom',from:'2026-11-10',to:'2026-11-16'});
 assert.equal(f.previousFrom, '2026-11-03'); assert.equal(f.previousTo, '2026-11-09');
 for(const query of [{period:'bad'},{period:['year']},{period:'custom'}, {period:'custom',from:'2026-02-30',to:'2026-03-01'}, {period:'custom',from:'2026-11-16',to:'2026-11-10'}, {period:'custom',from:'2024-01-01',to:'2026-01-01'},{category:'bad'},{tool_id:'bad'},{sort:'bad'}]) assert.throws(()=>analyticsFilters(query));
});

const filters = () => analyticsFilters({period:'custom',from:'2026-11-01',to:'2026-11-03'});
function row(overrides: Partial<AnalyticsRow> = {}): AnalyticsRow {
 return {type:'ISSUE',quantity:-3,amount:'-1500.00',created_at:new Date('2026-11-01T03:00:00Z'),tool:{id:'a',tool_code:'A',name:'ドリル',category:'DRILL',active:false},...overrides};
}
test('保存金額と出庫数量を合算し、金額欠損・無効工具を保持する', () => {
 const s = summarizeTransactions([row(),row({amount:null,quantity:-2}),row({type:'RECEIVE',quantity:10,amount:'5000.00'}),row({created_at:new Date('2026-10-31T14:59:59Z')}),row({created_at:new Date('2026-11-03T15:00:00Z')})],filters());
 assert.equal(s.issueAmount,'1500.00'); assert.equal(s.receiveAmount,'5000.00');
 assert.equal(s.issueCount,2); assert.equal(s.issueQuantity,5); assert.equal(s.toolCount,1); assert.equal(s.missingIssue,1);
 assert.equal(s.ranking[0].quantity,5); assert.equal(s.ranking[0].active,false);
 assert.deepEqual(s.trend.map(p=>p.issueAmount),['1500.00','0.00','0.00']);
 assert.equal(s.categories[0].amount,'1500.00');
});

test('小数と巨大金額を正確に集計し金額順・数量順で順位を切り替える', () => {
 const rows=[row({amount:'-9999999999999999999999.99',quantity:-1}),row({amount:'-0.01',quantity:-1}),row({tool:{id:'b',tool_code:'B',name:'タップ',category:'TAP',active:true},amount:'-20.00',quantity:-100})];
 const s=summarizeTransactions(rows,filters());
 assert.equal(s.issueAmount,'10000000000000000000020.00'); assert.equal(s.ranking[0].id,'a');
 assert.equal(summarizeTransactions(rows,{...filters(),sort:'quantity'}).ranking[0].id,'b');
});

test('比較元0円では率を出さず、通常比較では増減率を返す', () => {
 assert.deepEqual(moneyChange('100.00','0.00'),{difference:'100.00',percent:null});
 assert.deepEqual(moneyChange('150.00','100.00'),{difference:'50.00',percent:'50.0'});
 assert.deepEqual(moneyChange('50.00','100.00'),{difference:'-50.00',percent:'-50.0'});
 const s=summarizeTransactions([],filters()); assert.equal(s.issueCount,0); assert.equal(s.ranking.length,0);
});

test('未登録金額と実際の0円を区別しカテゴリー・工具で絞り込む', () => {
 const missing=row({amount:null}),zero=row({tool:{id:'b',tool_code:'B',name:'タップ',category:'TAP',active:true},amount:'0.00'});
 const s=summarizeTransactions([missing,zero],filters());
 assert.equal(s.ranking.find(t=>t.id==='a')!.known,0); assert.equal(s.ranking.find(t=>t.id==='b')!.known,1);
 assert.equal(s.categories.find(c=>c.category==='DRILL')!.share,null);
 assert.equal(summarizeTransactions([missing,zero],{...filters(),category:'TAP'}).issueCount,1);
 assert.equal(summarizeTransactions([missing,zero],{...filters(),toolId:'a'}).missingIssue,1);
 const yearly=summarizeTransactions([row()],analyticsFilters({period:'year'},new Date('2026-11-16T03:00:00Z')));
 assert.equal(yearly.trend.length,11); assert.equal(yearly.trend[10].issueAmount,'1500.00');
});
