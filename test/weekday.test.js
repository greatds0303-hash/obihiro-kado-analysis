import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weekdayCustomers} from '../public/weekday.js';
test('曜日別は合計でなく平均、ゼロを保持し同率最多と欠測を区別',()=>{
 const summaries=[];for(const [date,n] of [['2026-10-05',10],['2026-10-12',30],['2026-10-06',20],['2026-10-07',0]])for(const time of [11,15,19])summaries.push({date,time,store:'A',customers:n});
 const [r]=weekdayCustomers({summaries},{time:'average'});assert.equal(r.days[0].customers,20);assert.equal(r.days[0].count,2);assert.deepEqual(r.best,[0,1]);assert.equal(r.days[2].customers,0);assert.equal(r.days[3].customers,null);
 summaries.pop();const [missing]=weekdayCustomers({summaries},{time:'average'});assert.equal(missing.days[2].customers,null);assert.equal(missing.days[2].missing,1);
});
test('曜日別は全店舗を保持し日付・時間・貸玉カテゴリーを反映',()=>{
 const records=[];for(const store of ['A','B'])for(const time of [11,15,19])for(const date of ['2026-10-05','2026-10-12'])records.push({store,date,time,rate:store==='A'?'12.5円S':'21.74円S',customers:time});
 const rows=weekdayCustomers({records},{from:'2026-10-12',to:'2026-10-12',time:15,rate:'20S'});assert.equal(rows.length,2);assert.equal(rows[0].days[0].customers,15);assert.equal(rows[0].days[0].count,1);assert.deepEqual(weekdayCustomers({summaries:[]}),[]);
});
