import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openRepository} from '../src/db.js';
import {createSyncService} from '../src/sync.js';
import {loadConfig} from '../src/config.js';
import {startScheduler,SCHEDULE} from '../src/scheduler.js';
const text=readFileSync(new URL('./fixtures/report.txt',import.meta.url),'utf8');
const message=(uid,day='06')=>({uid,messageId:`<${day}>`,subject:'稼働報告',sender:'square_obihiro@eaglegroup.co.jp',text:text.replaceAll('2026/10/06',`2026/10/${day}`),receivedAt:'2026-10-06T02:00:00Z'});
const source=messages=>({scope:'account/INBOX',async fetch(){return {messages,uidValidity:'1'};}});
test('1通・複数・重複・対象外・未着と状態',async()=>{
 const r=openRepository(':memory:');try{
 const s=createSyncService(r,source([message(1),message(2,'07'),{...message(3),subject:'other',text:'other'}]));
 assert.equal((await s.sync()).newCount,2);assert.equal((await s.sync()).duplicateCount,2);
 assert.equal(r.getCursor('account/INBOX').uid,3);assert.equal(s.status().latestDataDate,'2026-10-07');
 const empty=createSyncService(r,source([]));assert.equal((await empty.sync()).newCount,0);assert.ok(empty.status().lastSuccess);
 }finally{r.close();}
});
test('接続失敗は認証情報を公開せず、前回成功を維持',async()=>{
 const r=openRepository(':memory:');try{
 r.setStatus({lastSuccess:'old'});
 const s=createSyncService(r,{scope:'x',async fetch(){throw Error('password=secret123');}});
 await assert.rejects(s.sync(),/接続|同期/);assert.equal(s.status().lastSuccess,'old');
 assert.ok(!JSON.stringify(s.status()).includes('secret123'));assert.ok(s.status().error);
 }finally{r.close();}
});
test('解析失敗でカーソルを進めず次回再試行',async()=>{
 const r=openRepository(':memory:');try{
 let broken=true;
 const s=createSyncService(r,{scope:'x',async fetch(){return {uidValidity:'1',messages:[message(1),broken?{...message(2,'07'),text:'壊れたイーグルスクエア帯広店 稼働報告'}:message(2,'07')]};}});
 await assert.rejects(s.sync(),/解析/);assert.equal(r.getCursor('x').uid,1);
 broken=false;assert.equal((await s.sync()).newCount,1);assert.equal(r.getData().emails,2);
 }finally{r.close();}
});
test('UIDVALIDITY変更で同UIDの新しいメールを保存',async()=>{
 const r=openRepository(':memory:');try{
 const a=createSyncService(r,source([message(1)]));await a.sync();
 const b=createSyncService(r,{scope:'account/INBOX',async fetch({cursor}){assert.equal(cursor.uidValidity,'1');return {uidValidity:'2',messages:[message(1,'07')]};}});
 assert.equal((await b.sync()).newCount,1);assert.equal(r.getCursor('account/INBOX').uidValidity,'2');
 }finally{r.close();}
});
test('同時同期を拒否する',async()=>{
 const r=openRepository(':memory:');let release;
 try{const s=createSyncService(r,{scope:'x',async fetch(){await new Promise(res=>release=res);return {uidValidity:'1',messages:[]};}});
 const running=s.sync();await assert.rejects(s.sync(),e=>e.code==='SYNC_BUSY');release();await running;
 }finally{r.close();}
});
test('configの既定・異常ポート・本番認証制約',()=>{
 const c=loadConfig({});assert.equal(c.imap.host,'imap.spmode.ne.jp');assert.equal(c.imap.port,993);
 assert.throws(()=>loadConfig({DOCOMO_IMAP_PORT:'invalid'}));assert.throws(()=>loadConfig({NODE_ENV:'production'}),/認証/);
});
test('cronが東京時間の6回・停止可能',()=>{
 let options,schedule,stopped=false;
 const stop=startScheduler({sync:async()=>({})},{schedule(s,fn,o){schedule=s;options=o;return {stop(){stopped=true;}};}});
 assert.equal(schedule,'10,30 11,15,19 * * *');assert.equal(options.timezone,'Asia/Tokyo');assert.equal(SCHEDULE,schedule);stop();assert.equal(stopped,true);
});
test('高いUIDから過去取得の先頭失敗後、通常同期で再試行する',async()=>{
 const r=openRepository(':memory:');try{
 r.setCursor('backfill',{uidValidity:'1',uid:100});let broken=true;
 const s=createSyncService(r,{scope:'backfill',async fetch({cursor,since}){
  assert.equal(since,'2025-01-01');
  if(cursor?.uid>=100)return {uidValidity:'1',messages:[]};
  return {uidValidity:'1',messages:[broken?{...message(1),text:'壊れたイーグルスクエア帯広店 稼働報告'}:message(1)]};
 }});
 await assert.rejects(s.sync({since:'2025-01-01'}));broken=false;
 assert.equal((await s.sync()).newCount,1);assert.equal(r.getCursor('backfill').since,'2025-01-01');
 }finally{r.close();}
});
test('取得開始日の変更は接続失敗時も保持する',async()=>{
 const r=openRepository(':memory:');try{
 r.setCursor('backfill',{uidValidity:'1',uid:100});let fail=true;
 const s=createSyncService(r,{scope:'backfill',async fetch({cursor,since}){if(fail)throw Error('network');assert.equal(since,'2025-01-01');assert.ok(!cursor||cursor.uid===0);return {uidValidity:'2',messages:[message(1)]};}});
 await assert.rejects(s.sync({since:'2025-01-01'}));fail=false;assert.equal((await s.sync()).newCount,1);
 }finally{r.close();}
});
test('大きな未取込メールは警告を残し、前後の報告を進める',async()=>{
 const r=openRepository(':memory:');try{
 let messages=[message(1),{uid:2,skipReason:'oversized'},message(3,'07')];
 const s=createSyncService(r,{scope:'large',async fetch(){return {uidValidity:'1',messages};}});
 const result=await s.sync();assert.equal(result.newCount,2);assert.equal(result.skippedCount,1);assert.equal(r.getCursor('large').uid,3);assert.ok(s.status().warning);
 messages=[];await s.sync();assert.ok(s.status().warning);assert.equal(s.status().unprocessedMessages.length,1);
 }finally{r.close();}
});
