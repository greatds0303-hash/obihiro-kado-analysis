import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparisonDate,compareRows,mergeRows,rangeTrendRows,rateCategory} from '../public/analysis.js';
test('東京時間でも日付をずらさず前日・前週・4週前',()=>{
 assert.equal(comparisonDate('2026-10-06','1'),'2026-10-05');assert.equal(comparisonDate('2026-10-06','7'),'2026-09-29');assert.equal(comparisonDate('2026-10-06','28'),'2026-09-08');
});
test('前月同日・閏年・存在しない日は比較なし',()=>{
 assert.equal(comparisonDate('2026-10-06','month'),'2026-09-06');assert.equal(comparisonDate('2026-03-31','month'),null);
 assert.equal(comparisonDate('2024-03-29','month'),'2024-02-29');assert.equal(comparisonDate('2026-01-06','month'),'2025-12-06');
});
test('客数差と率ポイント差を区別・欠落をゼロにしない',()=>{
 assert.deepEqual(compareRows({customers:129,util:25,share:21},{customers:100,util:20,share:null}),{customers:29,util:5,share:null});
 assert.deepEqual(compareRows(null,{customers:1,util:1,share:1}),{customers:null,util:null,share:null});
});
test('API反映はローカル独自履歴を保ち、同一報告は置換',()=>{
 const a={date:'2026-10-06',time:11,store:'イーグル スクエア帯広店',customers:100};
 const b={...a,customers:129};const historic={...a,date:'2026-10-01'};
 assert.deepEqual(mergeRows([a,historic],[b],'summaries'),[b,historic]);
});
test('機種・種別の店舗シェアは同日時の報告店舗で計算し欠測をゼロにしない',async()=>{
 const {trendRows}=await import('../public/analysis.js');
 const rows=[{date:'2026-10-06',time:11,store:'A',group:'ジャグラー',customers:6,machines:30,util:20},{date:'2026-10-06',time:11,store:'B',group:'ジャグラー',customers:18,machines:60,util:30},{date:'2026-10-07',time:11,store:'A',group:'ジャグラー',customers:0,machines:30,util:0}];
 const result=trendRows({specials:rows}, {group:'ジャグラー',time:11});
 assert.equal(result[0].share,25);assert.equal(result[1].share,75);assert.equal(result[2].share,null);
});
test('シェア欠測店舗がある日時では全店舗を同じ母数で算出する',async()=>{
 const {trendRows}=await import('../public/analysis.js');
 const result=trendRows({summaries:[{date:'2026-10-06',time:11,store:'A',customers:25,share:10},{date:'2026-10-06',time:11,store:'B',customers:75,share:null}]});
 assert.deepEqual(result.map(r=>r.share),[25,75]);
});
test('全店舗に記載シェアがあっても客数から毎回計算する',async()=>{
 const {trendRows}=await import('../public/analysis.js');
 const rows=trendRows({summaries:[{date:'2026-10-06',time:11,store:'A',customers:25,share:99},{date:'2026-10-06',time:11,store:'B',customers:75,share:1}]});
 assert.deepEqual(rows.map(r=>r.share),[25,75]);assert.ok(rows.every(r=>r.shareSource==='calculated'));
});
test('5・5.6・5.61・6.25スロを同じ5スロカテゴリーで集計する',async()=>{
 const {trendRows,rateCategory}=await import('../public/analysis.js');
 for(const rate of ['5円S','5.6円S','5.61円S','6.25円S','6.25S'])assert.equal(rateCategory(rate),'5スロ');
 const rows=trendRows({records:[{date:'2026-10-06',time:11,store:'A',rate:'6.25円S',customers:20,machines:100},{date:'2026-10-06',time:11,store:'B',rate:'5.61円S',customers:60,machines:200}]},{rate:'5スロ'});
 assert.deepEqual(rows.map(r=>r.share),[25,75]);
});
test('1〜1.25円Pを1パチに集約する',async()=>{
 const {rateCategory}=await import('../public/analysis.js');
 for(const rate of ['1円P','1.1円P','1.12円P','1.25P'])assert.equal(rateCategory(rate),'1パチ');assert.equal(rateCategory('0.25円P'),'0.56P');
});
test('11・15・19時の平均と欠測を区別する',async()=>{
 const {averageTrendRows}=await import('../public/analysis.js');
 const summaries=[11,15,19].flatMap((time,i)=>[{date:'2026-10-06',time,store:'A',customers:[30,60,90][i],util:[10,20,30][i]},{date:'2026-10-06',time,store:'B',customers:[90,60,30][i],util:30}]);
 summaries.push({date:'2026-10-06',time:11,store:'C',customers:0,util:0});
 const rows=averageTrendRows({summaries});const a=rows.find(r=>r.store==='A'),c=rows.find(r=>r.store==='C');
 assert.equal(a.customers,60);assert.equal(a.util,20);assert.equal(a.share,50);assert.equal(a.complete,true);
 assert.equal(c.customers,null);assert.equal(c.share,null);assert.equal(c.complete,false);assert.deepEqual(c.hours,[11]);
});
test('2.5円Pと4・4.21円Pを4パチに集約する',async()=>{
 const {rateCategory}=await import('../public/analysis.js');
 for(const rate of ['2.5円P','4円P','4.21P'])assert.equal(rateCategory(rate),'4パチ');
});
test('市場概要は同じ報告店舗の前週比較と帯広店の順位を示す',async()=>{
 const {marketSnapshot}=await import('../public/analysis.js');
 const current=[{store:'A',customers:30,share:30},{store:'B',customers:70,share:70}],previous=[{store:'A',customers:20,share:20},{store:'B',customers:80,share:80}];
 const snapshot=marketSnapshot(current,previous,'A');
 assert.equal(snapshot.total,100);assert.equal(snapshot.totalDelta,0);assert.equal(snapshot.ownCustomerDelta,10);assert.equal(snapshot.ownShareDelta,10);assert.equal(snapshot.rank,2);assert.equal(snapshot.leader.store,'B');
 assert.equal(marketSnapshot(current,previous.slice(0,1),'A').totalDelta,null);assert.equal(marketSnapshot(current,previous.slice(0,1),'A').ownShareDelta,null);
});
test('週は月曜始まり、月は暦月で客数平均と客数合計からシェアを計算',async()=>{
 const {periodTrendRows}=await import('../public/analysis.js');
 const rows=[{date:'2026-10-05',store:'A',time:11,customers:10,share:99},{date:'2026-10-06',store:'A',time:11,customers:30,share:99},{date:'2026-10-05',store:'B',time:11,customers:90,share:1},{date:'2026-10-06',store:'B',time:11,customers:70,share:1}];
 const week=periodTrendRows(rows,'week');assert.equal(week[0].date,'2026-10-05');assert.equal(week[0].customers,20);assert.equal(week[0].share,20);assert.equal(week[0].days,2);assert.equal(week[0].marketTotal,100);
 assert.equal(periodTrendRows(rows,'month')[0].date,'2026-10-01');
 const missing=periodTrendRows(rows.slice(0,3),'week');assert.equal(missing.find(r=>r.store==='B').customers,90);assert.equal(missing[0].marketTotal,65);
});
test('完全な暦月は日数が違っても平均を比較し、自店の欠測比較は抑止する',async()=>{
 const {marketSnapshot}=await import('../public/analysis.js');
 const current=[{date:'2026-10-01',period:'month',periodEnd:'2026-10-31',store:'A',customers:20,share:100,coverageDates:Array.from({length:31},(_,i)=>`2026-10-${String(i+1).padStart(2,'0')}`)}];
 const previous=[{date:'2026-09-01',period:'month',periodEnd:'2026-09-30',store:'A',customers:10,share:100,coverageDates:Array.from({length:30},(_,i)=>`2026-09-${String(i+1).padStart(2,'0')}`)}];
 assert.equal(marketSnapshot(current,previous,'A').totalDelta,10);
 assert.equal(marketSnapshot([{store:'A',customers:20,share:100,hours:[11,15,19]}],[{store:'A',customers:10,share:100,hours:[11]}],'A').ownCustomerDelta,null);
});
test('平均の未取得店舗だけなら市場全体も未取得でありゼロではない',async()=>{
 const {marketSnapshot}=await import('../public/analysis.js');assert.equal(marketSnapshot([{store:'A',customers:null,share:null,complete:false}],[],'A').total,null);
});
test('0.25Pと0.56Pは0.56P、11.24Sは20Sに集約する',async()=>{
 const {rateCategory}=await import('../public/analysis.js');
 for(const rate of ['0.25P','0.25円P','0.56円P'])assert.equal(rateCategory(rate),'0.56P');assert.equal(rateCategory('11.24S'),'20S');
});
test('比較日を自由に指定し空欄・不正日付は比較なし',()=>{
 assert.equal(comparisonDate('2026-10-06','custom','2026-09-01'),'2026-09-01');assert.equal(comparisonDate('2026-10-06','custom','2026-02-30'),null);assert.equal(comparisonDate('2026-10-06','custom',''),null);
});

test('指定期間の平均は取得日のみを集計しシェアを客数から算出する',()=>{
 const rows=[{date:'2026-10-01',time:11,store:'A',customers:10,util:10},{date:'2026-10-03',time:11,store:'A',customers:30,util:30},{date:'2026-10-01',time:11,store:'B',customers:60,util:60}];
 const result=rangeTrendRows(rows,'2026-10-01','2026-10-04');assert.equal(result[0].customers,20);assert.equal(result[0].days,2);assert.equal(result[0].share,40);assert.equal(result[0].marketTotal,50);assert.equal(result[1].customers,60);
 assert.deepEqual(rangeTrendRows(rows,'2026-10-04','2026-10-01'),[]);assert.deepEqual(rangeTrendRows(rows,'2026-02-30','2026-10-01'),[]);
});

test('11.25Sと21.73Sと21.74Sも20Sへ分類する',()=>{
 for(const rate of ['11.24S','11.25円S','12.5S','20S','21.73円S','21.74S'])assert.equal(rateCategory(rate),'20S');
});
