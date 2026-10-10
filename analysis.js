export function comparisonDate(date,period,customDate=''){
 const d=new Date(`${date}T00:00:00Z`);
 if(!Number.isFinite(d.getTime()))return null;
 if(period==='custom'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(customDate))return null;
  const selected=new Date(`${customDate}T00:00:00Z`);return Number.isFinite(selected.getTime())&&selected.toISOString().slice(0,10)===customDate?customDate:null;
 }
 if(period==='month'){
  const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);
  const month=d.getUTCMonth();d.setUTCDate(day);if(d.getUTCMonth()!==month)return null;
 }else{const days=Number(period);if(![1,7,28].includes(days))return null;d.setUTCDate(d.getUTCDate()-days);}
 return d.toISOString().slice(0,10);
}
export function compareRows(current,previous){
 const delta=key=>current?.[key]!=null&&previous?.[key]!=null?Math.round((current[key]-previous[key])*10)/10:null;
 return {customers:delta('customers'),util:delta('util'),share:delta('share')};
}
export function mergeRows(local,incoming,kind){
 const key=r=>JSON.stringify([r.date,r.time,r.store,kind==='records'?r.rate:kind==='specials'?r.group:'']);
 const rows=new Map();for(const r of [...local,...incoming])rows.set(key(r),r);
 return [...rows.values()];
}
export function rateCategory(rate){
 const match=String(rate).normalize('NFKC').replace(/\s+/g,'').match(/^(\d+(?:\.\d+)?)円?([PS])$/i);
 if(!match)return rate==='20スロ'?'20S':rate;const price=Number(match[1]),kind=match[2].toUpperCase();
 if(kind==='P'){
  if([0.25,0.56].includes(price))return '0.56P';
  if(price>=1&&price<=1.25)return '1パチ';
  if(price>=2.5&&price<=4.5)return '4パチ';
 }else{
  if(price>=5&&price<=6.25)return '5スロ';
  if([11.24,11.25,12.5,20,21.73,21.74].includes(price))return '20S';
 }
 return rate;
}
export function trendRows(data,{group='',rate='',time=11,from='',to=''}={}){
 const source=(group?data.specials:rate?data.records:data.summaries)||[];
 const buckets=new Map();
 for(const row of source){
  if(row.time!==time||(from&&row.date<from)||(to&&row.date>to)||(group&&row.group!==group)||(rate&&rateCategory(row.rate)!==rate))continue;
  const key=JSON.stringify([row.date,row.time,row.store]);
  if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(row);
 }
 const result=[...buckets.values()].map(rows=>{
  if(rows.length===1)return {...rows[0]};
  const customers=rows.reduce((sum,r)=>sum+r.customers,0),machines=rows.every(r=>Number.isFinite(r.machines))?rows.reduce((sum,r)=>sum+r.machines,0):null;
  return {...rows[0],customers,machines,util:machines>0?Math.round(customers/machines*1000)/10:null,share:null};
 });
 const totals=new Map();for(const row of result){const key=JSON.stringify([row.date,row.time]);totals.set(key,(totals.get(key)||0)+row.customers);}
 return result.map(row=>{const total=totals.get(JSON.stringify([row.date,row.time]));return {...row,share:total>0?Math.round(row.customers/total*1000)/10:null,shareSource:'calculated'};});
}

export function averageTrendRows(data,filters={}){
 const buckets=new Map();
 for(const time of [11,15,19])for(const row of trendRows(data,{...filters,time})){
  const key=JSON.stringify([row.date,row.store]);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(row);
 }
 return [...buckets.values()].map(rows=>{
  const hours=rows.map(r=>r.time).sort((a,b)=>a-b),complete=hours.length===3;
  const mean=key=>complete&&rows.every(r=>Number.isFinite(r[key]))?Math.round(rows.reduce((sum,r)=>sum+r[key],0)/3*10)/10:null;
  return {...rows[0],time:'average',hours,complete,customers:mean('customers'),util:mean('util'),share:mean('share'),shareSource:'calculated'};
 });
}
export function periodBounds(date,period){
 const start=new Date(`${date}T00:00:00Z`);if(!Number.isFinite(start.getTime()))return null;
 if(period==='week')start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
 if(period==='month')start.setUTCDate(1);
 const end=new Date(start);
 if(period==='week')end.setUTCDate(end.getUTCDate()+6);
 if(period==='month'){end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);}
 return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}
export function periodTrendRows(rows,period='day'){
 if(period==='day')return rows;
 const buckets=new Map(),markets=new Map();
 for(const row of rows){
  const bounds=periodBounds(row.date,period);if(!bounds)continue;
  const key=JSON.stringify([bounds.start,row.store]);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(row);
  if(!markets.has(bounds.start))markets.set(bounds.start,{sum:0,dates:new Set()});
  if(Number.isFinite(row.customers)){const market=markets.get(bounds.start);market.sum+=row.customers;market.dates.add(row.date);}
 }
 return [...buckets.values()].map(source=>{
  const bounds=periodBounds(source[0].date,period),valid=source.filter(r=>Number.isFinite(r.customers)),market=markets.get(bounds.start);
  const sum=valid.reduce((n,r)=>n+r.customers,0),mean=key=>{const values=valid.map(r=>r[key]).filter(Number.isFinite);return values.length?Math.round(values.reduce((n,v)=>n+v,0)/values.length*10)/10:null;};
  return {...source[0],date:bounds.start,periodEnd:bounds.end,period,days:valid.length,reportedDays:source.length,coverageDates:valid.map(r=>r.date).sort(),periodDays:market.dates.size,complete:valid.length>0,customers:mean('customers'),util:mean('util'),share:valid.length&&market.sum>0?Math.round(sum/market.sum*1000)/10:null,shareSource:'calculated',marketTotal:market.dates.size?Math.round(market.sum/market.dates.size*10)/10:null};
 });
}
export function marketSnapshot(current,previous,target){
 const total=rows=>{if(!rows.some(r=>Number.isFinite(r.customers)))return null;const preset=rows.find(r=>Number.isFinite(r.marketTotal));return preset?preset.marketTotal:Math.round(rows.filter(r=>Number.isFinite(r.customers)).reduce((sum,r)=>sum+r.customers,0)*10)/10;};
 const coverage=r=>{
  const offsets=r.coverageDates?.map(day=>Math.round((Date.parse(day)-Date.parse(r.date))/86400000)).sort((a,b)=>a-b)||[];
  const fullDays=r.periodEnd?Math.round((Date.parse(r.periodEnd)-Date.parse(r.date))/86400000)+1:0;
  return r.period==='month'&&offsets.length===fullDays&&offsets.every((offset,i)=>offset===i)?'full-month':offsets;
 };
 const signature=rows=>JSON.stringify(rows.map(r=>[r.store,r.complete??true,r.hours||[],coverage(r)]).sort((a,b)=>a[0].localeCompare(b[0])));
 const comparable=previous.length>0&&signature(current)===signature(previous);
 const own=current.find(r=>r.store===target),prevOwn=previous.find(r=>r.store===target);
 const ranked=current.filter(r=>Number.isFinite(r.share)).sort((a,b)=>b.share-a.share);
 const delta=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?Math.round((a-b)*10)/10:null;
 return {total:total(current),totalDelta:comparable?delta(total(current),total(previous)):null,own,ownCustomerDelta:own&&prevOwn&&signature([own])===signature([prevOwn])?delta(own.customers,prevOwn.customers):null,ownShareDelta:comparable?delta(own?.share,prevOwn?.share):null,rank:Number.isFinite(own?.share)?ranked.filter(r=>r.share>own.share).length+1:null,leader:ranked[0]||null,reported:current.length,validStores:current.filter(r=>Number.isFinite(r.customers)).length,rankedStores:ranked.length,comparable};
}

export function rangeTrendRows(rows,from,to){
 if(!comparisonDate(from,'custom',from)||!comparisonDate(to,'custom',to)||from>to)return [];
 const source=rows.filter(r=>r.date>=from&&r.date<=to),buckets=new Map(),days=new Set();
 let marketSum=0;
 for(const r of source){const key=JSON.stringify([r.store,r.time,r.rate||'']);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);if(Number.isFinite(r.customers)){marketSum+=r.customers;days.add(r.date);}}
 return [...buckets.values()].map(group=>{
  const valid=group.filter(r=>Number.isFinite(r.customers)),sum=valid.reduce((n,r)=>n+r.customers,0);
  const mean=key=>{const values=valid.map(r=>r[key]).filter(Number.isFinite);return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10:null;};
  return {...group[0],date:from,periodEnd:to,period:'range',customers:mean('customers'),util:mean('util'),share:valid.length&&marketSum>0?Math.round(sum/marketSum*1000)/10:null,days:valid.length,reportedDays:group.length,coverageDates:valid.map(r=>r.date).sort(),periodDays:days.size,marketTotal:days.size?Math.round(marketSum/days.size*10)/10:null};
 });
}

export function shareDeclineAlerts(data,{target,time='average'}={}){
 const latest=[...(data.summaries||[]),...(data.records||[]),...(data.specials||[])].map(r=>r.date).filter(date=>comparisonDate(date,'custom',date)).sort().at(-1);
 if(!latest)return {latest:null,dates:[],alerts:[],unavailable:[],checked:0};
 const yesterday=comparisonDate(latest,'1'),dates=[comparisonDate(yesterday,'1'),yesterday,latest],hours=time==='average'?[11,15,19]:[Number(time)],alerts=[],unavailable=[];
 const categories=[...new Set((data.records||[]).filter(r=>r.store===target).map(r=>rateCategory(r.rate)))].map(name=>({kind:'貸玉種別',name,filters:{rate:name}}));
 const groups=[...new Set((data.specials||[]).filter(r=>r.store===target).map(r=>r.group))].map(name=>({kind:'機種群',name,filters:{group:name}}));
 let checked=0;
 for(const item of [...categories,...groups]){
  const samples=hours.map(hour=>trendRows(data,{...item.filters,time:hour,from:dates[0],to:latest}));
  const cohorts=dates.map(date=>JSON.stringify(samples.map(rows=>rows.filter(r=>r.date===date&&Number.isFinite(r.customers)).map(r=>r.store).sort())));
  const enough=samples.every(rows=>dates.every(date=>rows.filter(r=>r.date===date&&Number.isFinite(r.customers)).length>=2&&rows.some(r=>r.date===date&&r.store===target&&Number.isFinite(r.share))));
  if(!enough){unavailable.push({...item,reason:'3日分の自店・競合データが不足'});continue;}
  if(!cohorts.every(value=>value===cohorts[0])){unavailable.push({...item,reason:'日ごとに報告店舗が異なる'});continue;}
  const shares=dates.map(date=>samples.reduce((sum,rows)=>sum+rows.find(r=>r.date===date&&r.store===target).share,0)/hours.length).map(v=>Math.round(v*10)/10);
  checked++;
  if(shares[0]>shares[1]&&shares[1]>shares[2])alerts.push({kind:item.kind,name:item.name,dates,shares,drop:Math.round((shares[0]-shares[2])*10)/10});
 }
 alerts.sort((a,b)=>b.drop-a.drop||a.name.localeCompare(b.name,'ja'));
 return {latest,dates,alerts,unavailable,checked};
}
