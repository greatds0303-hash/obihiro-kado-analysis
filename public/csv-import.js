import {normalizeText,normalizeStore,validDate} from './report-parser.js';
import {mergeRows} from './analysis.js';

export function mergeCsvReport(local,report){
 const merged={};
 for(const kind of ['summaries','records','specials']){
  const key=r=>JSON.stringify([r.date,r.time,r.store,kind==='records'?r.rate:kind==='specials'?r.group:'']);
  const existing=new Map((local[kind]||[]).map(r=>[key(r),r]));
  const incoming=report[kind].map(row=>{const previous=existing.get(key(row));return {...row,...(previous?.event?{event:previous.event}:{}),...(previous?.mailId?{mailId:previous.mailId}:{})};});
  merged[kind]=mergeRows(local[kind]||[],incoming,kind);
 }
 return merged;
}

function* csvRows(text){
 let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)throw Error('CSVの引用符が不正です');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){
   row.push(field);field='';closed=false;
   if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;yield row;row=[];}continue;
  }
  if(closed)throw Error('CSVの引用符の後に不正な文字があります');field+=c;
 }
 if(quoted)throw Error('CSVの引用符が閉じていません');
 if(field||closed||row.length){row.push(field);yield row;}
}
export function decodeSurveyCsv(buffer){
 let text,encoding='UTF-8';
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}
 catch{text=new TextDecoder('shift_jis',{fatal:true}).decode(buffer);encoding='Shift_JIS';}
 return {...parseSurveyCsv(text),encoding};
}
export function parseSurveyCsv(text){
 const iterator=csvRows(String(text).replace(/^\uFEFF/,'')),header=iterator.next().value;
 const names=(header||[]).map(v=>normalizeText(v).trim()),required=['対象店舗名','調査日','種別','貸玉(円)','機種コード','機種名','設置台数',...['11','15','19'].map(t=>t+':00(客数)')];
 if(required.some(name=>!names.includes(name)))throw Error('調査CSVの必要な列がありません：'+required.filter(name=>!names.includes(name)).join('・'));
 if(new Set(names).size!==names.length)throw Error('CSVの列名が重複しています');
 const column=new Map(names.map((name,i)=>[name,i])),get=(row,name)=>String(row[column.get(name)]??'').trim();
 const records=new Map(),summaries=new Map(),specials=new Map(),seen=new Set();let sourceRows=0,missingCounts=0;
 const number=(row,name,optional=false)=>{
  const raw=normalizeText(get(row,name));if(!raw&&optional)return null;
  if(!/^\d+(?:\.\d+)?$/.test(raw))throw Error(`${sourceRows+1}行目：${name}が不正です`);
  const value=Number(raw);if(!Number.isFinite(value))throw Error(`${name}が不正です`);return value;
 };
 const accumulate=(map,key,base,machines,customers,male=null,female=null)=>{
  if(!map.has(key))map.set(key,{...base,machines:0,customers:0,male:0,female:0,missing:false});const entry=map.get(key);
  entry.machines+=machines;if(customers==null)entry.missing=true;else entry.customers+=customers;
  for(const [name,value] of [['male',male],['female',female]])entry[name]=entry[name]==null||value==null?null:entry[name]+value;
 };
 for(const row of iterator){
  if(row.every(v=>!v.trim()))continue;sourceRows++;
  if(row.length!==names.length)throw Error(`${sourceRows+1}行目：CSVの列数が一致しません`);
  const match=normalizeText(get(row,'調査日')).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/),date=match?`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`:'';
  if(!validDate(date))throw Error(`${sourceRows+1}行目：日付が不正です`);
  const store=normalizeStore(get(row,'対象店舗名')),kind=normalizeText(get(row,'種別')),price=number(row,'貸玉(円)'),machines=number(row,'設置台数'),code=get(row,'機種コード'),group=normalizeText(get(row,'機種名')).trim().replace(/\s+/g,' ');
  if(!store||!group||!code||!['パチンコ','スロット'].includes(kind)||price<=0||!Number.isInteger(machines))throw Error(`${sourceRows+1}行目：店舗・機種・種別・台数が不正です`);
  const rate=`${price}円${kind==='パチンコ'?'P':'S'}`,key=JSON.stringify([date,store,rate,code]);
  if(seen.has(key))throw Error(`${sourceRows+1}行目：同じ日付・店舗・貸玉・機種の重複があります`);seen.add(key);
  for(const time of [11,15,19]){
   const customers=number(row,`${time}:00(客数)`,true),male=number(row,`${time}:00(男性数)`,true),female=number(row,`${time}:00(女性数)`,true);
   if(customers!=null&&!Number.isInteger(customers))throw Error(`${sourceRows+1}行目：客数は整数で指定してください`);
   if(customers==null)missingCounts++;
   const base={date,time,store,dataSource:'csv'};
   accumulate(summaries,JSON.stringify([date,time,store]),base,machines,customers);
   accumulate(records,JSON.stringify([date,time,store,rate]),{...base,rate},machines,customers,male,female);
   accumulate(specials,JSON.stringify([date,time,store,group]),{...base,group},machines,customers);
  }
 }
 if(!sourceRows)throw Error('CSVにデータがありません');
 const finalize=(entries,summary=false)=>[...entries.values()].filter(r=>!r.missing).map(({missing,...r})=>{
  const total=summaries.get(JSON.stringify([r.date,r.time,r.store])).machines;
  const result={...r,storeTotal:total,util:r.machines>0?Math.round(r.customers/r.machines*1000)/10:null,share:null};
  if(summary){result.derived=true;result.event='';delete result.machines;delete result.male;delete result.female;}return result;
 });
 return {records:finalize(records),summaries:finalize(summaries,true),specials:finalize(specials),sourceRows,missingCounts,dates:[...new Set([...summaries.values()].map(r=>r.date))].sort(),stores:[...new Set([...summaries.values()].map(r=>r.store))]};
}
