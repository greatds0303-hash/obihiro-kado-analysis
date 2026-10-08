import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createImapSource} from '../src/imap.js';
const config={host:'imap.spmode.ne.jp',port:993,user:'test-id',password:'test-secret',mailbox:'INBOX',scope:'test'};
test('IMAP adapter: TLS・読み取り専用・新着UID・MIME本文・必ず切断',async()=>{
 const calls={};
 class Client{
  constructor(options){calls.options=options;this.mailbox={uidValidity:1n};}on(){}
  async connect(){calls.connected=true;}async getMailboxLock(path,options){calls.mailbox=[path,options];return {release(){calls.released=true;}};}
  async search(query,options){calls.search=[query,options];return [4,5,6];}
  async *fetch(uids,query,options){calls.fetch=[uids,query,options];for(const uid of uids)yield {uid,internalDate:new Date('2026-10-06T02:00:00Z'),source:Buffer.from('Message-ID: <one>\r\nFrom: square_obihiro@eaglegroup.co.jp\r\nSubject: test\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n本文')};}
  async logout(){calls.loggedOut=true;}
 }
 const source=createImapSource(config,{Client});const r=await source.fetch({since:'2026-01-01',cursor:{uidValidity:'1',uid:4}});
 assert.equal(r.messages.length,2);assert.equal(r.messages[0].text,'本文');assert.equal(calls.options.tls.rejectUnauthorized,true);assert.equal(calls.options.logger,false);assert.equal(calls.mailbox[1].readOnly,true);assert.deepEqual(calls.fetch[0],[5,6]);assert.ok(calls.released&&calls.loggedOut);
});
test('IMAP接続失敗と未設定',async()=>{
 let logout=false;
 class Client{on(){} async connect(){throw Error('connection failed');}async logout(){logout=true;}}
 await assert.rejects(createImapSource(config,{Client}).fetch({since:'2026-01-01'}));assert.equal(logout,true);
 await assert.rejects(createImapSource({...config,user:''}).fetch({since:'2026-01-01'}),e=>e.code==='IMAP_NOT_CONFIGURED');
});
test('UIDVALIDITY変更はsince検索に戻る・未着はfetchしない',async()=>{
 let query,fetchCalled=false;
 class Client{constructor(){this.mailbox={uidValidity:2n};}on(){} async connect(){}async getMailboxLock(){return{release(){}};}async search(q){query=q;return [];}async *fetch(){fetchCalled=true;}async logout(){}}
 const r=await createImapSource(config,{Client}).fetch({since:'2026-01-01',cursor:{uidValidity:'1',uid:100}});
 assert.ok(query.since instanceof Date);assert.equal(r.messages.length,0);assert.equal(fetchCalled,false);
});
test('無関係の大きな添付メールでも前後の報告を取得し進行',async()=>{
 const fetched=[];
 class Client{
  constructor(){this.mailbox={uidValidity:1n};}on(){}async connect(){}async getMailboxLock(){return{release(){}};}async search(){return [1,2,3];}
  async *fetch(uids,query){
   for(const uid of uids){
    if(query.source){fetched.push(uid);yield {uid,source:uid===2?Buffer.alloc(11*1024*1024):Buffer.from('From: square_obihiro@eaglegroup.co.jp\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nreport'),internalDate:new Date()};}
    else yield {uid,size:uid===2?11*1024*1024:100,envelope:{from:[{address:uid===2?'friend@example.com':'square_obihiro@eaglegroup.co.jp'}],subject:'稼働報告'}};
   }
  }
  async logout(){}
 }
 const batch=await createImapSource({...config,sender:'square_obihiro@eaglegroup.co.jp'},{Client}).fetch({since:'2026-01-01'});
 assert.deepEqual(fetched,[1,3]);assert.equal(batch.messages.length,3);assert.equal(batch.messages[1].skipReason,'sender');
});
test('大きな対象メールは明示的な未取込として扱い後続を妨げない',async()=>{
 class Client{
  constructor(){this.mailbox={uidValidity:1n};}on(){}async connect(){}async getMailboxLock(){return{release(){}};}async search(){return [1];}
  async *fetch(uids,query){if(query.source)yield {uid:1,source:Buffer.alloc(11*1024*1024)};else yield {uid:1,size:11*1024*1024,envelope:{from:[{address:'square_obihiro@eaglegroup.co.jp'}],subject:'稼働報告'}};}
  async logout(){}
 }
 const batch=await createImapSource({...config,sender:'square_obihiro@eaglegroup.co.jp'},{Client}).fetch({since:'2026-01-01'});
 assert.equal(batch.messages[0].skipReason,'oversized');
});
