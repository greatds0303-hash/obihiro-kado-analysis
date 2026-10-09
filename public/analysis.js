export function comparisonDate(date,period){
 const d=new Date(`${date}T00:00:00Z`);
 if(!Number.isFinite(d.getTime()))return null;
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
 const match=String(rate).normalize('NFKC').replace(/\s+/g,'').match(/^(\d+(?:\.\d+)?)円?S$/i);
 if(!match)return rate;const price=Number(match[1]);
 if(price>=5&&price<=6.25)return '5スロ';
 if([12.5,20].includes(price))return '20スロ';
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
