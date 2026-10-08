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
