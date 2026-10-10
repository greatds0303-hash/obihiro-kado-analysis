import {test} from 'node:test';
import assert from 'node:assert/strict';
const header=['対象店舗ＩＤ','対象店舗名','調査日','種別','貸玉(円)','機種コード','機種名','設置台数','11:00(客数)','11:00(男性数)','11:00(女性数)','15:00(客数)','19:00(客数)'];
const csv=(rows)=>[header,...rows].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
const row=['1','イーグル  スクエア帯広店','2026/08/01','パチンコ','2.500','101','機種, "A"','2','0','','','1','2'];
test('調査CSVを貸玉・店舗総合・機種別に集計し実貸玉と0客数を保持する',async()=>{
 const {parseSurveyCsv}=await import('../public/csv-import.js');
 const report=parseSurveyCsv(csv([row,[...row.slice(0,5),'102','機種B','3','2','','','2','1']]));
 assert.equal(report.sourceRows,2);assert.equal(report.summaries.length,3);assert.equal(report.records.length,3);assert.equal(report.specials.length,6);
 const summary=report.summaries.find(r=>r.time===11);assert.equal(summary.customers,2);assert.equal(summary.storeTotal,5);assert.equal(summary.store,'イーグル スクエア帯広店');
 assert.equal(report.records[0].rate,'2.5円P');assert.equal(report.records[0].machines,5);assert.equal(report.records[0].util,40);assert.equal(report.records[0].male,null);
 assert.equal(report.specials[0].group,'機種, "A"');assert.equal(report.specials[0].customers,0);
});
test('CSV空欄は未取得とし部分集計の総合客数は作らず不正値や列不足は全件拒否する',async()=>{
 const {parseSurveyCsv}=await import('../public/csv-import.js');
 const missing=[...row];missing[8]='';const report=parseSurveyCsv(csv([missing]));
 assert.equal(report.summaries.length,2);assert.equal(report.records.length,2);assert.equal(report.specials.length,2);assert.equal(report.missingCounts,1);
 const malformed=[...row];malformed[5]='999';malformed[11]='abc';assert.throws(()=>parseSurveyCsv(csv([row,malformed])),/客数/);
 assert.throws(()=>parseSurveyCsv('日付,店舗\n2026-08-01,A'),/列/);
 assert.throws(()=>parseSurveyCsv(csv([[...row.slice(0,2),'2026/02/30',...row.slice(3)]])),/日付/);
 assert.throws(()=>parseSurveyCsv(csv([row,row])),/重複/);
 assert.throws(()=>parseSurveyCsv(csv([row])+'\n"unclosed'),/引用符/);
});
test('CSVはUTF-8とShift_JISに対応し機種の複数貸玉を同じ機種で合算する',async()=>{
 const {decodeSurveyCsv,parseSurveyCsv}=await import('../public/csv-import.js');
 assert.equal(decodeSurveyCsv(new TextEncoder().encode('\ufeff'+csv([row]))).encoding,'UTF-8');
 const {readFileSync}=await import('node:fs');assert.equal(decodeSurveyCsv(readFileSync(new URL('./fixtures/survey-sjis.csv',import.meta.url))).encoding,'Shift_JIS');
 const other=[...row];other[4]='1.120';const report=parseSurveyCsv(csv([row,other]));assert.equal(report.specials.length,3);assert.equal(report.specials[1].customers,2);assert.equal(report.specials[1].machines,4);
});

test('CSV再取込は同じ観測を更新し既存メールのイベントと他の履歴を残す',async()=>{
 const {mergeCsvReport,parseSurveyCsv}=await import('../public/csv-import.js');
 const report=parseSurveyCsv(csv([row])),old={...report.summaries[0],customers:99,event:'既存イベント',mailId:'old'};
 const current={summaries:[old,{...old,date:'2026-07-01'}],records:[],specials:[]};
 const merged=mergeCsvReport(current,report);assert.equal(merged.summaries.length,4);assert.equal(merged.summaries[0].customers,0);assert.equal(merged.summaries[0].event,'既存イベント');assert.equal(merged.summaries[0].mailId,'old');
 assert.deepEqual(mergeCsvReport(merged,report),merged);
});
