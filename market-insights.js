import {averageTrendRows,trendRows,rateCategory,periodBounds,capacityStats} from './analysis.js';
const shift=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const mean=rows=>rows.reduce((s,r)=>s+r.customers,0)/rows.length;
// Compare complete snapshots with an identical reporting cohort; missing data is never zero.
function compareScope(rows,currentDates,previousDates,paired=false){
 const buckets=new Map();for(const r of rows){if(!buckets.has(r.date))buckets.set(r.date,[]);buckets.get(r.date).push(r)}
 const signature=rs=>rs?.length&&rs.every(r=>Number.isFinite(r.customers))?JSON.stringify(rs.map(r=>r.store).sort()):null;
 let current=currentDates.map(d=>buckets.get(d)).filter(Boolean),previous=previousDates.map(d=>buckets.get(d)).filter(Boolean);
 if(paired){
  const cohorts=new Map();
  currentDates.forEach((date,index)=>{
   const now=buckets.get(date),prior=buckets.get(previousDates[index]),signatureNow=signature(now);
   if(!signatureNow||signatureNow!==signature(prior))return;
   if(!cohorts.has(signatureNow))cohorts.set(signatureNow,{current:[],previous:[]});
   const cohort=cohorts.get(signatureNow);
   cohort.current.push(now);
   cohort.previous.push(prior);
  });
  // Keep the most widely covered fixed roster, preferring more stores on ties.
  const [cohort]=[...cohorts.values()].sort((a,b)=>b.current.length-a.current.length||b.current[0].length-a.current[0].length);
  current=cohort?.current||[];
  previous=cohort?.previous||[];
 }
 const sig=signature(current[0]);
 if(!sig||!previous.length||[...current,...previous].some(rs=>signature(rs)!==sig))return {rows:[],comparable:false,currentDays:current.length,previousDays:previous.length};
 const totals=sets=>sets.map(rs=>({customers:rs.reduce((n,r)=>n+r.customers,0)}));
 const total=mean(totals(current)),priorTotal=mean(totals(previous));
 return {comparable:true,currentDays:current.length,previousDays:previous.length,total,priorTotal,delta:total-priorTotal,rows:current[0].map(({store})=>{
  const customers=mean(current.map(rs=>rs.find(r=>r.store===store))),prior=mean(previous.map(rs=>rs.find(r=>r.store===store)));
  const share=total>0?customers/total*100:null,priorShare=priorTotal>0?prior/priorTotal*100:null;
  const own=current.map(rs=>rs.find(r=>r.store===store)),prev=previous.map(rs=>rs.find(r=>r.store===store));
  const machines=capacityStats(own).machines,previousMachines=capacityStats(prev).machines,util=machines>0?customers/machines*100:null,previousUtil=previousMachines>0?prior/previousMachines*100:null;
  return {store,machines,previousMachines,machineDelta:machines!==null&&previousMachines!==null?machines-previousMachines:null,util,utilDelta:util!==null&&previousUtil!==null?util-previousUtil:null,customers,previousCustomers:prior,customerDelta:customers-prior,share,shareDelta:share!==null&&priorShare!==null?share-priorShare:null};
 })};
}
export function marketInsights(data,{target,from='',to='',time='average',mode='month'}={}){
 const dates=[...new Set((data.summaries||[]).map(r=>r.date).filter(d=>(!from||d>=from)&&(!to||d<=to)))].sort(),latest=dates.at(-1);
 if(!latest)return null;
 const bounds=periodBounds(latest,'month'),priorBounds=periodBounds(shift(bounds.start,-1),'month');
 const start=from>bounds.start?from:bounds.start;
 const singleDay=['day','week','weekday'].includes(mode);
 const offsets=mode==='day'?[1]:mode==='week'?[7]:[7,14,21,28];
 const priorDate=date=>priorBounds.start.slice(0,8)+date.slice(8);
 const lastSharedDay=bounds.start.slice(0,8)+priorBounds.end.slice(8);
 const end=!singleDay&&latest>lastSharedDay?lastSharedDay:latest;
 const hasSharedRange=end>=start;
 const currentDates=singleDay?[latest]:dates.filter(d=>d>=start&&d<=end);
 const previousDates=singleDay?offsets.map(n=>shift(latest,-n)):currentDates.map(priorDate);
 const previousLabel=singleDay?previousDates.slice().sort().join('・'):hasSharedRange?priorDate(start)+'〜'+priorDate(end):'該当日なし';
 const compare=rows=>compareScope(rows,currentDates,previousDates,!singleDay);
 const daily=options=>time==='average'?averageTrendRows(data,options):trendRows(data,{...options,time:Number(time)});
 const categories=[...new Set((data.records||[]).map(r=>rateCategory(r.rate)))].sort();
 const scopes=[{category:'全種別',...compare(daily({}))},...categories.map(category=>({category,...compare(daily({rate:category}))}))];
 const priorities=scopes.slice(1).map(s=>({...s.rows.find(r=>r.store===target),category:s.category,kind:'貸玉種別'})).filter(r=>r.customerDelta<0);
 const groups=[...new Set((data.specials||[]).filter(r=>r.store===target&&r.dataSource!=='csv').map(r=>r.group))];
 for(const group of groups){const s=compare(daily({group})),r=s.rows.find(r=>r.store===target);if(r?.customerDelta<0)priorities.push({...r,category:group,kind:'注目機種群'})}
 priorities.sort((a,b)=>a.customerDelta-b.customerDelta);
 // Event comparisons follow day/week mode; monthly and four-week modes use four same weekdays.
 const eventGains=[];const overallDaily=daily({});const scopedDaily=new Map(categories.map(category=>[category,daily({rate:category})]));
 for(const date of currentDates){const previous=offsets.map(n=>shift(date,-n)),s=compareScope(overallDaily,[date],previous);
  for(const r of s.rows.filter(r=>r.store!==target&&r.customerDelta>0)){
   const events=[...new Set((data.summaries||[]).filter(x=>x.store===r.store&&x.date===date&&(time==='average'||x.time===Number(time))).map(x=>x.event).filter(Boolean))];
   if(events.length){const rates=categories.flatMap(category=>{const v=compareScope(scopedDaily.get(category),[date],previous).rows.find(x=>x.store===r.store);return v?.customerDelta>0?[{...v,category}]:[]});eventGains.push({...r,date,events,rates,previousDays:s.previousDays})}
  }
 }
 eventGains.sort((a,b)=>b.customerDelta-a.customerDelta);
 return {start:singleDay?latest:start,end:hasSharedRange?end:latest,mode,eventComparison:mode==='day'?'前日':mode==='week'?'前週の同じ曜日':'直近4週間の同じ曜日',previousLabel,scopes,priorities,eventGains:eventGains.slice(0,5),stores:[...new Set((data.summaries||[]).filter(r=>currentDates.includes(r.date)).map(r=>r.store))]};
}
