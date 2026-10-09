import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparisonDate,compareRows,mergeRows} from '../public/analysis.js';
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
