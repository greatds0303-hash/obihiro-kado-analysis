import {marketInsights} from './market-insights.js';
import {parseReport,normalizeText,normalizeStore,validDate} from './report-parser.js';
import {decodeSurveyCsv,mergeCsvReport} from './csv-import.js';
import {comparisonDate,compareRows,mergeRows,trendRows,averageTrendRows,periodTrendRows,periodBounds,marketSnapshot,rateCategory,rangeTrendRows,shareDeclineAlerts,marketSizeComparison,monthlyCustomerGrowth,monthlyRateChanges,storeCustomerCorrelations} from './analysis.js';
import {drawTrend} from './trend-chart.js';
import {request} from './api-client.js';

const S={records:[],summaries:[],specials:[],mailKeys:new Set(),emails:0,pendingVMG:[],pendingEmails:[],connectionMode:'manual',syncSnapshot:null,tab:'summary'};
const TARGET='イーグル スクエア帯広店';
const $=id=>document.getElementById(id);
const pickerClosedAt=new WeakMap();
document.addEventListener('click',event=>{
 const control=event.target;
 if(control instanceof HTMLSelectElement&&Date.now()-(pickerClosedAt.get(control)||0)<300){event.preventDefault();event.stopImmediatePropagation();control.blur();}
},true);
function bindChange(element,handler){
 let pending;
 element.addEventListener('change',event=>{
  if(event.target instanceof HTMLSelectElement){
   const control=event.target,value=control.value;pickerClosedAt.set(control,Date.now());control.blur();clearTimeout(pending);pending=setTimeout(()=>{if(control.isConnected)control.value=value;handler(event);},80);
  }else handler(event);
 });
}
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
  renderShareAlerts();
  const dates=uniq(S.summaries.map(x=>x.date)),stores=uniq(S.summaries.map(x=>x.store));$('kEmails').textContent=S.emails.toLocaleString();$('kDays').textContent=dates.length.toLocaleString();$('kRecords').textContent=S.records.length.toLocaleString();$('kStores').textContent=stores.length;$('kRange').textContent=dates.length?`${dates[0].slice(5).replace('-','/')}〜${dates.at(-1).slice(5).replace('-','/')}`:'-';
  fillSelect('store',stores,TARGET);const groupSelect=$('chartGroup'),selectedGroup=groupSelect.value;groupSelect.innerHTML='<option value="">全体・貸玉種別で比較</option>'+uniq(S.specials.map(r=>r.group)).map(group=>`<option>${esc(group)}</option>`).join('');groupSelect.value=selectedGroup;fillSelect('rate',uniq(S.records.map(x=>rateCategory(x.rate))));if(dates.length&&autoRange){$('from').value=dates.at(-1).slice(0,4)+'-07-04';if($('from').value>dates.at(-1))$('from').value=dates[0];$('to').value=dates.at(-1)}
  renderLatestCompare();renderRateCompare();renderRanking();renderTable();drawChart();refreshNetwork()
}

function deltaHtml(value,unit){return `<span class="delta ${value>0?'pos':value<0?'neg':''}">${value==null?'比較なし':fmtDelta(value)+unit}</span>`;}
function renderShareAlerts(){
 const result=shareDeclineAlerts(S,{target:TARGET,time:$('alertTime').value});
 if(!result.latest){$('shareAlertContent').innerHTML='<p class="small">メールを取り込むと判定します。</p>';return;}
 const cards=result.alerts.map(item=>{
  const people=value=>value.toLocaleString('ja-JP')+'人',change=item.customerChange<0?people(-item.customerChange)+'減':item.customerChange>0?people(item.customerChange)+'増':'増減なし';
  const timeLabel=$('alertTime').value==='average'?'11・15・19時平均':$('alertTime').value+'時';
  const reason=item.shareDeclining?`3日間でシェア連続低下 / −${item.drop}pt${item.customerDeclining?'・客数も連続減少':''}`:'3日間で客数連続減少';
  return `<div style="margin-top:10px;padding:12px;border:2px solid #c13d3d;border-radius:10px;background:#fff3f2;color:#9c2020"><b>危険：${esc(item.kind)} ${esc(item.name)}</b><br>${reason}<br><b style="color:${item.customerChange<0?'#9c2020':'#172033'}">客数（${timeLabel}）：${people(item.customers[0])} → ${people(item.customers[2])}（${change}）</b><div style="margin-top:6px">${item.dates.map((date,i)=>`${date}：<b>${item.shares[i]}% / ${people(item.customers[i])}</b>`).join('<br>')}</div></div>`;
 }).join('');
 $('shareAlertContent').innerHTML=`<p class="small">${result.dates[0]}〜${result.latest} / 判定できたカテゴリー ${result.checked}件</p>`+(cards||`<p>${result.checked?'判定できたカテゴリーに3日間の連続低下はありません。':'判定に必要な3日分のデータがありません。'}</p>`)+(result.unavailable.length?`<details style="margin-top:10px"><summary>判定できないカテゴリー ${result.unavailable.length}件</summary>${result.unavailable.map(item=>`<p class="small">${esc(item.kind)} ${esc(item.name)}：${esc(item.reason)}</p>`).join('')}</details>`:'');
}
bindChange($('alertTime'),renderShareAlerts);
function renderLatestCustomerKpi(){
 const store=$('store').value||TARGET,mode=$('latestTime').value;
 const source=mode==='average'?averageTrendRows(S):S.summaries.filter(row=>row.time===Number(mode));
 const row=source.filter(row=>row.store===store&&(!$('from').value||row.date>=$('from').value)&&(!$('to').value||row.date<=$('to').value)).sort((a,b)=>b.date.localeCompare(a.date))[0];
 $('kLatest').textContent=Number.isFinite(row?.customers)?row.customers.toLocaleString('ja-JP'):mode==='average'&&row?'未取得':'-';
 $('latestCustomerInfo').textContent=`${store}${row?' / '+row.date:''}${mode==='average'?(row?.complete?' / 11・15・19時平均':row?' / 3回分未取得':' / データなし'):row?'':' / データなし'}`;
}
function selectTime(time){
 $('time').value=time;$('latestTime').value=time||'average';$('rateCompareTime').value=time;$('chartAggregation').value=time?'time':'average';
 renderLatestCompare();renderRateCompare();renderRanking();renderTable();drawChart();
}
bindChange($('latestTime'),()=>selectTime($('latestTime').value==='average'?'':$('latestTime').value));
bindChange($('rateCompareTime'),()=>selectTime($('rateCompareTime').value));
function rangeMode(){return $('base').value==='range';}
function selectedRange(rows,comparison=false){return rangeTrendRows(rows,$(comparison?'compareDate':'from').value,$(comparison?'compareEnd':'to').value);}
function renderLatestCompare(){
 renderLatestCustomerKpi();
 const store=$('store').value||TARGET;
 $('timeCompareTitle').textContent=`${store} 時間帯比較（${rangeMode()?'指定期間の平均':'最新日'}）`;
 const data=[11,15,19].flatMap(time=>trendRows(S,{time}));
 const rows=data.filter(x=>x.store===store&&(!$('from').value||x.date>=$('from').value)&&(!$('to').value||x.date<=$('to').value)).sort((a,b)=>b.date.localeCompare(a.date));
 if(!rows.length){$('latestCompare').innerHTML='<div class="msg">データなし</div>';return;}
 const latest=rows[0].date,baseDate=comparisonDate(latest,$('base').value,$('compareDate').value);let h='';
 for(const tm of [11,15,19]){
  const subset=data.filter(x=>x.time===tm),cur=rangeMode()?selectedRange(subset).find(x=>x.store===store):data.find(x=>x.store===store&&x.date===latest&&x.time===tm),prev=rangeMode()?selectedRange(subset,true).find(x=>x.store===store):baseDate?data.find(x=>x.store===store&&x.date===baseDate&&x.time===tm):null,d=compareRows(cur,prev);
  const currentLabel=rangeMode()?`${$('from').value}〜${$('to').value} / ${cur?.days||0}日取得`:latest,priorLabel=rangeMode()?`${$('compareDate').value}〜${$('compareEnd').value} / ${prev?.days||0}日取得`:baseDate||'同日なし';
  h+=`<div class="box"><div class="small">${tm}時 / ${currentLabel}</div><div style="font-size:27px;font-weight:800">${cur?.customers??'未取得'}<span class="small">名</span></div><div class="small">稼働率 ${cur?.util!=null?cur.util+'%':'-'} / シェア ${cur?.share!=null?cur.share+'%':'-'}${cur?.derived?'（総合は算出）':''}</div><div class="small">比較 ${priorLabel}<br>客数 ${deltaHtml(d.customers,'名')}<br>稼働率 ${deltaHtml(d.util,'pt')} / シェア ${deltaHtml(d.share,'pt')}</div></div>`;
 }
 $('latestCompare').innerHTML=h;
}
function renderRateCompare(){
 const store=$('store').value||TARGET,time=$('time').value,average=!time;
 const categories=uniq(S.records.map(r=>rateCategory(r.rate))).filter(rate=>!$('rate').value||rate===$('rate').value);
 const rawSource=categories.flatMap(rate=>(average?averageTrendRows(S,{rate}):trendRows(S,{rate,time:Number(time)})).map(r=>({...r,rate})));
 const source=rangeMode()?categories.flatMap(rate=>selectedRange(rawSource.filter(r=>r.rate===rate))):rawSource;
 const rows=source.filter(r=>r.store===store&&(!$('from').value||r.date>=$('from').value)&&(!$('to').value||r.date<=$('to').value));
 const latest=rows.map(r=>r.date).sort().at(-1);
 if(!latest){$('rateCompare').textContent='データなし';return;}
 const date=comparisonDate(latest,$('base').value,$('compareDate').value);
 const summary=S.summaries.find(r=>r.store===store&&r.date===(rangeMode()?rows[0].coverageDates?.at(-1):latest)&&(average||r.time===Number(time)));
 const allRates=S.records.filter(r=>r.store===store&&r.date===(summary?.date||latest)&&r.time===(average?summary?.time:Number(time)));
 const total=Number.isFinite(summary?.storeTotal)?summary.storeTotal:allRates.length&&allRates.every(r=>Number.isFinite(r.machines))?allRates.reduce((sum,r)=>sum+r.machines,0):null;
 $('rateCompare').innerHTML=`<div class="small">${esc(store)} / ${rangeMode()?$('from').value+'〜'+$('to').value+' / 期間平均':latest} ${average?'11・15・19時平均':time+'時'}<br><b>総台数 ${total==null?'未取得':total.toLocaleString('ja-JP')+'台'}</b></div>`+'<table><thead><tr><th>貸玉</th><th>台数</th><th>客数</th><th>客数差</th><th>稼働率差</th><th>シェア差</th></tr></thead><tbody>'+rows.filter(r=>r.date===latest).map(r=>{
  const prev=rangeMode()?selectedRange(rawSource.filter(p=>p.rate===r.rate),true).find(p=>p.store===store):source.find(p=>p.date===date&&p.store===store&&p.rate===r.rate),d=compareRows(r,prev);
  const actualRates=uniq(S.records.filter(p=>p.store===store&&rateCategory(p.rate)===r.rate&&(rangeMode()?p.date>=$('from').value&&p.date<=$('to').value:p.date===latest)&&(average||p.time===Number(time))).map(p=>p.rate));
  return `<tr><td>${esc(actualRates.join(' / ')||r.rate)}</td><td>${r.machines==null?'未取得':r.machines+'台'}</td><td>${r.customers??'未取得'}</td><td>${deltaHtml(d.customers,'名')}</td><td>${deltaHtml(d.util,'pt')}</td><td>${deltaHtml(d.share,'pt')}</td></tr>`;
 }).join('')+'</tbody></table>';
}
function renderRanking(){
 const time=$('time').value,rate=$('rate').value,key=$('rankingMetric').value;
 const filters={rate,from:$('from').value,to:$('to').value};
 const raw=time?trendRows(S,{...filters,time:Number(time)}):averageTrendRows(S,filters),rows=rangeMode()?selectedRange(raw):raw;
 const latest=rows.map(r=>r.date).sort().at(-1);
 $('rankingContext').textContent=`${rangeMode()?$('from').value+'〜'+$('to').value+' / 期間平均':latest||'データなし'} / ${time?time+'時':'11・15・19時の1日平均'} / ${rate||'店舗全体'} / 全店舗（店舗選択による絞り込みなし）`;
 if(!latest){$('ranking').innerHTML='<div class="msg">データなし</div>';return;}
 const data=rows.filter(r=>r.date===latest).sort((a,b)=>(Number.isFinite(b[key])?b[key]:-Infinity)-(Number.isFinite(a[key])?a[key]:-Infinity)||a.store.localeCompare(b.store,'ja'));
 let rank=0,previous=null;
 const value=(v,unit='')=>Number.isFinite(v)?v.toLocaleString('ja-JP')+unit:'未取得';
 $('ranking').innerHTML='<table><thead><tr><th>順位</th><th>店舗</th><th>客数</th><th>稼働率</th><th>シェア</th></tr></thead><tbody>'+data.map((r,i)=>{
  if(Number.isFinite(r[key])&&r[key]!==previous){rank=i+1;previous=r[key];}
  return `<tr><td>${Number.isFinite(r[key])?rank:'-'}</td><td>${esc(r.store)}</td><td><b>${value(r.customers)}</b></td><td>${value(r.util,'%')}</td><td>${value(r.share,'%')}</td></tr>`;
 }).join('')+'</tbody></table>';
}
bindChange($('rankingMetric'),renderRanking);
function detailRows(type){
 if(type!=='summary')return filtered(type);
 const mode=$('summaryAggregation').value,average=mode!=='time',all=$('summaryScope').value==='all';
 const baseRows=average?averageTrendRows(S):trendRows(S,{time:Number($('summaryHour').value)});
 const dated=baseRows.filter(r=>(!$('from').value||r.date>=$('from').value)&&(!$('to').value||r.date<=$('to').value)&&(average||String(r.time)===$('summaryHour').value));
 const rows=mode==='range'?selectedRange(baseRows):mode==='month'?periodTrendRows(dated,'month'):dated;
 return rows.filter(r=>all||!$('store').value||r.store===$('store').value).map(r=>average?{...r,time:mode==='range'?'期間平均':mode==='month'?'月平均':'1日平均',event:[...new Set(S.summaries.filter(x=>x.store===r.store&&(r.coverageDates?r.coverageDates.includes(x.date):x.date===r.date)).map(x=>x.event).filter(Boolean))].join(' / ')}:r).sort((a,b)=>a.date.localeCompare(b.date)||a.store.localeCompare(b.store,'ja')||String(a.time).localeCompare(String(b.time)));

}
function monthDelta(current,previous,date){
 const delta=compareRows(current,previous),value=(v,unit)=>v==null?'比較なし':`<span style="color:${v<0?'#c13d3d':'#172033'}">${v>0?'+':''}${v}${unit}</span>`;
 return `<br>前月 ${date?date.slice(0,7):'なし'}<br>客数差 ${value(delta.customers,'名')}<br>シェア差 ${value(delta.share,'pt')}<br>稼働率差 ${value(delta.util,'pt')}`;
}
function monthRateGrowth(store,date,rows){
 const current=rows.filter(r=>r.store===store&&r.date===date),up=current.filter(r=>r.customerUp||r.shareUp).sort((a,b)=>(b.customerDelta||0)-(a.customerDelta||0));
 const value=(n,unit)=>n==null?'未取得':n.toLocaleString('ja-JP')+unit;
 const delta=(n,unit)=>n==null?'比較なし':`<span style="color:${n<0?'#c13d3d':'#172033'}">${n>0?'+':''}${n.toLocaleString('ja-JP')}${unit}</span>`;
 if(!up.length)return `<div class="small monthly-rate-changes">${current.some(r=>r.customerDelta!=null||r.shareDelta!=null)?'前月比で上昇した種別はありません。':'種別の前月比較データなし'}</div>`;
 return '<div class="monthly-rate-changes"><b>↑ 上昇した貸玉種別</b>'+up.map(r=>`<div class="monthly-rate-change" data-growth-category="${esc(r.category)}"><b>${esc(r.category)}（${esc(r.rates.join(' / '))}）</b><br><span class="growth-badge">${r.customerUp&&r.shareUp?'客数・シェア上昇':r.customerUp?'客数上昇':'シェア上昇'}</span><br>客数 ${value(r.customers,'名')}（前月比 ${delta(r.customerDelta,'名')}）<br>シェア ${value(r.share,'%')}（前月比 ${delta(r.shareDelta,'pt')}）</div>`).join('')+'</div>';
}
function renderStoreCorrelation({month,from,to,rateChanges}){
 const direction=$('correlationDirection').value,results=storeCustomerCorrelations(S,{target:TARGET,from,to,direction});
 const value=(n,unit)=>n==null?'未取得':n.toLocaleString('ja-JP')+unit;
 $('storeCorrelation').hidden=false;
 $('correlationContext').textContent=`帯広店を基準 / ${from}〜${to} / 11・15・19時の1日平均客数 / 全店舗から比較。相関係数rは+1に近いほど同じ動き、−1に近いほど逆の動きです。`;
 $('correlationContent').innerHTML=results.map(result=>`<div class="monthly-rate-change" data-correlation-category="${esc(result.category)}"><b>${esc(result.category)}：${direction==='negative'?'逆の動き':'同じ動き'}の相関1位</b>${result.winner?result.tied.map(winner=>{
  const detail=result.category==='店舗全体'?rateChanges.filter(r=>r.store===winner.store&&r.date===month):[];
  return `<div style="margin-top:6px"><b>${esc(winner.store)}${result.tied.length>1?'（同率）':''}</b>${winner.rates.length?' / '+esc(winner.rates.join(' / ')):''}<br>相関係数 r=${winner.coefficient>0?'+':''}${winner.coefficient.toFixed(3)} / 同日比較 ${winner.days}日<br>平均客数 ${value(winner.customers,'名')} / シェア ${value(winner.share,'%')}${detail.length?'<div class="monthly-rate-changes"><b>相関1位店舗の種別内訳（対象月の平均）</b>'+detail.map(r=>`<div style="margin-top:6px"><b>${esc(r.category)}（${esc(r.rates.join(' / '))}）</b><br>客数 ${value(r.customers,'名')} / シェア ${value(r.share,'%')}</div>`).join('')+'</div>':''}</div>`;
 }).join(''):'<p class="small">該当なし。同日のデータが3日以上あり、客数に変動がある店舗のうち、選択した方向の相関がある店舗を比較します。</p>'}</div>`).join('')+'<p class="small">相関1位の客数・シェアは同日比較に使えた日の平均・合計から計算。種別内訳は対象月の取得分の平均です。種別のシェアはその種別の全報告店舗の客数から計算します。</p>';
}
bindChange($('correlationDirection'),renderTable);
function renderTable(){
  $('monthlyCustomerGrowth').hidden=true;
  $('storeCorrelation').hidden=true;
  $('summaryControls').hidden=S.tab!=='summary';
  $('summaryHourField').hidden=$('summaryAggregation').value!=='time';
  renderDetailCharts();
  if(S.tab!=='summary'){$('tableWrap').hidden=true;return;}
  $('tableWrap').hidden=false;
  const data=detailRows('summary'),stores=uniq(data.map(r=>r.store)),keys=uniq(data.map(r=>JSON.stringify([r.date,r.time])));
  const source=$('summaryAggregation').value!=='time'?averageTrendRows(S):trendRows(S,{time:Number($('summaryHour').value)});
  const monthlyHistory=$('summaryAggregation').value==='month'?periodTrendRows(averageTrendRows(S),'month'):[];
  const rateChanges=$('summaryAggregation').value==='month'?monthlyRateChanges(S,{from:$('from').value,to:$('to').value}):[];
  if($('summaryAggregation').value==='month'&&data.length){
   const growth=monthlyCustomerGrowth(data,monthlyHistory),number=v=>v.toLocaleString('ja-JP');
   const bounds=periodBounds(growth.month,'month'),from=$('from').value>bounds.start?$('from').value:bounds.start,to=$('to').value&&$('to').value<bounds.end?$('to').value:bounds.end;
   renderStoreCorrelation({month:growth.month,from,to,rateChanges});
   $('monthlyCustomerGrowth').hidden=false;
   $('monthlyCustomerGrowth').innerHTML=`<b>★ ${esc(growth.month.slice(0,7))} 客数増加ランキング</b><p class="small">11・15・19時の1日平均 / 前月 ${esc(growth.previousMonth.slice(0,7))} の平均との比較<br>対象：${esc(growth.from)}〜${esc(growth.to)}${growth.partial?'（月の一部）':''}<br>比較できた ${growth.comparedStores}店舗 / 客数の増加人数が大きい順<br>種別のシェアは、その種別の全報告店舗の客数から計算します。</p>`+(growth.gainers.length?growth.gainers.map(r=>`<div class="growth-entry" data-growth-store="${esc(r.store)}"><b>${r.rank}位 ${esc(r.store)}</b><br><strong>+${number(r.delta)}名</strong> ${r.changePercent==null?'（前月0名）':`（+${number(r.changePercent)}%）`}<br><span class="small">前月 ${number(r.previousCustomers)}名 → 対象月 ${number(r.customers)}名 / 対象月${r.days||0}日・前月${r.previousDays}日を集計</span>${monthRateGrowth(r.store,growth.month,rateChanges)}</div>`).join(''):`<p>${growth.comparedStores?'前月より客数が増加した店舗はありません。':'前月の比較データがありません。'}</p>`);
  }
  const totals=selectedRange(source),val=(v,unit='')=>Number.isFinite(v)?v.toLocaleString('ja-JP')+unit:'未取得';
  const metrics=r=>r?`客数 <b>${val(r.customers,'名')}</b><br>シェア ${val(r.share,'%')}<br>稼働率 ${val(r.util,'%')}<br>総台数 ${val(r.storeTotal,'台')}`:'未取得';
  const summaryRow=$('summaryAggregation').value!=='range'?'':'<tr class="period-average"><td><b>指定期間の平均</b><br>'+esc($('from').value)+'〜'+esc($('to').value)+'</td>'+stores.map(store=>`<td data-store="${esc(store)}">${metrics(totals.find(r=>r.store===store))}</td>`).join('')+'</tr>';
  $('tableWrap').innerHTML='<table class="store-matrix"><thead><tr><th>日付・集計</th>'+stores.map(store=>`<th>${esc(store)}</th>`).join('')+'</tr>'+summaryRow+'</thead><tbody>'+($('summaryAggregation').value==='range'?[]:keys.slice(0,1000)).map(key=>{
   const [date,time]=JSON.parse(key),prior=time==='月平均'?comparisonDate(date,'month'):null,label=time==='月平均'?date.slice(0,7)+' 月平均（11・15・19時）':date+'<br>'+(time==='1日平均'?'1日平均（11・15・19時）':time+'時');
   return `<tr><td>${label}</td>`+stores.map(store=>{
    const current=data.find(r=>r.date===date&&r.time===time&&r.store===store),previous=monthlyHistory.find(r=>r.date===prior&&r.store===store),increase=time==='月平均'?compareRows(current,previous).customers:null;
    return `<td data-store="${esc(store)}"${increase>0?' class="growth-cell"':''}>${increase>0?`<span class="growth-badge">★ 客数増加 +${increase}名</span><br>`:''}${metrics(current)}${time==='月平均'?monthDelta(current,previous,prior)+monthRateGrowth(store,date,rateChanges):''}</td>`;
   }).join('')+'</tr>';
  }).join('')+'</tbody></table>';


}
let detailAutoRange=true,detailSelectedDate='';
const detailCategories={records:'',specials:''};
function renderDetailCharts(){
 const type=S.tab,active=type==='records'||type==='specials';$('detailCharts').hidden=!active;if(!active)return;
 const categories=uniq(type==='records'?S.records.map(r=>rateCategory(r.rate)):S.specials.map(r=>r.group));
 if(JSON.stringify([...$('detailCategory').options].map(option=>option.value))!==JSON.stringify(categories))$('detailCategory').innerHTML=categories.map(v=>`<option>${esc(v)}</option>`).join('');
 $('detailCategory').value=categories.includes(detailCategories[type])?detailCategories[type]:categories[0]||'';detailCategories[type]=$('detailCategory').value;
 if(detailAutoRange){$('detailFrom').value=$('from').value;$('detailTo').value=$('to').value;}
 const category=$('detailCategory').value,from=$('detailFrom').value,to=$('detailTo').value,period=$('detailPeriod').value;
 const time=$('detailTime').value==='linked'?$('time').value:$('detailTime').value,average=!time||time==='average';
 const filters={from,to,...(type==='records'?{rate:category}:{group:category})};
 const raw=category&&(from<=to||!from||!to)?(average?averageTrendRows(S,filters):trendRows(S,{...filters,time:Number(time)})):[];
 const rows=periodTrendRows(raw,period),historyFilters={...filters,from:'',to:''},history=periodTrendRows(category?(average?averageTrendRows(S,historyFilters):trendRows(S,{...historyFilters,time:Number(time)})):[],period),allStores=uniq([...S.summaries,...S.records,...S.specials].map(r=>r.store)),colors=new Map(allStores.map((store,i)=>[store,chartColors[i%chartColors.length]]));
 const stores=uniq(rows.map(r=>r.store)).filter(store=>$('detailScope').value==='all'||!$('store').value||store===$('store').value),dates=uniq(rows.map(r=>r.date));
 detailSelectedDate=dates.includes(detailSelectedDate)?detailSelectedDate:dates.at(-1)||'';
 $('detailChartContext').textContent=`${category||'カテゴリー未取得'} / ${from||'開始日指定なし'}〜${to||'終了日指定なし'} / ${average?'11・15・19時平均':time+'時'} / ${{day:'毎日',week:'週間',month:'月間'}[period]} / ${stores.length}店舗${from&&to&&from>to?' / 開始日は終了日以前にしてください':''}`;
 $('detailLegend').innerHTML=stores.map(store=>`<span style="color:${colors.get(store)};padding:5px">● ${esc(store)}</span>`).join('');
 const val=(v,unit='')=>Number.isFinite(v)?v.toLocaleString('ja-JP')+unit:'未取得';
 const diff=(v,unit)=>v==null?'比較なし':`<span style="color:${v<0?'#c13d3d':'#172033'}">${v>0?'+':''}${v}${unit}</span>`;
 const rangeStart=from||uniq(raw.map(r=>r.date))[0],rangeEnd=to||uniq(raw.map(r=>r.date)).at(-1),totals=rangeTrendRows(raw,rangeStart,rangeEnd);
 const metrics=r=>r?`平均客数 <b>${val(r.customers,'名')}</b><br>シェア ${val(r.share,'%')}<br>稼働率 ${val(r.util,'%')}`:'未取得';
 $('detailChartValues').innerHTML='<table class="store-matrix"><thead><tr><th>日付・期間</th>'+stores.map(store=>`<th>${esc(store)}</th>`).join('')+'</tr><tr class="period-average"><td><b>指定期間の平均</b><br>'+esc(rangeStart||'')+'〜'+esc(rangeEnd||'')+'</td>'+stores.map(store=>{const row=totals.find(r=>r.store===store);return `<td data-store="${esc(store)}">${metrics(row)}<br>取得 ${row?.days||0}日</td>`;}).join('')+'</tr></thead><tbody>'+dates.map(date=>{
  const sample=rows.find(r=>r.date===date),prior=comparisonDate(date,period==='month'?'month':period==='week'?'7':'1');
  return `<tr><td>${date}${sample?.periodEnd?'〜'+sample.periodEnd:''}<br>比較 ${prior||'なし'}</td>`+stores.map(store=>{
   const row=rows.find(r=>r.date===date&&r.store===store),prev=history.find(r=>r.date===prior&&r.store===store),d=compareRows(row,prev);
   return `<td data-store="${esc(store)}">${metrics(row)}<br>客数差 ${diff(d.customers,'名')}<br>シェア差 ${diff(d.share,'pt')}</td>`;
  }).join('')+'</tr>';
 }).join('')+'</tbody></table>';

 for(const [id,key,unit] of [['detailCustomers','customers','名'],['detailShare','share','%'],['detailUtil','util','%']]){
  $(id).setAttribute('aria-label',`${category} ${key} ${stores.length}店舗`);
  drawTrend($(id),{rows,dates,stores,colors,key,unit,target:TARGET,date:detailSelectedDate,wide:$('detailZoom').value==='wide',onDate:day=>{detailSelectedDate=day;renderDetailCharts();}});
 }
}
['detailCategory','detailTime','detailFrom','detailTo','detailPeriod','detailScope','detailZoom'].forEach(id=>bindChange($(id),()=>{if(id==='detailCategory')detailCategories[S.tab]=$(id).value;if(['detailFrom','detailTo'].includes(id))detailAutoRange=false;renderDetailCharts();}));
let chartDate='';
const chartHidden=new Set();
const chartColors=['#0f62fe','#c0392b','#15803d','#9333ea','#b45309','#0e7490','#be185d','#475569'];
function renderMarketSize(){
 const from=$('from').value,to=$('to').value,time=$('time').value?Number($('time').value):'average';
 const monthly=$('marketSizePeriod').value==='month';
 const months=uniq([...S.summaries,...S.records].filter(r=>(!from||r.date>=from)&&(!to||r.date<=to)).map(r=>r.date.slice(0,7)));
 const periods=monthly?months.map(month=>{const b=periodBounds(month+'-01','month');return {label:month,from:from&&from>b.start?from:b.start,to:to&&to<b.end?to:b.end};}):[{label:'range',from,to}];
 $('marketSizeContext').textContent=`${from||'開始日未指定'}〜${to||'終了日未指定'} / ${time==='average'?'11・15・19時平均':time+'時'} / ${monthly?'月ごとの平均':'期間平均'}・全店舗`;
 $('marketSizeRows').innerHTML=periods.map(period=>{
  const comparison=marketSizeComparison(S,{from:period.from,to:period.to,time});
  return `<tr><th colspan="3" style="text-align:left">${monthly?esc(period.label)+' / ':''}当期：${esc(comparison.from||'未指定')}〜${esc(comparison.to||'未指定')}<br><span class="small">前月比較：${esc(comparison.previousFrom||'未指定')}〜${esc(comparison.previousTo||'未指定')}</span></th></tr>`+comparison.rows.map(r=>{
   const delta=r.delta==null?`<span class="small">${esc(r.reason)}</span>`:`<span class="market-delta" style="color:${r.delta<0?'#c13d3d':'#172033'}">前月比 ${fmtDelta(r.delta)}名${r.changePercent==null?'':`（${fmtDelta(r.changePercent)}%）`}</span>`;
   return `<tr data-period="${esc(period.label)}" data-category="${esc(r.category)}"><td>${esc(r.category)}</td><td><b>${r.customers==null?'未取得':r.customers.toLocaleString('ja-JP')+'名'}</b><br>${delta}${r.previousCustomers==null?'':`<br><span class="small">前月 ${r.previousCustomers.toLocaleString('ja-JP')}名 / 集計 ${r.previousDays}日${r.delta!=null&&r.changePercent==null?' / 前月0名のため増減率なし':''}</span>`}</td><td class="small">集計 ${r.days}日 / ${r.storesMin===r.storesMax?r.storesMax:r.storesMin+'〜'+r.storesMax}店舗${r.unavailableDays?'<br>データ不足 '+r.unavailableDays+'日':''}</td></tr>`;
  }).join('');
 }).join('')||'<tr><td colspan="3">この期間のデータはありません。</td></tr>';
}
bindChange($('marketSizePeriod'),renderMarketSize);
function drawChart(){
 renderInsights();
 renderMarketSize();
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
 chartDate=dates.includes(chartDate)?chartDate:dates.at(-1)||'';
 $('averageTitle').textContent=`11・15・19時 平均（${periodLabel}・全店舗）`;
 renderDailyAverage(averages);
 renderMarketOverview(rows,{group,rate:group?'':rate,time:tm},average,period,timeLabel);
 renderTrendDetails(rows,selected,average?'average':tm);
 for(const [id,key,unit] of [['chart','customers','名'],['shareChart','share','%'],['utilChart','util','%']]){
  const canvas=$(id);
  canvas.setAttribute('aria-label',`${selected.length}店舗 ${timeLabel} ${group||rate||'店舗総合'} ${key==='customers'?'客数':key==='share'?'シェア':'稼働率'}推移`);
  drawTrend(canvas,{rows,dates,stores:selected,colors,key,unit,target:TARGET,date:chartDate,totalLabel:period!=='day'?'全店1日平均客数':average?'3回取得店の平均客数':'全店客数',wide:$('chartZoom').value==='wide',onDate:day=>{chartDate=day;drawChart();}});
 }
}

function renderMarketOverview(rows,filters,average,period,timeLabel){
 const day=chartDate,rawMarket=average?averageTrendRows(S,filters):trendRows(S,filters),current=rangeMode()?selectedRange(rawMarket):rows.filter(r=>r.date===day),all=periodTrendRows(average?averageTrendRows(S,filters):trendRows(S,filters),period);
 const dates=uniq(all.map(r=>r.date)),index=dates.indexOf(day);
 const controls=`<b>市場の動き</b><div class="field" style="margin-top:10px"><label for="marketDate">市場の表示日・期間（保存済みデータ）</label><select id="marketDate" ${dates.length?'':'disabled'}><option value="" disabled ${index<0?'selected':''}>表示する期間を選択</option>${dates.map(date=>`<option value="${date}" ${date===day?'selected':''}>${date}${period!=='day'?'〜'+periodBounds(date,period).end:''}</option>`).join('')}</select></div><div class="row" style="margin-top:8px"><button class="btn gray" data-market-shift="-1" ${index<=0?'disabled':''}>前へ</button><button class="btn gray" data-market-shift="1" ${index<0||index>=dates.length-1?'disabled':''}>次へ</button></div>`;
 if(!current.length){$('marketOverview').innerHTML=controls+'<p class="small">この条件のデータはありません。保存済みの期間を選ぶか、メール本文を取り込んでください。</p>';return;}
 const priorDate=comparisonDate(day,$('base').value,$('compareDate').value),prior=priorDate?periodBounds(priorDate,period).start:null;
 const snapshot=marketSnapshot(current,rangeMode()?selectedRange(rawMarket,true):all.filter(r=>r.date===prior),TARGET),own=snapshot.own;
 const format=(value,unit)=>Number.isFinite(value)?value.toLocaleString('ja-JP')+unit:'未取得';
 const change=(value,unit)=>value==null?'比較なし':(value>0?'+':'')+value+unit;
 const caption={'1':'前日','7':'前週','28':'4週前','month':'前月同日','custom':'指定日','range':'指定期間'}[$('base').value];
 const tiles=[['市場全体の客数'+(period!=='day'?'（1日平均）':average?'（3回平均）':''),format(snapshot.total,'名'),caption+' '+change(snapshot.totalDelta,'名')],['帯広店の客数',format(own?.customers,'名'),caption+' '+change(snapshot.ownCustomerDelta,'名')],['帯広店のシェア',format(own?.share,'%'),caption+' '+change(snapshot.ownShareDelta,'pt')],['帯広店の順位',snapshot.rank?snapshot.rank+'位 / '+snapshot.rankedStores+'店':'算出なし','報告 '+snapshot.reported+'店 / 集計 '+snapshot.validStores+'店']];
 const bounds=periodBounds(day,period),winning=current.filter(r=>r.store!==TARGET&&Number.isFinite(own?.share)&&r.share>own.share).sort((a,b)=>b.share-a.share);
 const events=winning.map(r=>{
  const text=uniq(S.summaries.filter(s=>s.store===r.store&&(r.coverageDates?r.coverageDates.includes(s.date):s.date===day)&&(average||s.time===filters.time)).map(s=>s.event?(period==='day'?'':s.date+' ')+s.event:'').filter(Boolean)).join(' / ');
  return `<div><b>${esc(r.store)} ${format(r.share,'%')}</b><br>${text?esc(text):'イベント記載なし・未取得'}</div>`;
 }).join('');
 $('marketOverview').innerHTML=`${controls}<p class="small">${rangeMode()?$('from').value+'〜'+$('to').value+' / 期間平均':day+(period!=='day'?'〜'+bounds.end:'')} / ${timeLabel} / ${esc(filters.group||filters.rate||'店舗総合')}<br>比較：${rangeMode()?$('compareDate').value+'〜'+$('compareEnd').value:(prior||'未指定')+(prior&&period!=='day'?'〜'+periodBounds(prior,period).end:'')}</p><div class="market-kpis">${tiles.map(([label,value,note])=>`<div class="kpi"><div class="l">${label}</div><div class="v">${value}</div><div class="small">${note}</div></div>`).join('')}</div><div class="market-note">${snapshot.leader?'シェア首位：<b>'+esc(snapshot.leader.store)+' '+format(snapshot.leader.share,'%')+'</b><br>':''}${events?'帯広店を上回る競合とイベント：'+events:'帯広店を上回る報告店舗はありません。帯広店データ未取得の場合は比較できません。'}${!snapshot.comparable?'<p class="small">比較データ未取得、または報告店舗・取得日が異なるため、市場客数とシェアの増減は比較しません。</p>':''}</div>`;
}
bindChange($('marketOverview'),event=>{
 if(event.target.id!=='marketDate'||!event.target.value)return;
 const day=event.target.value,bounds=periodBounds(day,$('chartPeriod').value);
 if(!$('from').value||$('from').value>bounds.start)$('from').value=bounds.start;
 if(!$('to').value||$('to').value<bounds.end)$('to').value=bounds.end;
 autoRange=false;
 chartDate=day;renderLatestCompare();renderRateCompare();renderRanking();renderTable();drawChart();
});
$('marketOverview').addEventListener('click',event=>{
 const button=event.target.closest('[data-market-shift]');if(!button||button.disabled)return;
 const select=$('marketDate'),dates=[...select.options].map(option=>option.value).filter(Boolean),index=dates.indexOf(select.value),next=index+Number(button.dataset.marketShift);
 if(next<0||next>=dates.length)return;select.value=dates[next];select.dispatchEvent(new Event('change',{bubbles:true}));
});
function renderDailyAverage(rows){
 const day=chartDate||rows.map(r=>r.date).sort().at(-1);
 const current=rows.filter(r=>r.date===day);
 $('dailyAverage').innerHTML=current.length?'<table><thead><tr><th>日付 / 店舗</th><th>平均客数</th><th>平均稼働率</th><th>平均シェア</th></tr></thead><tbody>'+current.map(r=>`<tr><td>${r.date}${r.periodEnd?'〜'+r.periodEnd:''}<br>${esc(r.store)}${r.days!=null?'<br>'+r.days+'日分 / 期間内'+r.periodDays+'取得日':''}</td><td>${r.complete?r.customers+'名':'3回分未取得（'+r.hours.join('・')+'時のみ）'}</td><td>${r.util==null?'-':r.util+'%'}</td><td>${r.share==null?'-':r.share+'%'}</td></tr>`).join('')+'</tbody></table>':'<p>データなし</p>';
}
function renderTrendDetails(rows,selected,time){
 const latest=chartDate;
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
['chartZoom','chartPeriod'].forEach(id=>bindChange($(id),drawChart));
bindChange($('chartAggregation'),()=>selectTime($('chartAggregation').value==='average'?'':$('time').value||'11'));
bindChange($('chartGroup'),drawChart);
bindChange($('chartStores'),event=>{const el=event.target;if(!el.matches('input[data-store]'))return;if(el.checked)chartHidden.delete(el.dataset.store);else chartHidden.add(el.dataset.store);drawChart();});
function csvEscape(v){v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function exportCsv(){const type=S.tab,rows=detailRows(type);if(!rows.length){alert('出力するデータがありません');return}let cols=type==='records'?[['date','日付'],['time','時間'],['store','店舗'],['rate','貸玉'],['machines','台数'],['male','男性'],['female','女性'],['customers','客数'],['util','稼働率%'],['share','客数シェア%']]:type==='summary'?[['date','日付'],['time','時間'],['store','店舗'],['storeTotal','総台数'],['customers','客数'],['util','稼働率%'],['share','客数シェア%'],['event','イベント']]:[['date','日付'],['time','時間'],['store','店舗'],['group','機種群'],['machines','台数'],['customers','客数'],['util','稼働率%']];const csv='\ufeff'+cols.map(x=>x[1]).join(',')+'\n'+rows.map(r=>cols.map(c=>csvEscape(r[c[0]])).join(',')).join('\n');download(new Blob([csv],{type:'text/csv;charset=utf-8'}),`帯広店_稼働メール_${type}_${new Date().toISOString().slice(0,10)}.csv`)}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

async function loadFiles(files){
 if(!files.length)return;await initialized;let added=0,total=0,duplicates=0,errors=[],csvNotes=[];$('status').textContent='読み込み中…';
 await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
 for(const f of files){
  try{if(f.size>20*1024*1024)throw Error('20MBを超えています');
   if(/\.csv$/i.test(f.name)){
    const report=decodeSurveyCsv(await f.arrayBuffer()),merged=mergeCsvReport(S,report);
    for(const kind of ['summaries','records','specials'])S[kind]=merged[kind];
    csvNotes.push(`CSV ${report.sourceRows.toLocaleString()}行 / ${report.dates.length}日 / ${report.stores.length}店舗 / ${report.encoding}${report.missingCounts?' / 客数空欄 '+report.missingCounts+'件（未取得）':''}`);continue;
   }
   const r=await decodeVmg(await f.arrayBuffer());added+=r.emails;duplicates+=r.duplicates;total+=r.totalChunks;
   const id=crypto.randomUUID();S.pendingVMG.push({id,raw:r.raw});
  }catch(e){errors.push(`${f.name}: ${e.message}`);}
 }
 updateAll();await saveState();$('status').textContent=`読み込み完了：${files.length}ファイル${csvNotes.length?' / '+csvNotes.join(' / '):''} / 新規メール ${added}通 / 重複 ${duplicates}通 / VMG内 ${total}通${errors.length?' / 失敗: '+errors.join(', '):''}`;
 if(navigator.onLine&&S.connectionMode==='server')await connectApi();
}
function backup(){const data={version:2,exportedAt:new Date().toISOString(),records:S.records,summaries:S.summaries,specials:S.specials,mailKeys:[...S.mailKeys],emails:S.emails,pendingVMG:S.pendingVMG,pendingEmails:S.pendingEmails,connectionMode:S.connectionMode,syncSnapshot:S.syncSnapshot};download(new Blob([JSON.stringify(data)],{type:'application/json'}),`帯広店_稼働分析_バックアップ_${new Date().toISOString().slice(0,10)}.json`);}
async function restore(file){
 try{await initialized;if(file.size>100*1024*1024)throw Error();const d=JSON.parse(await file.text());if(!Array.isArray(d.summaries)||!Array.isArray(d.records)||!Array.isArray(d.specials))throw Error();useSaved(d);await saveState();updateAll();$('status').textContent='バックアップを復元しました。';}
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
const drop=$('drop'),file=$('file');drop.onclick=()=>file.click();file.onchange=async e=>{await loadFiles([...e.target.files]);file.value='';};['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>loadFiles([...e.dataTransfer.files]));
['from','to','time','store','rate','base','compareDate','compareEnd'].forEach(id=>bindChange($(id),()=>{if(['from','to'].includes(id))autoRange=false;if(id==='time'){selectTime($('time').value);return;}if(id==='compareDate')$('base').value=$('compareEnd').value?'range':'custom';if(id==='compareEnd')$('base').value='range';if(id==='base'&&!['custom','range'].includes($('base').value)){$('compareDate').value='';$('compareEnd').value='';}renderLatestCompare();renderRateCompare();renderRanking();renderTable();drawChart()}));
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.tab=b.dataset.tab;renderTable()});
['summaryAggregation','summaryHour','summaryScope'].forEach(id=>bindChange($(id),renderTable));
$('csvBtn').onclick=exportCsv;$('backupBtn').onclick=backup;$('restoreBtn').onclick=()=>$('restoreFile').click();$('restoreFile').onchange=e=>e.target.files[0]&&restore(e.target.files[0]);$('clearBtn').onclick=async()=>{if(confirm('この端末のデータと未送信VMGをクリアしますか？サーバーのデータは削除されません。')){S.records=[];S.summaries=[];S.specials=[];S.mailKeys.clear();S.emails=0;S.pendingVMG=[];S.pendingEmails=[];autoRange=true;$('from').value='';$('to').value='';await saveState();updateAll();$('status').textContent='データをクリアしました。'}};
document.querySelectorAll('.bottomnav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.bottomnav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.getElementById(b.dataset.target).scrollIntoView({behavior:'smooth',block:'start'})});
let deferredPrompt=null;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBanner').classList.add('show')});$('installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBanner').classList.remove('show')}};$('installClose').onclick=()=>$('installBanner').classList.remove('show');
if('serviceWorker'in navigator){const updating=Boolean(navigator.serviceWorker.controller);navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updating)$('appUpdate').hidden=false;});}
$('applyUpdate').onclick=()=>location.reload();
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
window.addEventListener('resize',()=>{drawChart();renderDetailCharts();});
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

function renderInsights(){
 const result=marketInsights(S,{target:TARGET,from:$('from').value,to:$('to').value,time:$('time').value||'average',mode:$('insightMode').value});
 if(!result){$('insightContent').textContent='データを取り込むと市場の要約を表示します。';return;}
 const num=v=>Number.isFinite(v)?Math.abs(v).toLocaleString('ja-JP',{maximumFractionDigits:1}):'—';
 const delta=(v,unit)=>Number.isFinite(v)?`<span class="${v<0?'delta-down':'delta-up'}">${v<0?'↓ −':v>0?'↑ ＋':'±'}${num(v)}${unit}</span>`:'比較不可';
 const metric=r=>`客数 ${num(r.customers)}人 / ${delta(r.customerDelta,'人')}<br>シェア ${Number.isFinite(r.share)?num(r.share)+'%':'—'} / ${delta(r.shareDelta,'pt')}`;
 const total=result.scopes[0],own=total.rows.find(r=>r.store===TARGET),leader=total.rows.filter(r=>r.store!==TARGET&&r.customerDelta>0).sort((a,b)=>b.customerDelta-a.customerDelta)[0];
 const stores=[...new Set([...result.stores,...result.scopes.flatMap(s=>s.rows.map(r=>r.store))])].sort((a,b)=>a===TARGET?-1:b===TARGET?1:a.localeCompare(b,'ja'));
 const jump=(category,store,group=false)=>`<button class="insight-link" data-insight-category="${esc(category)}" data-insight-store="${esc(store)}" data-insight-group="${group?'yes':'no'}">グラフを見る</button>`;
 $('insightContent').innerHTML=`<p class="small">対象：${result.start}〜${result.latest} / ${$('time').value?$('time').value+'時':'11・15・19時平均'}<br>比較：${result.previousLabel}<br>上の要約と下の一覧は全店舗・全種別が対象です。開始日・終了日・時間の指定に連動します。</p>
 <div class="market-note"><b>市場の動き</b><br>${total.comparable?`市場の平均客数は ${num(total.total)}人、比較期間から ${delta(total.delta,'人')}。<br>${own?`帯広店は ${metric(own)}。`: '帯広店のデータなし。'}${leader?`<br>客数増加が最大の競合：<b>${esc(leader.store)}</b> ${delta(leader.customerDelta,'人')}`:''}`:'同じ報告店舗で比較できるデータがありません。'}<br>集計日数：対象 ${total.currentDays}日 / 比較 ${total.previousDays}日</div>
 <h3>店舗×種別の増減</h3><p class="small">右へスクロールできます。↑増加は黒字、↓減少は赤字。各種別のシェアは、その種別の報告店舗全体から計算します。</p>
 <div class="scroll"><table class="insight-matrix"><thead><tr><th>種別</th>${stores.map(s=>`<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>${result.scopes.map(scope=>`<tr><th>${esc(scope.category)}<br><small>${scope.currentDays}日 / ${scope.previousDays}日</small></th>${stores.map(store=>{const r=scope.rows.find(r=>r.store===store);return `<td>${r?metric(r)+'<br>'+jump(scope.category,store):'比較不可'}</td>`}).join('')}</tr>`).join('')}</tbody></table></div>
 <h3>帯広店の優先確認</h3><p class="small">平均客数の減少が大きい順。貸玉種別と注目機種群は重なるため合算しません。</p>${result.priorities.length?result.priorities.slice(0,8).map((r,i)=>`<div class="monthly-rate-change"><b>${i+1}. ${esc(r.category)}</b>（${r.kind}）<br>${num(r.previousCustomers)}人 → ${num(r.customers)}人 / ${delta(r.customerDelta,'人')}<br>シェア差 ${delta(r.shareDelta,'pt')} ${jump(r.category,TARGET,r.kind==='注目機種群')}</div>`).join(''):'比較できるデータで客数が減った種別・機種群はありません。'}
 <h3>競合の増加日とイベント</h3><p class="small">対象期間内の各日を直近4週間の同じ曜日と比較。イベント記載がある増加日の上位5件です。イベントが増加の原因とは断定しません。</p>${result.eventGains.length?result.eventGains.map(r=>`<div class="monthly-rate-change"><b>${esc(r.store)} / ${r.date}</b><br>${metric(r)}<br>比較 ${r.previousDays}日平均<br>${esc(r.events.join(' / '))}${r.rates.map(v=>`<p>${esc(v.category)}：${metric(v)}</p>`).join('')}</div>`).join(''):'比較可能な増加日とイベントの組み合わせはありません。'}
 <p class="small">取得できた日の平均で比較します（月途中は途中まで）。同じ報告店舗・指定時間のデータがそろわない場合は比較不可。曜日比較は過去4回のうち取得できた日を使用し、日数を表示します。</p>`;
}
bindChange($('insightMode'),renderInsights);
$('insightContent').addEventListener('click',event=>{
 const button=event.target.closest('[data-insight-category]');if(!button)return;
 $('store').value=button.dataset.insightStore;
 $('chartGroup').value=button.dataset.insightGroup==='yes'?button.dataset.insightCategory:'';
 $('rate').value=button.dataset.insightGroup==='yes'||button.dataset.insightCategory==='全種別'?'':button.dataset.insightCategory;
 renderLatestCompare();renderRateCompare();renderRanking();renderTable();drawChart();
 $('chartGroup').scrollIntoView({behavior:'smooth',block:'center'});
});
