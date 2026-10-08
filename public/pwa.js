import {parseReport,normalizeText,normalizeStore,validDate} from './report-parser.js';
import {comparisonDate,compareRows,mergeRows} from './analysis.js';
import {request} from './api-client.js';

const S={records:[],summaries:[],specials:[],mailKeys:new Set(),emails:0,pendingVMG:[],syncSnapshot:null,tab:'summary'};
const TARGET='イーグル スクエア帯広店';
const $=id=>document.getElementById(id);
const DB_NAME='obihiro-kado-db', STORE='state';

function openDb(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{r.result.createObjectStore(STORE)};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}

let autoRange=true,busy=false,networkReachable=true;
function cleanRows(rows,kind){
 if(!Array.isArray(rows))return [];
 return rows.filter(r=>r&&validDate(r.date)&&[11,15,19].includes(Number(r.time))&&typeof r.store==='string'&&typeof r.customers==='number'&&Number.isFinite(r.customers)&&r.customers>=0&&(kind!=='records'||typeof r.rate==='string')&&(kind!=='specials'||typeof r.group==='string')).map(r=>{const row={...r,time:Number(r.time),store:normalizeStore(r.store),derived:Boolean(r.derived)};for(const key of ['storeTotal','machines','male','female','util','share'])row[key]=Number.isFinite(r[key])&&r[key]>=0?r[key]:null;row.mailId=typeof r.mailId==='string'?r.mailId:'';return row;});
}
async function saveState(){
 let db;try{db=await openDb();const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({records:S.records,summaries:S.summaries,specials:S.specials,mailKeys:[...S.mailKeys],emails:S.emails,pendingVMG:S.pendingVMG,syncSnapshot:S.syncSnapshot},'main');await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});return true;}
 catch{$('storageStatus').textContent='端末内保存に失敗しました。バックアップを保存してください。';return false;}finally{db?.close();}
}
function useSaved(data){
 for(const kind of ['records','summaries','specials'])S[kind]=cleanRows(data[kind],kind);
 S.mailKeys=new Set(Array.isArray(data.mailKeys)?data.mailKeys.filter(k=>typeof k==='string'):[]);
 S.emails=S.mailKeys.size||Number(data.emails)||0;
 S.syncSnapshot=data.syncSnapshot||null;if(S.syncSnapshot)displaySyncStatus(S.syncSnapshot);
 S.pendingVMG=Array.isArray(data.pendingVMG)?data.pendingVMG.filter(p=>typeof p?.id==='string'&&typeof p?.raw==='string'):[];
}
async function loadState(){
 let db;try{db=await openDb();const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get('main');const data=await new Promise((r,j)=>{req.onsuccess=()=>r(req.result);req.onerror=()=>j(req.error)});if(data){useSaved(data);$('status').textContent='保存済みデータを復元しました。';}else $('status').textContent='まだデータは読み込まれていません。';}
 catch{$('status').textContent='保存データの読込に失敗しました。';}finally{db?.close();}updateAll();
}
async function decodeVmg(arrayBuffer){
 const raw=new TextDecoder('utf-8').decode(arrayBuffer),chunks=raw.split(/BEGIN:VMSG/i).slice(1);let emails=0,duplicates=0;
 if(!chunks.length)throw Error('VMG形式のメールが見つかりません');
 for(const chunk of chunks){
  const mm=chunk.match(/Content-Type:\s*text\/plain;\s*charset="?([^"\r\n;]+)"?[\s\S]*?Content-Transfer-Encoding:\s*base64\s*\r?\n\r?\n([\s\S]*?)(?:\r?\nEND:VBODY)/i);
  if(!mm)throw Error('base64本文が見つかりません');
  const bin=atob(mm[2].replace(/\s+/g,'')),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
  const body=new TextDecoder(mm[1].trim().toLowerCase()).decode(bytes);
  if(!normalizeText(body).replace(/\s+/g,'').includes('イーグルスクエア帯広店'))continue;
  const report=parseReport(body);if(!report.summaries.length)throw Error('稼働報告を解析できません');
  const normalized=new TextEncoder().encode(normalizeText(body).replace(/\s+/g,''));
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',normalized))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const id=chunk.match(/Message-ID:[ \t]*([^\r\n]+)/i)?.[1]?.trim()||`hash:${hash}`;
  if(S.mailKeys.has(id)||S.mailKeys.has(`hash:${hash}`)||S.summaries.some(r=>r.mailHash===hash)){duplicates++;continue;}
  S.mailKeys.add(id);emails++;
  for(const kind of ['records','summaries','specials'])S[kind]=mergeRows(S[kind],report[kind].map(r=>({...r,mailId:id,mailHash:hash})),kind);
 }
 S.emails=S.mailKeys.size;return{emails,duplicates,totalChunks:chunks.length,raw};
}
function uniq(a){return[...new Set(a)].sort((x,y)=>String(x).localeCompare(String(y),'ja',{numeric:true}))}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fillSelect(id,vals,preferred){const el=$(id),cur=el.value;el.innerHTML='<option value="">すべて</option>'+vals.map(v=>`<option>${esc(v)}</option>`).join('');if(vals.includes(cur))el.value=cur;else if(preferred&&vals.includes(preferred))el.value=preferred}
function filtered(type){const arr=S[type==='summary'?'summaries':type],f=$('from').value,t=$('to').value,tm=$('time').value,st=$('store').value,rt=$('rate').value;return arr.filter(r=>(!f||r.date>=f)&&(!t||r.date<=t)&&(!tm||String(r.time)===tm)&&(!st||r.store===st)&&(!rt||!('rate'in r)||r.rate===rt))}
function dayDiff(date,days){return comparisonDate(date,String(days))}
function fmtDelta(v){if(v==null||Number.isNaN(v))return '-';return(v>0?'+':'')+v}
function updateAll(){
  const dates=uniq(S.summaries.map(x=>x.date)),stores=uniq(S.summaries.map(x=>x.store));$('kEmails').textContent=S.emails.toLocaleString();$('kDays').textContent=dates.length.toLocaleString();$('kRecords').textContent=S.records.length.toLocaleString();$('kStores').textContent=stores.length;$('kRange').textContent=dates.length?`${dates[0].slice(5).replace('-','/')}〜${dates.at(-1).slice(5).replace('-','/')}`:'-';
  fillSelect('store',stores,TARGET);fillSelect('rate',uniq(S.records.map(x=>x.rate)));if(dates.length&&autoRange){$('from').value=dates[0];$('to').value=dates.at(-1)}
  const latest11=[...S.summaries].filter(x=>x.store===TARGET&&x.time===11).sort((a,b)=>b.date.localeCompare(a.date))[0];$('kLatest').textContent=latest11?latest11.customers.toLocaleString():'-';renderLatestCompare();renderRateCompare();renderRanking();renderTable();drawChart();refreshNetwork()
}

function deltaHtml(value,unit){return `<span class="delta ${value>0?'pos':value<0?'neg':''}">${value==null?'比較なし':fmtDelta(value)+unit}</span>`;}
function renderLatestCompare(){
 const rows=S.summaries.filter(x=>x.store===TARGET&&(!$('from').value||x.date>=$('from').value)&&(!$('to').value||x.date<=$('to').value)).sort((a,b)=>b.date.localeCompare(a.date));
 if(!rows.length){$('latestCompare').innerHTML='<div class="msg">データなし</div>';return;}
 const latest=rows[0].date,baseDate=comparisonDate(latest,$('base').value);let h='';
 for(const tm of [11,15,19]){
  const cur=S.summaries.find(x=>x.store===TARGET&&x.date===latest&&x.time===tm),prev=baseDate?S.summaries.find(x=>x.store===TARGET&&x.date===baseDate&&x.time===tm):null,d=compareRows(cur,prev);
  h+=`<div class="box"><div class="small">${tm}時 / ${latest}</div><div style="font-size:27px;font-weight:800">${cur?cur.customers:'-'}<span class="small">名</span></div><div class="small">稼働率 ${cur?.util!=null?cur.util+'%':'-'} / シェア ${cur?.share!=null?cur.share+'%':'-'}${cur?.derived?'（総合は算出）':''}</div><div class="small">比較 ${baseDate||'同日なし'}<br>客数 ${deltaHtml(d.customers,'名')}<br>稼働率 ${deltaHtml(d.util,'pt')} / シェア ${deltaHtml(d.share,'pt')}</div></div>`;
 }
 $('latestCompare').innerHTML=h;
}
function renderRateCompare(){
 const store=$('store').value||TARGET,tm=+$('time').value||11;
 const rows=filtered('records').filter(r=>r.store===store&&r.time===tm);
 const latest=rows.map(r=>r.date).sort().at(-1);
 if(!latest){$('rateCompare').textContent='データなし';return;}
 const date=comparisonDate(latest,$('base').value);
 $('rateCompare').innerHTML='<table><thead><tr><th>貸玉</th><th>客数</th><th>客数差</th><th>稼働率差</th><th>シェア差</th></tr></thead><tbody>'+rows.filter(r=>r.date===latest).map(r=>{
  const prev=S.records.find(p=>p.date===date&&p.time===tm&&p.store===store&&p.rate===r.rate),d=compareRows(r,prev);
  return `<tr><td>${esc(r.rate)}</td><td>${r.customers}</td><td>${deltaHtml(d.customers,'名')}</td><td>${deltaHtml(d.util,'pt')}</td><td>${deltaHtml(d.share,'pt')}</td></tr>`;
 }).join('')+'</tbody></table>';
}
function renderRanking(){
  const tm=$('time').value?+$('time').value:11,rows=filtered('summaries').filter(x=>x.time===tm);if(!rows.length){$('ranking').innerHTML='<div class="msg">データなし</div>';return}const latest=rows.map(x=>x.date).sort().at(-1),data=rows.filter(x=>x.date===latest).sort((a,b)=>b.customers-a.customers);
  $('ranking').innerHTML='<table><thead><tr><th>順位</th><th>店舗</th><th>客数</th><th>稼働率</th><th>シェア</th></tr></thead><tbody>'+data.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.store)}</td><td><b>${r.customers}</b></td><td>${r.util}%</td><td>${r.share??''}${r.share!=null?'%':''}</td></tr>`).join('')+'</tbody></table>'
}
function renderTable(){
  const type=S.tab,rows=filtered(type),data=rows.slice(0,1000);let h='';
  if(type==='records')h='<table><thead><tr><th>日付</th><th>時間</th><th>店舗</th><th>貸玉</th><th>台数</th><th>男性</th><th>女性</th><th>客数</th><th>稼働率</th><th>シェア</th></tr></thead><tbody>'+data.map(r=>`<tr><td>${r.date}</td><td>${r.time}時</td><td>${esc(r.store)}</td><td>${esc(r.rate)}</td><td>${r.machines}</td><td>${r.male}</td><td>${r.female}</td><td><b>${r.customers}</b></td><td>${r.util}%</td><td>${r.share}%</td></tr>`).join('')+'</tbody></table>';
  else if(type==='summary')h='<table><thead><tr><th>日付</th><th>時間</th><th>店舗</th><th>総台数</th><th>客数</th><th>稼働率</th><th>シェア</th></tr></thead><tbody>'+data.map(r=>`<tr><td>${r.date}</td><td>${r.time}時</td><td>${esc(r.store)}</td><td>${r.storeTotal}</td><td><b>${r.customers}</b></td><td>${r.util}%</td><td>${r.share??''}${r.share!=null?'%':''}</td></tr>`).join('')+'</tbody></table>';
  else h='<table><thead><tr><th>日付</th><th>時間</th><th>店舗</th><th>機種群</th><th>台数</th><th>客数</th><th>稼働率</th></tr></thead><tbody>'+data.map(r=>`<tr><td>${r.date}</td><td>${r.time}時</td><td>${esc(r.store)}</td><td>${esc(r.group)}</td><td>${r.machines}</td><td><b>${r.customers}</b></td><td>${r.util}%</td></tr>`).join('')+'</tbody></table>';$('tableWrap').innerHTML=h||'<div class="msg">該当データなし</div>'
}
function drawChart(){
  const c=$('chart'),ctx=c.getContext('2d'),dpr=window.devicePixelRatio||1,W=c.clientWidth||1000,H=260;c.width=W*dpr;c.height=H*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,W,H);let rows=filtered('summaries').filter(r=>r.store===TARGET);const tm=$('time').value?+$('time').value:11;rows=rows.filter(r=>r.time===tm).sort((a,b)=>a.date.localeCompare(b.date));$('chartLabel').textContent=`${tm}時`;if(!rows.length){ctx.fillStyle='#667085';ctx.font='14px sans-serif';ctx.fillText('表示できるデータがありません',20,40);return}
  const pad={l:46,r:18,t:18,b:34},max=Math.max(...rows.map(r=>r.customers),1);ctx.strokeStyle='#d9deea';ctx.lineWidth=1;ctx.font='11px sans-serif';ctx.fillStyle='#667085';for(let k=0;k<=4;k++){const y=pad.t+(H-pad.t-pad.b)*k/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillText(Math.round(max*(1-k/4)),7,y+4)}const x=i=>pad.l+(W-pad.l-pad.r)*(rows.length===1?.5:i/(rows.length-1)),y=v=>pad.t+(H-pad.t-pad.b)*(1-v/max);ctx.strokeStyle='#0f62fe';ctx.lineWidth=2;ctx.beginPath();rows.forEach((r,i)=>i?ctx.lineTo(x(i),y(r.customers)):ctx.moveTo(x(i),y(r.customers)));ctx.stroke();ctx.fillStyle='#0f62fe';rows.forEach((r,i)=>{ctx.beginPath();ctx.arc(x(i),y(r.customers),2.5,0,Math.PI*2);ctx.fill()});const step=Math.max(1,Math.ceil(rows.length/8));ctx.fillStyle='#667085';rows.forEach((r,i)=>{if(i%step===0||i===rows.length-1)ctx.fillText(r.date.slice(5).replace('-','/'),x(i)-14,H-10)})
}
function csvEscape(v){v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function exportCsv(){const type=S.tab,rows=filtered(type);if(!rows.length){alert('出力するデータがありません');return}let cols=type==='records'?[['date','日付'],['time','時間'],['store','店舗'],['rate','貸玉'],['machines','台数'],['male','男性'],['female','女性'],['customers','客数'],['util','稼働率%'],['share','客数シェア%']]:type==='summary'?[['date','日付'],['time','時間'],['store','店舗'],['storeTotal','総台数'],['customers','客数'],['util','稼働率%'],['share','客数シェア%']]:[['date','日付'],['time','時間'],['store','店舗'],['group','機種群'],['machines','台数'],['customers','客数'],['util','稼働率%']];const csv='\ufeff'+cols.map(x=>x[1]).join(',')+'\n'+rows.map(r=>cols.map(c=>csvEscape(r[c[0]])).join(',')).join('\n');download(new Blob([csv],{type:'text/csv;charset=utf-8'}),`帯広店_稼働メール_${type}_${new Date().toISOString().slice(0,10)}.csv`)}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

async function loadFiles(files){
 if(!files.length)return;await initialized;let added=0,total=0,duplicates=0,errors=[];$('status').textContent='読み込み中…';
 for(const f of files){
  try{if(f.size>20*1024*1024)throw Error('20MBを超えています');const r=await decodeVmg(await f.arrayBuffer());added+=r.emails;duplicates+=r.duplicates;total+=r.totalChunks;
   const id=crypto.randomUUID();S.pendingVMG.push({id,raw:r.raw});
  }catch(e){errors.push(`${f.name}: ${e.message}`);}
 }
 updateAll();await saveState();$('status').textContent=`読み込み完了：${files.length}ファイル / 新規メール ${added}通 / 重複 ${duplicates}通 / VMG内 ${total}通${errors.length?' / 失敗: '+errors.join(', '):''}`;
 if(navigator.onLine)await connectApi();
}
function backup(){const data={version:2,exportedAt:new Date().toISOString(),records:S.records,summaries:S.summaries,specials:S.specials,mailKeys:[...S.mailKeys],emails:S.emails,pendingVMG:S.pendingVMG,syncSnapshot:S.syncSnapshot};download(new Blob([JSON.stringify(data)],{type:'application/json'}),`帯広店_稼働分析_バックアップ_${new Date().toISOString().slice(0,10)}.json`);}
async function restore(file){
 try{await initialized;if(file.size>20*1024*1024)throw Error();const d=JSON.parse(await file.text());if(!Array.isArray(d.summaries)||!Array.isArray(d.records)||!Array.isArray(d.specials))throw Error();useSaved(d);await saveState();updateAll();$('status').textContent='バックアップを復元しました。';}
 catch{alert('復元に失敗しました。バックアップJSONを確認してください。');}
}
function refreshNetwork(){
 $('networkStatus').textContent=!navigator.onLine?'オフライン — 最終取得データを表示中':!networkReachable?'サーバー未接続 — 最終取得データを表示中':'オンライン';
 $('syncBtn').disabled=busy||!navigator.onLine||!networkReachable;$('pendingStatus').textContent=`VMG未送信 ${S.pendingVMG.length}件`;
}
function handleApiError(error){
 if(!error.status)networkReachable=false;
 $('syncError').textContent=error.message;
 if(error.status===401)$('loginForm').hidden=false;
}
async function flushPending(){
 for(const entry of [...S.pendingVMG]){
  await request('/api/import/vmg',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new TextEncoder().encode(entry.raw)});
  S.pendingVMG=S.pendingVMG.filter(p=>p.id!==entry.id);await saveState();refreshNetwork();
 }
}
function applyServerData(data){
 for(const kind of ['summaries','records','specials'])S[kind]=mergeRows(S[kind],cleanRows(data[kind],kind),kind);
 // Retain mail identities only for the visible, merged reports, plus server mail IDs.
 S.mailKeys=new Set([...S.summaries,...S.records,...S.specials].map(r=>r.mailId).filter(Boolean).concat(data.mailKeys||[]));
 S.emails=S.mailKeys.size;updateAll();
}
function displaySyncStatus(s){
 S.syncSnapshot=s;
 const when=s.lastSuccess?new Date(s.lastSuccess).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'未同期';
 $('syncStatus').textContent=`最終同期 ${when} / 新規 ${s.newCount||0}通 / 重複 ${s.duplicateCount||0}通${s.hasMore?' / 残りがあります。再度同期してください':''}`;
 if(s.error)$('syncError').textContent=s.error;else if(s.configured===false)$('syncError').textContent='メール自動取得は未設定です。サーバー側にdocomo IMAP専用ID・パスワードを設定してください。';
}
async function connectApi(){
 if(!navigator.onLine)return;try{
  await flushPending();const data=await request('/api/data');applyServerData(data);displaySyncStatus(await request('/api/status'));networkReachable=true;await saveState();$('loginForm').hidden=true;
 }catch(e){handleApiError(e);}refreshNetwork();
}
async function syncMail(){
 await initialized;if(busy||!navigator.onLine)return;busy=true;refreshNetwork();$('syncError').textContent='';$('syncStatus').textContent='メールを同期しています…';
 try{
  await flushPending();const since=$('syncSince').value;await request('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(since?{since}:{})});
  $('syncSince').value='';await connectApi();
 }catch(e){handleApiError(e);try{displaySyncStatus(await request('/api/status'));}catch{}}
 finally{busy=false;refreshNetwork();}
}
$('syncBtn').onclick=syncMail;
$('loginForm').onsubmit=async event=>{
 event.preventDefault();const input=$('appPassword');try{await request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input.value})});input.value='';$('syncError').textContent='';$('loginForm').hidden=true;await connectApi();}catch(e){input.value='';handleApiError(e);}
};
window.addEventListener('online',async()=>{await initialized;refreshNetwork();$('syncError').textContent='';await connectApi();});window.addEventListener('offline',refreshNetwork);
const drop=$('drop'),file=$('file');drop.onclick=()=>file.click();file.onchange=e=>loadFiles([...e.target.files]);['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>loadFiles([...e.dataTransfer.files]));
['from','to','time','store','rate','base'].forEach(id=>$(id).addEventListener('change',()=>{if(['from','to'].includes(id))autoRange=false;renderLatestCompare();renderRateCompare();renderRanking();renderTable();drawChart()}));
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.tab=b.dataset.tab;renderTable()});
$('csvBtn').onclick=exportCsv;$('backupBtn').onclick=backup;$('restoreBtn').onclick=()=>$('restoreFile').click();$('restoreFile').onchange=e=>e.target.files[0]&&restore(e.target.files[0]);$('clearBtn').onclick=async()=>{if(confirm('この端末のデータと未送信VMGをクリアしますか？サーバーのデータは削除されません。')){S.records=[];S.summaries=[];S.specials=[];S.mailKeys.clear();S.emails=0;S.pendingVMG=[];autoRange=true;$('from').value='';$('to').value='';await saveState();updateAll();$('status').textContent='データをクリアしました。'}};
document.querySelectorAll('.bottomnav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.bottomnav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.getElementById(b.dataset.target).scrollIntoView({behavior:'smooth',block:'start'})});
let deferredPrompt=null;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBanner').classList.add('show')});$('installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBanner').classList.remove('show')}};$('installClose').onclick=()=>$('installBanner').classList.remove('show');
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
window.addEventListener('resize',drawChart);
const initialized=loadState();
initialized.then(()=>connectApi());
setInterval(()=>{if(!busy&&navigator.onLine&&!document.hidden)connectApi();},60000);


setInterval(()=>{if(!networkReachable&&!busy&&navigator.onLine&&!document.hidden)connectApi();},3000);
