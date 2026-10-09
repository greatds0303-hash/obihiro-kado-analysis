export function normalizeText(text) {
 return String(text ?? '').normalize('NFKC').replace(/\r\n?/g,'\n').replace(/[\u200B\uFEFF]/g,'');
}
export function validDate(value) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
 const d = new Date(`${value}T00:00:00Z`);
 return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
export function normalizeStore(name) {
 const text = normalizeText(name).trim().replace(/\s+/g,' ');
 return text.replace(/イーグル\s*スクエア\s*帯広店/g,'イーグル スクエア帯広店');
}
export function parseReport(text) {
 const lines=normalizeText(text).split('\n').map(x=>x.trim()).filter(Boolean);
 const result={summaries:[],records:[],specials:[]};
 let date=null,time=null,store=null,storeTotal=null;
 const groups=new Map();
 const context=()=>({date,time,store,storeTotal});
 const group=()=>{
  const key=JSON.stringify([date,time,store]);
  if (!groups.has(key)) groups.set(key,{...context(),rates:[],explicit:null,events:[]});
  return groups.get(key);
 };
 for(let i=0;i<lines.length;i++) {
  const line=lines[i]; let m=line.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s*(11|15|19)\s*時/);
  if(m){const candidate=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;date=validDate(candidate)?candidate:null;time=+m[4];store=null;storeTotal=null;continue;}
  m=line.match(/^(.+?)\s*\(\s*(\d+)\s*台\s*\)$/);
  if(m){
   const rate=m[1].replace(/\s+/g,''), machines=+m[2];
   if(/^\d+(?:\.\d+)?円[PS]$/i.test(rate)) {
    if(!date||!store) continue;
    let male=null,female=null,customers=null,util=null,share=null;
    for(let j=i+1;j<Math.min(i+7,lines.length);j++){
     const l=lines[j];
     if(/台\s*[)】]/.test(l)||/^(?:総合計|\d{4}[/-])/.test(l))break;
     const a=l.match(/^男\s*(\d+)\s*名\s*女\s*(\d+)\s*名$/);
     const b=l.match(/^合計\s*(\d+)\s*名\s*(\d+(?:\.\d+)?)\s*%$/);
     const c=l.match(/^客数シェア\s*(\d+(?:\.\d+)?)\s*%$/);
     if(a){male=+a[1];female=+a[2];} if(b){customers=+b[1];util=+b[2];} if(c)share=+c[1];
    }
    if(customers!==null&&util!==null){const r={...context(),rate:rate.toUpperCase(),machines,male,female,customers,util,share};result.records.push(r);group().rates.push(r);}
   }else{store=normalizeStore(m[1]);storeTotal=machines;if(date)group();}
   continue;
  }
  m=line.match(/^総合計\s*(\d+)\s*名\s*(\d+(?:\.\d+)?)\s*%$/);
  if(m&&date&&store){const s=lines[i+1]?.match(/^客数シェア\s*(\d+(?:\.\d+)?)\s*%$/);group().explicit={...context(),customers:+m[1],util:+m[2],share:s?+s[1]:null,derived:false};continue;}
  m=line.match(/^(.+?)\s*【\s*(\d+)\s*台\s*】\s*(\d+)\s*名\s*(\d+(?:\.\d+)?)\s*%$/);
  if(m&&date&&store){result.specials.push({...context(),group:m[1].trim(),machines:+m[2],customers:+m[3],util:+m[4]});continue;}
  if(date&&store&&!/^(?:男|女|合計|客数シェア|稼働率|総合計)/.test(line)&&!/^[-=ー]+$/.test(line))group().events.push(line);
 }
 for(const g of groups.values()) {
  if(g.explicit)result.summaries.push({...g.explicit,event:g.events.join("\n")});
  else if(g.rates.length){const customers=g.rates.reduce((n,r)=>n+r.customers,0);result.summaries.push({date:g.date,time:g.time,store:g.store,storeTotal:g.storeTotal,customers,util:g.storeTotal?Math.round(customers/g.storeTotal*1000)/10:null,share:null,derived:true,event:g.events.join("\n")});}
 }
 return result;
}
