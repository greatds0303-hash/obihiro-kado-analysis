import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../src/app.js';
import {openRepository} from '../src/db.js';
import {createSyncService} from '../src/sync.js';
import {loadConfig} from '../src/config.js';
const text=readFileSync(new URL('./fixtures/report.txt',import.meta.url),'utf8');
const email={uid:1,messageId:'<one>',text,subject:'稼働報告',sender:'square_obihiro@eaglegroup.co.jp'};
async function fixture(password=''){
 const repository=openRepository(':memory:');const config=loadConfig({APP_PASSWORD:password,ENABLE_CRON:'false'});
 const syncService=createSyncService(repository,{scope:'test',async fetch(){return {uidValidity:'1',messages:[email]};}});
 const server=createApp({repository,syncService,config}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 return {repository,base:`http://127.0.0.1:${server.address().port}`,close:async()=>{await new Promise(r=>server.close(r));repository.close();}};
}
test('同期API・全一覧・フィルタ・状態・静的PWA',async()=>{
 const f=await fixture();try{
 assert.equal((await fetch(f.base+'/api/sync',{method:'POST'})).status,200);
 assert.equal((await (await fetch(f.base+'/api/summary?time=11')).json()).length,2);
 assert.equal((await (await fetch(f.base+'/api/rates?rate=7.5%E5%86%86S')).json()).length,1);
 assert.equal((await (await fetch(f.base+'/api/specials')).json()).length,1);
 assert.equal((await (await fetch(f.base+'/api/status')).json()).newCount,1);
 assert.ok((await (await fetch(f.base+'/')).text()).includes('EAGLE'));
 assert.equal((await fetch(f.base+'/.env')).status,404);
 const data=await (await fetch(f.base+'/api/data')).json();assert.equal(data.emails,1);
 }finally{await f.close();}
});
test('不正日付・時刻・逆範囲・別オリジン更新を拒否',async()=>{
 const f=await fixture();try{
 for(const q of ['from=2026-02-30','time=12','from=2026-10-07&to=2026-10-06'])assert.equal((await fetch(f.base+'/api/summary?'+q)).status,400);
 assert.equal((await fetch(f.base+'/api/sync',{method:'POST',headers:{Origin:'https://other.example'}})).status,403);
 assert.equal((await fetch(f.base+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({since:'bad'})})).status,400);
 assert.equal((await fetch(f.base+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'})).status,400);
 }finally{await f.close();}
});
test('VMG APIは同じメールを再同期しても重複',async()=>{
 const f=await fixture();try{
 const vmg=`BEGIN:VMSG\nBEGIN:VBODY\nMessage-ID: <one>\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n${Buffer.from(text).toString('base64')}\nEND:VBODY\nEND:VMSG`;
 let res=await fetch(f.base+'/api/import/vmg',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:vmg});assert.equal(res.status,200);assert.equal((await res.json()).newCount,1);
 res=await fetch(f.base+'/api/sync',{method:'POST'});assert.equal((await res.json()).duplicateCount,1);
 assert.equal((await fetch(f.base+'/api/import/vmg',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:'invalid'})).status,400);
 }finally{await f.close();}
});
test('任意認証・HttpOnly Cookie・ログアウト・秘密を返さない',async()=>{
 const password='a-very-long-test-password';const f=await fixture(password);try{
 assert.equal((await fetch(f.base+'/api/status')).status,401);
 const login=await fetch(f.base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie');assert.ok(cookie.includes('HttpOnly'));assert.ok(cookie.includes('SameSite=Strict'));
 const res=await fetch(f.base+'/api/status',{headers:{Cookie:cookie.split(';')[0]}});assert.equal(res.status,200);assert.ok(!(await res.text()).includes(password));
 assert.equal((await fetch(f.base+'/api/session',{method:'DELETE',headers:{Cookie:cookie.split(';')[0]}})).status,200);
 assert.equal((await fetch(f.base+'/api/status',{headers:{Cookie:cookie.split(';')[0]}})).status,401);
 }finally{await f.close();}
});
