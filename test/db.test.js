import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openRepository} from '../src/db.js';
import {ingestEmail} from '../src/ingest.js';
const text=readFileSync(new URL('./fixtures/report.txt',import.meta.url),'utf8');
const email={messageId:'<one>',subject:'イーグルスクエア帯広店 11時15時19時 稼働報告',sender:'square_obihiro@eaglegroup.co.jp',receivedAt:'2026-10-06T02:05:00Z',text};
test('同メールを2回取込しても1件',()=>{
 const r=openRepository(':memory:');try{
 assert.equal(ingestEmail(r,email).outcome,'new');assert.equal(ingestEmail(r,email).outcome,'duplicate');
 assert.equal(r.getData().emails,1);assert.equal(r.query('summaries',{}).length,2);
 }finally{r.close();}
});
test('VMGとIMAPの本文一致、Message-IDなしでも重複',()=>{
 const r=openRepository(':memory:');try{
 ingestEmail(r,{...email,messageId:null});
 assert.equal(ingestEmail(r,{...email,imapIdentity:'a/INBOX/1/5'}).outcome,'duplicate');
 assert.equal(r.getData().emails,1);
 }finally{r.close();}
});
test('別UIDVALIDITYの同UIDは異なるメールとして保存',()=>{
 const r=openRepository(':memory:');try{
 ingestEmail(r,{...email,imapIdentity:'a/INBOX/1/5'});
 assert.equal(ingestEmail(r,{...email,messageId:'<two>',text:text.replaceAll('2026/10/06','2026/10/07'),imapIdentity:'a/INBOX/2/5'}).outcome,'new');
 assert.equal(r.query('records',{from:'2026-10-07',time:11,rate:'7.5円S'}).length,1);
 assert.equal(r.query('summaries',{store:'存在しない'}).length,0);
 }finally{r.close();}
});
test('対象外を保存しない・対象メール解析失敗を無視しない',()=>{
 const r=openRepository(':memory:');try{
 assert.equal(ingestEmail(r,{...email,subject:'雑談',sender:'friend@example.com',text:'hello'}).outcome,'ignored');
 assert.throws(()=>ingestEmail(r,{...email,text:'壊れた本文'}),/解析/);
 assert.equal(r.getData().emails,0);
 }finally{r.close();}
});
test('DB再起動後データ・カーソル・同期状態が保持される',()=>{
 const dir=mkdtempSync(join(tmpdir(),'kado-db-'));const path=join(dir,'state.db');
 try{let r=openRepository(path);ingestEmail(r,email);r.setCursor('scope',{uidValidity:'1',uid:12});r.setStatus({lastSuccess:'2026-10-06T02:00:00Z',newCount:1});r.close();
 r=openRepository(path);assert.equal(r.getData().records.length,5);assert.equal(r.getCursor('scope').uid,12);assert.equal(r.getStatus().newCount,1);r.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('子行の保存失敗はメールもロールバック',()=>{
 const r=openRepository(':memory:');try{
 assert.throws(()=>r.saveEmail(email,{summaries:[{date:'2026-10-06',time:11,store:null}],records:[],specials:[]}));
 assert.equal(r.getData().emails,0);
 }finally{r.close();}
});
test('イベントを保存し再取り込みで古いメールにも追記できる',()=>{
 const r=openRepository(':memory:');try{
 const e={...email,text:text+'\n新台入替'};
 r.saveEmail(e,{summaries:[{date:'2026-10-06',time:11,store:'競合店',customers:12}],records:[],specials:[]});
 ingestEmail(r,e);assert.equal(r.query('summaries',{store:'競合店'})[0].event,'新台入替');
 }finally{r.close();}
});
