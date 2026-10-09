import {parseReport,normalizeText,normalizeStore,validDate} from './report-parser.js';
import {comparisonDate,compareRows,mergeRows,trendRows,averageTrendRows,periodTrendRows,periodBounds,marketSnapshot,rateCategory} from './analysis.js';
import {drawTrend} from './trend-chart.js';
import {request} from './api-client.js';

const S={records:[],summaries:[],specials:[],mailKeys:new Set(),emails:0,pendingVMG:[],pendingEmails:[],connectionMode:'manual',syncSnapshot:null,tab:'summary'};
const TARGET='イーグル スクエア帯広店';
const $=id=>document.getElementById(id);
const DB_NAME='obihiro-kado-db', STORE='state';

function openDb(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{r.result.createObjectStore(STORE)};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}

let autoRange=true,busy=false,networkReachable=true;
function cleanRows(rows,kind){
 if(!Array.isArray(rows))return [];
 return rows.filter(r=>r&&validDate(r.date)&&[11,15,19].includes(Number(r.time))&&typeof r.store==='string'&&typeof r.customers==='number'&&Number.isFinite(r.customers)&&r.customers>=0&&(kind!=='records'||typeof r.rate==='string')&&(kind!=='specials'||typeof r.group==='string')).map(r=>{const row={...r,time:Number(r.time),store:normalizeStore(r.store),derived:Boolean(r.derived)};for(const key of ['storeTotal','machines','male','female','util','share'])row[key]=Number.isFinite(r[key])&&r[key]>=0?r[key]:null;row.event=typeof r.event==='string'?r.event:'';row.mailId=typeof r.mailId==='string'?r.mailId:'';return row;});
}
async function saveState(){
 let db;try{db=await openDb();const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({records:S.records,summaries:S.summaries,specials:S.specials,mailKeys:[...S.mailKeys],emails:S.emails,pendingVMG:S.pendingVMG,pendingEmails:S.pendingEmails,connectionMode:S.connectionMode,syncSnapshot:S.syncSnapshot},'main');await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});return true;}
 catch{$('storageStatus').textContent='端末内保存に失敗しました。バックアップを保存してください。';return false;}finally{db?.close();}
}
function useSaved(data){
 for(const kind of ['records','summaries','specials'])S[kind]=cleanRows(data[kind],kind);
 S.mailKeys=new Set(Array.isArray(data.mailKeys)?data.mailKeys.filter(k=>typeof k==='string'):[]);
 S.emails=S.mailKeys.size||Number(data.emails)||0;
 S.connectionMode=data.connectionMode==='server'?'server':'manual';
 S.pendingEmails=Array.isArray(data.pendingEmails)?data.pendingEmails.filter(p=>typeof p?.id==='string'&&typeof p?.text==='string'):[];
 S.syncSnapshot=data.syncSnapshot||null;if(S.syncSnapshot)displaySyncStatus(S.syncSnapshot);
 S.pendingVMG=Array.isArray(data.pendingVMG)?data.pendingVMG.filter(p=>typeof p?.id==='string'&&typeof p?.raw==='string'):[];
}
async function loadState(){
 let db;try{db=await openDb();const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get('main');const data=await new Promise((r,j)=>{req.onsuccess=()=>r(req.result);req.onerror=()=>j(req.error)});if(data){useSaved(data);$('status').textContent='保存済みデータを復元しました。';}else $('status').textContent='まだデータは読み込まれていません。';}
 catch{$('status').textContent='保存データの読込に失敗しました。';}finally{db?.close();}updateAll();
}
async function decodeVmg(arrayBuffer){
 const raw=new TextDecoder('utf-8').decode(arrayBuffer),chunks=raw.split(/BEGIN:VMSG/i).slice(1);let emails=0,duplicates=0;
 const staged={records:[],summaries:[],specials:[],mailKeys:new Set(S.mailKeys)};
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
  if(staged.mailKeys.has(id)||staged.mailKeys.has(`hash:${hash}`)||S.summaries.some(r=>r.mailHash===hash)){duplicates++;}else{staged.mailKeys.add(id);emails++;}
  for(const kind of ['records','summaries','specials'])staged[kind]=mergeRows(staged[kind],report[kind].map(r=>({...r,mailId:id,mailHash:hash})),kind);
 }
 for(const kind of ['records','summaries','specials'])S[kind]=mergeRows(S[kind],staged[kind],kind);
 for(const key of staged.mailKeys)S.mailKeys.add(key);
 S.emails=S.mailKeys.size;return{emails,duplicates,totalChunks:chunks.length,raw};
}
function uniq(a){return[...new Set(a)].sort((x,y)=>String(x).localeCompare(String(y),'ja',{numeric:true}))}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fillSelect(id,vals,preferred){const el=$(id),cur=el.value;el.innerHTML='<option value="">すべて</option>'+vals.map(v=>`<option>${esc(v)}</option>`).join('');if(vals.includes(cur))el.value=cur;else if(preferred&&vals.includes(preferred))el.value=preferred}
function filtered(type){const arr=S[type==='summary'?'summaries':type],f=$('from').value,t=$('to').value,tm=$('time').value,st=$('store').value,rt=$('rate').value;return arr.filter(r=>(!f||r.date>=f)&&(!t||r.date<=t)&&(!tm||String(r.time)===tm)&&(!st||r.store===st)&&(!rt||!('rate'in r)||rateCategory(r.rate)===rt))}
function dayDiff(date,days){return comparisonDate(date,String(days))}
function fmtDelta(v){if(v==null||Number.isNaN(v))return '-';return(v>0?'+':'')+v}
function updateAll(){
  const dates=uniq(S.summaries.map(x=>x.date)),stores=uniq(S.summaries.map(x=>x.store));$('kEmails').textContent=S.emails.toLocaleString();$('kDays').textContent=dates.length.toLocaleString();$('kRecords').textContent=S.records.length.toLocaleString();$('kStores').textContent=stores.length;$('kRange').textContent=dates.length?`${dates[0].slice(5).replace('-','/')}〜${dates.at(-1).slice(5).replace('-','/')}`:'-';
  fillSelect('store',stores,TARGET);const groupSelect=$('chartGroup'),selectedGroup=groupSelect.value;groupSelect.innerHTML='<option value="">全体・貸玉種別で比較</option>'+uniq(S.specials.map(r=>r.group)).map(group=>`<option>${esc(group)}</option>`).join('');groupSelect.value=selectedGroup;fillSelect('rate',uniq(S.records.map(x=>rateCategory(x.rate))));if(dates.length&&autoRange){$('from').value=dates[0];$('to').value=dates.at(-1)}
  renderLatestCompare();renderRateCompare();renderRanking();renderTable();drawChart();refreshNetwork()
}

function deltaHtml(value,unit){return `<span class="delta ${value>0?'pos':value<0?'neg':''}">${value==null?'比較なし':fmtDelta(value)+unit}</span>`;}
function renderLatestCustomerKpi(){
 const store=$('store').value||TARGET,mode=$('latestTime').value;
 const source=mode==='average'?averageTrendRows(S):S.summaries.filter(row=>row.time===Number(mode));
 const row=source.filter(row=>row.store===store&&(!$('from').value||row.date>=$('from').value)&&(!$('to').value||row.date<=$('to').value)).sort((a,b)=>b.date.localeCompare(a.date))[0];
 $('kLatest').textContent=Number.isFinite(row?.customers)?row.customers.toLocaleString('ja-JP'):mode==='average'&&row?'未取得':'-';
 $('latestCustomerInfo').textContent=`${store}${row?' / '+row.date:''}${mode==='average'?(row?.complete?' / 11・15・19時平均':row?' / 3回分未取得':' / データなし'):row?'':' / データなし'}`;
}
$('latestTime').addEventListener('change',renderLatestCustomerKpi);
function renderLatestCompare(){
 renderLatestCustomerKpi();
 const store=$('store').value||TARGET;
 $('timeCompareTitle').textContent=`${store} 時間帯比較（最新日）`;
 const data=[11,15,19].flatMap(time=>trendRows(S,{time}));
 const rows=data.filter(x=>x.store===store&&(!$('from').value||x.date>=$('from').value)&&(!$('to').value||x.date<=$('to').value)).sort((a,b)=>b.date.localeCompare(a.date));
 if(!rows.length){$('latestCompare').innerHTML='<div class="msg">データなし</div>';return;}
 const latest=rows[0].date,baseDate=comparisonDate(latest,$('base').value,$('compareDate').value);let h='';
 for(const tm of [11,15,19]){
  const cur=data.find(x=>x.store===store&&x.date===latest&&x.time===tm),prev=baseDate?data.find(x=>x.store===store&&x.date===baseDate&&x.time===tm):null,d=compareRows(cur,prev);
  h+=`<div class="box"><div class="small">${tm}時 / ${latest}</div><div style="font-size:27px;font-weight:800">${cur?cur.customers:'-'}<span class="small">名</span></div><div class="small">稼働率 ${cur?.util!=null?cur.util+'%':'-'} / シェア ${cur?.share!=null?cur.share+'%':'-'}${cur?.derived?'（総合は算出）':''}</div><div class="small">比較 ${baseDate||'同日なし'}<br>客数 ${deltaHtml(d.customers,'名')}<br>稼働率 ${deltaHtml(d.util,'pt')} / シェア ${deltaHtml(d.share,'pt')}</div></div>`;
 }
 $('latestCompare').innerHTML=h;
}
function renderRateCompare(){
 const store=$('store').value||TARGET,time=$('time').value,average=!time;
 const categories=uniq(S.records.map(r=>rateCategory(r.rate))).filter(rate=>!$('rate').value||rate===$('rate').value);
 const source=categories.flatMap(rate=>(average?averageTrendRows(S,{rate}):trendRows(S,{rate,time:Number(time)})).map(r=>({...r,rate})));
 const rows=source.filter(r=>r.store===store&&(!$('from').value||r.date>=$('from').value)&&(!$('to').value||r.date<=$('to').value));
 const latest=rows.map(r=>r.date).sort().at(-1);
 if(!latest){$('rateCompare').textContent='データなし';return;}
 const date=comparisonDate(latest,$('base').value,$('compareDate').value);
 const summary=S.summaries.find(r=>r.store===store&&r.date===latest&&(average||r.time===Number(time)));
 const allRates=S.records.filter(r=>r.store===store&&r.date===latest&&r.time===(average?summary?.time:Number(time)));
 const total=Number.isFinite(summary?.storeTotal)?summary.storeTotal:allRates.length&&allRates.every(r=>Number.isFinite(r.machines))?allRates.reduce((sum,r)=>sum+r.machines,0):null;
 $('rateCompare').innerHTML=`<div class="small">${esc(store)} / ${latest} ${average?'11・15・19時平均':time+'時'}<br><b>総台数 ${total==null?'未取得':total.toLocaleString('ja-JP')+'台'}</b></div>`+'<table><thead><tr><th>貸玉</th><th>台数</th><th>客数</th><th>客数差</th><th>稼働率差</th><th>シェア差</th></tr></thead><tbody>'+rows.filter(r=>r.date===latest).map(r=>{
  const prev=source.find(p=>p.date===date&&p.store===store&&p.rate===r.rate),d=compareRows(r,prev);
  return `<tr><td>${esc(r.rate)}</td><td>${r.machines==null?'未取得':r.machines+'台'}</td><td>${r.customers??'未取得'}</td><td>${deltaHtml(d.customers,'名')}</td><td>${deltaHtml(d.util,'pt')}</td><td>${deltaHtml(d.share,'pt')}</td></tr>`;
 }).join('')+'</tbody></table>';
}
function renderRanking(){
 const time=$('time').value,rate=$('rate').value,key=$('rankingMetric').value;
 const filters={rate,from:$('from').value,to:$('to').value};
 const rows=time?trendRows(S,{...filters,time:Number(time)}):averageTrendRows(S,filters);
 const latest=rows.map(r=>r.date).sort().at(-1);
 $('rankingContext').textContent=`${latest||'データなし'} / ${time?time+'時':'11・15・19時の1日平均'} / ${rate||'店舗全体'} / 全店舗（店舗選択による絞り込みなし）`;
 if(!latest){$('ranking').innerHTML='<div class="msg">データなし</div>';return;}
 const data=rows.filter(r=>r.date===latest).sort((a,b)=>(Number.isFinite(b[key])?b[key]:-Infinity)-(Number.isFinite(a[key])?a[key]:-Infinity)||a.store.localeCompare(b.store,'ja'));
 let rank=0,previous=null;
 const value=(v,unit='')=>Number.isFinite(v)?v.toLocaleString('ja-JP')+unit:'未取得';
 $('ranking').innerHTML='<table><thead><tr><th>順位</th><th>店舗</th><th>客数</th><th>稼働率</th><th>シェア</th></tr></thead><tbody>'+data.map((r,i)=>{
  if(Number.isFinite(r[key])&&r[key]!==previous){rank=i+1;previous=r[key];}
  return `<tr><td>${Number.isFinite(r[key])?rank:'-'}</td><td>${esc(r.store)}</td><td><b>${value(r.customers)}</b></td><td>${value(r.util,'%')}</td><td>${value(r.share,'%')}</td></tr>`;
 }).join('')+'</tbody></table>';
}
$('rankingMetric').addEventListener('change',renderRanking);
function detailRows(type){
 if(type!=='summary')return filtered(type);
 const average=$('summaryAggregation').value==='average',all=$('summaryScope').value==='all';
 const rows=average?averageTrendRows(S):S.summaries;
 return rows.filter(r=>(!$('from').value||r.date>=$('from').value)&&(!$('to').value||r.date<=$('to').value)&&(all||!$('store').value||r.store===$('store').value)&&(average||!$('time').value||String(r.time)===$('time').value)).map(r=>average?{...r,time:'1日平均',event:[...new Set(S.summaries.filter(x=>x.date===r.date&&x.store===r.store).map(x=>x.event).filter(Boolean))].join(' / ')}:r).sort((a,b)=>a.date.localeCompare(b.date)||a.store.localeCompare(b.store,'ja')||String(a.time).localeCompare(String(b.time)));
}
function renderTable(){
  $('summaryControls').hidden=S.tab!=='summary';
  const type=S.tab,rows=detailRows(type),data=rows.slice(0,1000);let h='';
  if(type==='records')h='<table><thead><tr><th>日付</th><th>時間</th><th>店舗</th><th>貸玉</th><th>台数</th><th>男性</th><th>女性</th><th>客数</th><th>稼働率</th><th>シェア</th></tr></thead><tbody>'+data.map(r=>`<tr><td>${r.date}</td><td>${r.time}時</td><td>${esc(r.store)}</td><td>${esc(r.rate)}</td><td>${r.machines}</td><td>${r.male}</td><td>${r.female}</td><td><b>${r.customers}</b></td><td>${r.util}%</td><td>${r.share}%</td></tr>`).join('')+'</tbody></table>';
  else if(type==='summary')h='<table><thead><tr><th>日付</th><th>時間・集計</th><th>店舗</th><th>総台数</th><th>客数</th><th>稼働率</th><th>シェア</th></tr></thead><tbody>'+data.map(r=>`<tr><td>${r.date}</td><td>${r.time==='1日平均'?'1日平均（11・15・19時）':r.time+'時'}</td><td>${esc(r.store)}</td><td>${r.storeTotal??'未取得'}</td><td><b>${r.customers??'未取得'}</b></td><td>${r.util==null?'未取得':r.util+'%'}</td><td>${r.share==null?'未取得':r.share+'%'}</td></tr>`).join('')+'</tbody></table>';
  else h='<table><thead><tr><th>日付</th><th>時間</th><th>店舗</th><th>機種群</th><th>台数</th><th>客数</th><th>稼働率</th></tr></thead><tbody>'+data.map(r=>`<tr><td>${r.date}</td><td>${r.time}時</td><td>${esc(r.store)}</td><td>${esc(r.group)}</td><td>${r.machines}</td><td><b>${r.customers}</b></td><td>${r.util}%</td></tr>`).join('')+'</tbody></table>';$('tableWrap').innerHTML=h||'<div class="msg">該当データなし</div>'
}
const chartHidden=new Set();
const chartColors=['#0f62fe','#c0392b','#15803d','#9333ea','#b45309','#0e7490','#be185d','#475569'];
function drawChart(){
 const tm=+$('time').value||11,rate=$('rate').value,group=$('chartGroup').value;
 const filters={group,rate:group?'':rate,from:$('from').value,to:$('to').value};
 const period=$('chartPeriod').value,averages=periodTrendRows(averageTrendRows(S,filters),period),average=!$('time').value||$('chartAggregation').value==='average',timeLabel=average?'11・15・19時平均':`${tm}時`,periodLabel={day:'毎日',week:'週間',month:'月間'}[period];
 const rows=average?averages:periodTrendRows(trendRows(S,{...filters,time:tm}),period);
 const allStores=uniq([...S.summaries,...S.records,...S.specials].map(r=>r.store)).sort((a,b)=>a===TARGET?-1:b===TARGET?1:a.localeCompare(b,'ja'));
 const colors=new Map(allStores.map((store,i)=>[store,chartColors[i%chartColors.length]]));
 const stores=allStores.filter(store=>rows.some(r=>r.store===store));
 $('chartLabel').textContent=`${periodLabel} / ${timeLabel} / ${group||rate||'店舗総合'}`;
 $('chartStores').innerHTML=stores.map((store,i)=>`<label style="color:${colors.get(store)};display:flex;align-items:center;gap:6px;padding:8px"><input type="checkbox" data-store="${esc(store)}" ${chartHidden.has(store)?'':'checked'}>${esc(store)}</label>`).join('');
 const selected=stores.filter(store=>!chartHidden.has(store));
 const dates=uniq(rows.map(r=>r.date));
 $('chartScope').textContent=`読み取り済み ${stores.length}店舗 / 表示 ${selected.length}店舗（上の店舗フィルターに関係なく全店舗を比較）`;
 const selectedDate=$('chartDate').value;
 $('chartDate').innerHTML=dates.map(day=>`<option>${day}</option>`).join('');$('chartDate').value=dates.includes(selectedDate)?selectedDate:dates.at(-1)||'';
 $('averageTitle').textContent=`11・15・19時 平均（${periodLabel}・全店舗）`;
 renderDailyAverage(averages);
 renderMarketOverview(rows,{group,rate:group?'':rate,time:tm},average,period,timeLabel);
 renderTrendDetails(rows,selected,average?'average':tm);
 for(const [id,key,unit] of [['chart','customers','名'],['shareChart','share','%'],['utilChart','util','%']]){
  const canvas=$(id);
  canvas.setAttribute('aria-label',`${selected.length}店舗 ${timeLabel} ${group||rate||'店舗総合'} ${key==='customers'?'客数':key==='share'?'シェア':'稼働率'}推移`);
  drawTrend(canvas,{rows,dates,stores:selected,colors,key,unit,target:TARGET,date:$('chartDate').value,totalLabel:period!=='day'?'全店1日平均客数':average?'3回取得店の平均客数':'全店客数',wide:$('chartZoom').value==='wide',onDate:day=>{$('chartDate').value=day;drawChart();}});
 }
}

function renderMarketOverview(rows,filters,average,period,timeLabel){
 const day=$('chartDate').value,current=rows.filter(r=>r.date===day),all=periodTrendRows(average?averageTrendRows(S,filters):trendRows(S,filters),period);
 const dates=uniq(all.map(r=>r.date)),index=dates.indexOf(day);
 const controls=`<b>市場の動き</b><div class="field" style="margin-top:10px"><label for="marketDate">市場の表示日・期間（保存済みデータ）</label><select id="marketDate" ${dates.length?'':'disabled'}><option value="" disabled ${index<0?'selected':''}>表示する期間を選択</option>${dates.map(date=>`<option value="${date}" ${date===day?'selected':''}>${date}${period!=='day'?'〜'+periodBounds(date,period).end:''}</option>`).join('')}</select></div><div class="row" style="margin-top:8px"><button class="btn gray" data-market-shift="-1" ${index<=0?'disabled':''}>前へ</button><button class="btn gray" data-market-shift="1" ${index<0||index>=dates.length-1?'disabled':''}>次へ</button></div>`;
 if(!current.length){$('marketOverview').innerHTML=controls+'<p class="small">この条件のデータはありません。保存済みの期間を選ぶか、メール本文を取り込んでください。</p>';return;}
 const priorDate=comparisonDate(day,$('base').value,$('compareDate').value),prior=priorDate?periodBounds(priorDate,period).start:null;
 const snapshot=marketSnapshot(current,all.filter(r=>r.date===prior),TARGET),own=snapshot.own;
 const format=(value,unit)=>Number.isFinite(value)?value.toLocaleString('ja-JP')+unit:'未取得';
 const change=(value,unit)=>value==null?'比較なし':(value>0?'+':'')+value+unit;
 const caption={'1':'前日','7':'前週','28':'4週前','month':'前月同日','custom':'指定日'}[$('base').value];
 const tiles=[['市場全体の客数'+(period!=='day'?'（1日平均）':average?'（3回平均）':''),format(snapshot.total,'名'),caption+' '+change(snapshot.totalDelta,'名')],['帯広店の客数',format(own?.customers,'名'),caption+' '+change(snapshot.ownCustomerDelta,'名')],['帯広店のシェア',format(own?.share,'%'),caption+' '+change(snapshot.ownShareDelta,'pt')],['帯広店の順位',snapshot.rank?snapshot.rank+'位 / '+snapshot.rankedStores+'店':'算出なし','報告 '+snapshot.reported+'店 / 集計 '+snapshot.validStores+'店']];
 const bounds=periodBounds(day,period),winning=current.filter(r=>r.store!==TARGET&&Number.isFinite(own?.share)&&r.share>own.share).sort((a,b)=>b.share-a.share);
 const events=winning.map(r=>{
  const text=uniq(S.summaries.filter(s=>s.store===r.store&&(r.coverageDates?r.coverageDates.includes(s.date):s.date===day)&&(average||s.time===filters.time)).map(s=>s.event?(period==='day'?'':s.date+' ')+s.event:'').filter(Boolean)).join(' / ');
  return `<div><b>${esc(r.store)} ${format(r.share,'%')}</b><br>${text?esc(text):'イベント記載なし・未取得'}</div>`;
 }).join('');
 $('marketOverview').innerHTML=`${controls}<p class="small">${day}${period!=='day'?'〜'+bounds.end:''} / ${timeLabel} / ${esc(filters.group||filters.rate||'店舗総合')}<br>比較：${prior||'未指定'}${prior&&period!=='day'?'〜'+periodBounds(prior,period).end:''}</p><div class="market-kpis">${tiles.map(([label,value,note])=>`<div class="kpi"><div class="l">${label}</div><div class="v">${value}</div><div class="small">${note}</div></div>`).join('')}</div><div class="market-note">${snapshot.leader?'シェア首位：<b>'+esc(snapshot.leader.store)+' '+format(snapshot.leader.share,'%')+'</b><br>':''}${events?'帯広店を上回る競合とイベント：'+events:'帯広店を上回る報告店舗はありません。帯広店データ未取得の場合は比較できません。'}${!snapshot.comparable?'<p class="small">比較データ未取得、または報告店舗・取得日が異なるため、市場客数とシェアの増減は比較しません。</p>':''}</div>`;
}
$('marketOverview').addEventListener('change',event=>{
 if(event.target.id!=='marketDate'||!event.target.value)return;
 const day=event.target.value,bounds=periodBounds(day,$('chartPeriod').value);
 if(!$('from').value||$('from').value>bounds.start)$('from').value=bounds.start;
 if(!$('to').value||$('to').value<bounds.end)$('to').value=bounds.end;
 autoRange=false;
 if(![...$('chartDate').options].some(option=>option.value===day))$('chartDate').add(new Option(day,day));
 $('chartDate').value=day;renderLatestCompare();renderRateCompare();renderRanking();renderTable();drawChart();
});
$('marketOverview').addEventListener('click',event=>{
 const button=event.target.closest('[data-market-shift]');if(!button||button.disabled)return;
 const select=$('marketDate'),dates=[...select.options].map(option=>option.value).filter(Boolean),index=dates.indexOf(select.value),next=index+Number(button.dataset.marketShift);
 if(next<0||next>=dates.length)return;select.value=dates[next];select.dispatchEvent(new Event('change',{bubbles:true}));
});
function renderDailyAverage(rows){
 const day=$('chartDate').value||rows.map(r=>r.date).sort().at(-1);
 const current=rows.filter(r=>r.date===day);
 $('dailyAverage').innerHTML=current.length?'<table><thead><tr><th>日付 / 店舗</th><th>平均客数</th><th>平均稼働率</th><th>平均シェア</th></tr></thead><tbody>'+current.map(r=>`<tr><td>${r.date}${r.periodEnd?'〜'+r.periodEnd:''}<br>${esc(r.store)}${r.days!=null?'<br>'+r.days+'日分 / 期間内'+r.periodDays+'取得日':''}</td><td>${r.complete?r.customers+'名':'3回分未取得（'+r.hours.join('・')+'時のみ）'}</td><td>${r.util==null?'-':r.util+'%'}</td><td>${r.share==null?'-':r.share+'%'}</td></tr>`).join('')+'</tbody></table>':'<p>データなし</p>';
}
function renderTrendDetails(rows,selected,time){
 const latest=$('chartDate').value;
 const current=rows.filter(r=>r.date===latest).sort((a,b)=>(b.share??-1)-(a.share??-1));
 $('chartValues').innerHTML='<table><thead><tr><th>選択日 / 店舗</th><th>客数</th><th>シェア</th></tr></thead><tbody>'+current.filter(r=>selected.includes(r.store)).map(r=>`<tr><td>${r.date}${r.periodEnd?'〜'+r.periodEnd:''}<br>${esc(r.store)}${r.days!=null?'<br>'+r.days+'日分 / 期間内'+r.periodDays+'取得日':''}</td><td>${r.customers==null?'3回分未取得':r.customers+'名'}</td><td>${r.share==null?'未報告':r.share+'%'}${r.shareSource==='calculated'?'（算出）':''}</td></tr>`).join('')+'</tbody></table>';
 const own=current.find(r=>r.store===TARGET);
 if(!own||own.share==null){$('eventCompare').textContent='この日時・種別の帯広店データがないため、シェアを比較できません。';return;}
 const winning=current.filter(r=>r.store!==TARGET&&r.share!=null&&r.share>own.share);
 $('eventCompare').innerHTML=`<p class="small">${latest} ${time==='average'?'11・15・19時平均':time+'時'} / 帯広店 ${own.share}%。イベントはメール記載内容です。</p>`+(winning.length?'<table><thead><tr><th>店舗 / シェア</th><th>イベント</th></tr></thead><tbody>'+winning.map(r=>{
  const period=$('chartPeriod').value,bounds=periodBounds(latest,period);
  const event=period!=='day'?uniq(S.summaries.filter(s=>r.coverageDates.includes(s.date)&&(time==='average'||s.time===time)&&s.store===r.store).map(s=>s.event?s.date+' '+s.event:'').filter(Boolean)).join('\n'):time==='average'?uniq(S.summaries.filter(s=>s.date===latest&&[11,15,19].includes(s.time)&&s.store===r.store).map(s=>s.event).filter(Boolean)).join('\n'):S.summaries.find(s=>s.date===latest&&s.time===time&&s.store===r.store)?.event;
  return `<tr><td>${esc(r.store)}<br>${r.share}%（帯広店より${Math.round((r.share-own.share)*10)/10}pt高い）</td><td style="white-space:pre-wrap">${event?esc(event):'記載なし・未取得'}</td></tr>`;
 }).join('')+'</tbody></table>':'<p>帯広店のシェアを上回る報告店舗はありません。</p>');
}
['chartZoom','chartDate','chartPeriod'].forEach(id=>$(id).addEventListener('change',drawChart));
$('chartAggregation').addEventListener('change',()=>{$('time').value=$('chartAggregation').value==='average'?'':$('time').value||'11';renderRateCompare();renderRanking();renderTable();drawChart();});
$('chartGroup').addEventListener('change',drawChart);
$('chartStores').addEventListener('change',event=>{const el=event.target;if(!el.matches('input[data-store]'))return;if(el.checked)chartHidden.delete(el.dataset.store);else chartHidden.add(el.dataset.store);drawChart();});
function csvEscape(v){v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function exportCsv(){const type=S.tab,rows=detailRows(type);if(!rows.length){alert('出力するデータがありません');return}let cols=type==='records'?[['date','日付'],['time','時間'],['store','店舗'],['rate','貸玉'],['machines','台数'],['male','男性'],['female','女性'],['customers','客数'],['util','稼働率%'],['share','客数シェア%']]:type==='summary'?[['date','日付'],['time','時間'],['store','店舗'],['storeTotal','総台数'],['customers','客数'],['util','稼働率%'],['share','客数シェア%'],['event','イベント']]:[['date','日付'],['time','時間'],['store','店舗'],['group','機種群'],['machines','台数'],['customers','客数'],['util','稼働率%']];const csv='\ufeff'+cols.map(x=>x[1]).join(',')+'\n'+rows.map(r=>cols.map(c=>csvEscape(r[c[0]])).join(',')).join('\n');download(new Blob([csv],{type:'text/csv;charset=utf-8'}),`帯広店_稼働メール_${type}_${new Date().toISOString().slice(0,10)}.csv`)}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

async function loadFiles(files){
 if(!files.length)return;await initialized;let added=0,total=0,duplicates=0,errors=[];$('status').textContent='読み込み中…';
 for(const f of files){
  try{if(f.size>20*1024*1024)throw Error('20MBを超えています');const r=await decodeVmg(await f.arrayBuffer());added+=r.emails;duplicates+=r.duplicates;total+=r.totalChunks;
   const id=crypto.randomUUID();S.pendingVMG.push({id,raw:r.raw});
  }catch(e){errors.push(`${f.name}: ${e.message}`);}
 }
 updateAll();await saveState();$('status').textContent=`読み込み完了：${files.length}ファイル / 新規メール ${added}通 / 重複 ${duplicates}通 / VMG内 ${total}通${errors.length?' / 失敗: '+errors.join(', '):''}`;
 if(navigator.onLine&&S.connectionMode==='server')await connectApi();
}
function backup(){const data={version:2,exportedAt:new Date().toISOString(),records:S.records,summaries:S.summaries,specials:S.specials,mailKeys:[...S.mailKeys],emails:S.emails,pendingVMG:S.pendingVMG,pendingEmails:S.pendingEmails,connectionMode:S.connectionMode,syncSnapshot:S.syncSnapshot};download(new Blob([JSON.stringify(data)],{type:'application/json'}),`帯広店_稼働分析_バックアップ_${new Date().toISOString().slice(0,10)}.json`);}
async function restore(file){
 try{await initialized;if(file.size>20*1024*1024)throw Error();const d=JSON.parse(await file.text());if(!Array.isArray(d.summaries)||!Array.isArray(d.records)||!Array.isArray(d.specials))throw Error();useSaved(d);await saveState();updateAll();$('status').textContent='バックアップを復元しました。';}
 catch{alert('復元に失敗しました。バックアップJSONを確認してください。');}
}
function refreshNetwork(){
 $('serverPanel').hidden=S.connectionMode!=='server';$('connectionMode').value=S.connectionMode;
 $('networkStatus').textContent=S.connectionMode==='manual'?(navigator.onLine?'手動取込・端末内保存':'オフライン — 最終取得データを表示中'):!navigator.onLine?'オフライン — 最終取得データを表示中':!networkReachable?'サーバー未接続 — 最終取得データを表示中':'オンライン';
 $('syncBtn').disabled=busy||!navigator.onLine||!networkReachable;$('pendingStatus').textContent=`VMG未送信 ${S.pendingVMG.length}件 / 本文未送信 ${S.pendingEmails.length}件`;
}
function handleApiError(error){
 if(!error.status)networkReachable=false;
 $('syncError').textContent=error.message;
 if(error.status===401)$('loginForm').hidden=false;
}
async function flushPending(){
 let failed=null;
 for(const entry of [...S.pendingEmails]){
  try{await request('/api/import/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:entry.text})});S.pendingEmails=S.pendingEmails.filter(p=>p.id!==entry.id);await saveState();refreshNetwork();}
  catch(e){failed||=e;if(e.status===401)break;}
 }
 for(const entry of [...S.pendingVMG]){
  try{await request('/api/import/vmg',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new TextEncoder().encode(entry.raw)});S.pendingVMG=S.pendingVMG.filter(p=>p.id!==entry.id);await saveState();refreshNetwork();}
  catch(e){failed||=e;if(e.status===401)break;}
 }
 if(failed)throw failed;
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
 if(s.warning)$('syncError').textContent=[s.error,s.warning].filter(Boolean).join(' / ');else if(s.error)$('syncError').textContent=s.error;else if(s.configured===false)$('syncError').textContent='メール自動取得は未設定です。サーバー側にdocomo IMAP専用ID・パスワードを設定してください。';
}
async function connectApi(){
 if(!navigator.onLine||S.connectionMode!=='server')return;let uploadError=null;try{await flushPending();}catch(e){uploadError=e;}try{
  const data=await request('/api/data');applyServerData(data);displaySyncStatus(await request('/api/status'));networkReachable=true;await saveState();$('loginForm').hidden=true;if(uploadError)handleApiError(uploadError);
 }catch(e){handleApiError(e);}refreshNetwork();
}
async function syncMail(){
 await initialized;if(busy||!navigator.onLine)return;busy=true;refreshNetwork();$('syncError').textContent='';$('syncStatus').textContent='メールを同期しています…';
 try{
  const since=$('syncSince').value;await request('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(since?{since}:{})});
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
['from','to','time','store','rate','base','compareDate'].forEach(id=>$(id).addEventListener('change',()=>{if(['from','to'].includes(id))autoRange=false;if(id==='time')$('chartAggregation').value=$('time').value?'time':'average';if(id==='compareDate')$('base').value='custom';if(id==='base'&&$('base').value!=='custom')$('compareDate').value='';renderLatestCompare();renderRateCompare();renderRanking();renderTable();drawChart()}));
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.tab=b.dataset.tab;renderTable()});
['summaryAggregation','summaryScope'].forEach(id=>$(id).addEventListener('change',renderTable));
$('csvBtn').onclick=exportCsv;$('backupBtn').onclick=backup;$('restoreBtn').onclick=()=>$('restoreFile').click();$('restoreFile').onchange=e=>e.target.files[0]&&restore(e.target.files[0]);$('clearBtn').onclick=async()=>{if(confirm('この端末のデータと未送信VMGをクリアしますか？サーバーのデータは削除されません。')){S.records=[];S.summaries=[];S.specials=[];S.mailKeys.clear();S.emails=0;S.pendingVMG=[];S.pendingEmails=[];autoRange=true;$('from').value='';$('to').value='';await saveState();updateAll();$('status').textContent='データをクリアしました。'}};
document.querySelectorAll('.bottomnav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.bottomnav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.getElementById(b.dataset.target).scrollIntoView({behavior:'smooth',block:'start'})});
let deferredPrompt=null;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBanner').classList.add('show')});$('installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBanner').classList.remove('show')}};$('installClose').onclick=()=>$('installBanner').classList.remove('show');
if('serviceWorker'in navigator){const updating=Boolean(navigator.serviceWorker.controller);navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updating)location.reload();});}
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
window.addEventListener('resize',drawChart);
const initialized=loadState();
initialized.then(()=>connectApi());
setInterval(()=>{if(!busy&&navigator.onLine&&!document.hidden)connectApi();},60000);


setInterval(()=>{if(!networkReachable&&!busy&&navigator.onLine&&!document.hidden)connectApi();},3000);

async function importPastedMail(){
 await initialized;const input=$('mailText'),text=input.value;
 try{
  if(!text.trim()||new TextEncoder().encode(text).length>128*1024)throw Error('128KB以下の稼働報告メール本文を入力してください');
  if(!normalizeText(text).replace(/\s+/g,'').includes('イーグルスクエア帯広店'))throw Error('帯広店の店舗名が見つかりません。本文全体を貼り付けてください');
  const report=parseReport(text);if(!report.summaries.length)throw Error('日時と店舗名・客数が見つかりません。本文全体を貼り付けてください');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizeText(text).replace(/\s+/g,''))))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const id=S.summaries.find(r=>r.mailHash===hash)?.mailId||`hash:${hash}`;
  const duplicate=S.mailKeys.has(id)||S.summaries.some(r=>r.mailHash===hash);
  for(const kind of ['records','summaries','specials'])S[kind]=mergeRows(S[kind],report[kind].map(r=>({...r,mailId:id,mailHash:hash})),kind);
  S.mailKeys.add(id);S.emails=S.mailKeys.size;if(!S.pendingEmails.some(entry=>entry.text===text))S.pendingEmails.push({id:crypto.randomUUID(),text});
  updateAll();const saved=await saveState();
  $('pasteStatus').textContent=saved?`${duplicate?'重複メールの機種・イベント情報を更新しました。 ':''}取込完了：${report.summaries.length}件の店舗総合 / ${report.records.length}件の貸玉データを保存しました。`:'取込済みですが端末内保存に失敗しました。バックアップを保存してください。';
  if(saved)input.value='';
  if(S.connectionMode==='server'&&navigator.onLine)await connectApi();
 }catch(e){$('pasteStatus').textContent=e.message;}
}
$('pasteImportBtn').onclick=importPastedMail;
$('connectionMode').onchange=async event=>{
 const mode=event.target.value;await initialized;S.connectionMode=mode;networkReachable=true;$('syncError').textContent='';refreshNetwork();await saveState();if(mode==='server')await connectApi();
};
