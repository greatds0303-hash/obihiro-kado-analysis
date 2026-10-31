import {averageTrendRows,trendRows} from './analysis.js';
export function weekdayCustomers(data,{from='',to='',time='average',rate=''}={}){
 const filters={from,to,rate},rows=time==='average'?averageTrendRows(data,filters):trendRows(data,{...filters,time:Number(time)}),stores=new Map();
 for(const row of rows){
  if(!stores.has(row.store))stores.set(row.store,Array.from({length:7},()=>({sum:0,count:0,missing:0})));
  const day=(new Date(row.date+'T00:00:00Z').getUTCDay()+6)%7;if(!Number.isInteger(day))continue;
  const bucket=stores.get(row.store)[day];if(Number.isFinite(row.customers)){bucket.sum+=row.customers;bucket.count++}else bucket.missing++;
 }
 return [...stores].map(([store,buckets])=>{
  const days=buckets.map(({sum,count,missing})=>({customers:count?sum/count:null,count,missing})),values=days.map(d=>d.customers).filter(Number.isFinite),max=values.length?Math.max(...values):null;
  const count=buckets.reduce((n,b)=>n+b.count,0),average=count?buckets.reduce((n,b)=>n+b.sum,0)/count:null,min=values.length?Math.min(...values):null;
  return {store,average,observedWeekdays:values.length,days:days.map(d=>({...d,delta:d.customers===null?null:d.customers-average,percent:d.customers!==null&&average>0?(d.customers/average-1)*100:null})),best:max===null?[]:days.flatMap((d,i)=>d.customers!==null&&Math.abs(d.customers-max)<1e-9?[i]:[]),worst:values.length>1&&max-min>1e-9?days.flatMap((d,i)=>d.customers!==null&&Math.abs(d.customers-min)<1e-9?[i]:[]):[]};
 });
}
