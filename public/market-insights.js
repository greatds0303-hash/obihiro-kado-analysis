import {averageTrendRows,trendRows,rateCategory,periodBounds,capacityStats} from './analysis.js';
const shift=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const mean=rows=>rows.reduce((s,r)=>s+r.customers,0)/rows.length;
// Compare complete snapshots with an identical reporting cohort; missing data is never zero.
function compareScope(rows,currentDates,previousDates){
 const buckets=new Map();for(const r of rows){if(!buckets.has(r.date))buckets.set(r.date,[]);buckets.get(r.date).push(r)}
 const current=currentDates.map(d=>buckets.get(d)).filter(Boolean),previous=previousDates.map(d=>buckets.get(d)).filter(Boolean);
 const signature=rs=>rs.every(r=>Number.isFinite(r.customers))?rs.map(r=>r.store).sort().join('\u0000'):null;
 const sig=current.length?signature(current[0]):null;
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
 const currentDates=mode==='weekday'?[latest]:dates.filter(d=>d>=start);
 const previousDates=mode==='weekday'?[7,14,21,28].map(n=>shift(latest,-n)):[...new Set((data.summaries||[]).map(r=>r.date).filter(d=>d>=priorBounds.start&&d<=priorBounds.end))].sort();
 const daily=options=>time==='average'?averageTrendRows(data,options):trendRows(data,{...options,time:Number(time)});
 const categories=[...new Set((data.records||[]).map(r=>rateCategory(r.rate)))].sort();
 const scopes=[{category:'全種別',...compareScope(daily({}),currentDates,previousDates)},...categories.map(category=>({category,...compareScope(daily({rate:category}),currentDates,previousDates)}))];
 const priorities=scopes.slice(1).map(s=>({...s.rows.find(r=>r.store===target),category:s.category,kind:'貸玉種別'})).filter(r=>r.customerDelta<0);
 const groups=[...new Set((data.specials||[]).filter(r=>r.store===target&&r.dataSource!=='csv').map(r=>r.group))];
 for(const group of groups){const s=compareScope(daily({group}),currentDates,previousDates),r=s.rows.find(r=>r.store===target);if(r?.customerDelta<0)priorities.push({...r,category:group,kind:'注目機種群'})}
 priorities.sort((a,b)=>a.customerDelta-b.customerDelta);
 // Daily competitor increases versus the preceding four same weekdays; event dates are exact.
 const eventGains=[];const overallDaily=daily({});const scopedDaily=new Map(categories.map(category=>[category,daily({rate:category})]));
 for(const date of currentDates){const previous=[7,14,21,28].map(n=>shift(date,-n)),s=compareScope(overallDaily,[date],previous);
  for(const r of s.rows.filter(r=>r.store!==target&&r.customerDelta>0)){
   const events=[...new Set((data.summaries||[]).filter(x=>x.store===r.store&&x.date===date&&(time==='average'||x.time===Number(time))).map(x=>x.event).filter(Boolean))];
   if(events.length){const rates=categories.flatMap(category=>{const v=compareScope(scopedDaily.get(category),[date],previous).rows.find(x=>x.store===r.store);return v?.customerDelta>0?[{...v,category}]:[]});eventGains.push({...r,date,events,rates,previousDays:s.previousDays})}
  }
 }
 eventGains.sort((a,b)=>b.customerDelta-a.customerDelta);
 return {latest,start:mode==='weekday'?latest:start,mode,previousLabel:mode==='weekday'?previousDates.slice().sort().join('・'):priorBounds.start+'〜'+priorBounds.end,scopes,priorities,eventGains:eventGains.slice(0,5),stores:[...new Set((data.summaries||[]).filter(r=>currentDates.includes(r.date)).map(r=>r.store))]};
}
