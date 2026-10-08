import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeText} from './parser.js';
export function contentFingerprint(text){return createHash('sha256').update(normalizeText(text).replace(/\s+/g,'')).digest('hex');}
export function openRepository(path){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const db=new Database(path);db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');
 db.exec(`CREATE TABLE IF NOT EXISTS emails(
 id INTEGER PRIMARY KEY, message_id TEXT UNIQUE, imap_uid TEXT UNIQUE, content_hash TEXT NOT NULL UNIQUE,
 subject TEXT NOT NULL, sender TEXT NOT NULL, received_at TEXT, synced_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS store_summary(
 id INTEGER PRIMARY KEY,email_id INTEGER NOT NULL REFERENCES emails(id), business_date TEXT NOT NULL, report_time INTEGER NOT NULL,
 store_name TEXT NOT NULL,total_machines INTEGER,customers INTEGER,utilization REAL,share REAL,derived INTEGER NOT NULL DEFAULT 0,
 UNIQUE(email_id,business_date,report_time,store_name));
 CREATE TABLE IF NOT EXISTS rate_summary(
 id INTEGER PRIMARY KEY,email_id INTEGER NOT NULL REFERENCES emails(id),business_date TEXT NOT NULL,report_time INTEGER NOT NULL,
 store_name TEXT NOT NULL,total_machines INTEGER,rate_name TEXT NOT NULL,machines INTEGER,male_customers INTEGER,female_customers INTEGER,
 customers INTEGER,utilization REAL,share REAL,UNIQUE(email_id,business_date,report_time,store_name,rate_name));
 CREATE TABLE IF NOT EXISTS special_group(
 id INTEGER PRIMARY KEY,email_id INTEGER NOT NULL REFERENCES emails(id),business_date TEXT NOT NULL,report_time INTEGER NOT NULL,
 store_name TEXT NOT NULL,total_machines INTEGER,group_name TEXT NOT NULL,machines INTEGER,customers INTEGER,utilization REAL,
 UNIQUE(email_id,business_date,report_time,store_name,group_name));
 CREATE INDEX IF NOT EXISTS summary_filter ON store_summary(business_date,report_time,store_name);
 CREATE INDEX IF NOT EXISTS rate_filter ON rate_summary(business_date,report_time,store_name,rate_name);
 CREATE INDEX IF NOT EXISTS special_filter ON special_group(business_date,report_time,store_name);
 CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 const getState=key=>{const row=db.prepare('SELECT value FROM sync_state WHERE key=?').get(key);return row?JSON.parse(row.value):null;};
 const setState=(key,value)=>db.prepare('INSERT INTO sync_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 const tables={summaries:'store_summary',records:'rate_summary',specials:'special_group'};
 const select={summaries:'s.total_machines AS storeTotal,s.customers,s.utilization AS util,s.share,s.derived',records:'s.total_machines AS storeTotal,s.rate_name AS rate,s.machines,s.male_customers AS male,s.female_customers AS female,s.customers,s.utilization AS util,s.share',specials:'s.total_machines AS storeTotal,s.group_name AS "group",s.machines,s.customers,s.utilization AS util'};
 const save=db.transaction((email,report)=>{
  const hash=contentFingerprint(email.text),id=String(email.messageId||'').trim()||null,uid=email.imapIdentity||null;
  const existing=db.prepare('SELECT id FROM emails WHERE content_hash=? OR (message_id IS NOT NULL AND message_id=?) OR (imap_uid IS NOT NULL AND imap_uid=?)').get(hash,id,uid);
  if(existing)return {duplicate:true,emailId:existing.id};
  const row=db.prepare('INSERT INTO emails(message_id,imap_uid,content_hash,subject,sender,received_at,synced_at) VALUES (?,?,?,?,?,?,?)').run(id,uid,hash,email.subject||'',email.sender||'',email.receivedAt||null,new Date().toISOString());
  const emailId=Number(row.lastInsertRowid);
  const common=r=>[emailId,r.date,r.time,r.store,r.storeTotal??null];
  const summary=db.prepare('INSERT INTO store_summary(email_id,business_date,report_time,store_name,total_machines,customers,utilization,share,derived) VALUES (?,?,?,?,?,?,?,?,?)');
  const rate=db.prepare('INSERT INTO rate_summary(email_id,business_date,report_time,store_name,total_machines,rate_name,machines,male_customers,female_customers,customers,utilization,share) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const special=db.prepare('INSERT INTO special_group(email_id,business_date,report_time,store_name,total_machines,group_name,machines,customers,utilization) VALUES (?,?,?,?,?,?,?,?,?)');
  for(const r of report.summaries)summary.run(...common(r),r.customers??null,r.util??null,r.share??null,r.derived?1:0);
  for(const r of report.records)rate.run(...common(r),r.rate,r.machines??null,r.male??null,r.female??null,r.customers??null,r.util??null,r.share??null);
  for(const r of report.specials)special.run(...common(r),r.group,r.machines??null,r.customers??null,r.util??null);
  return {duplicate:false,emailId};
 });
 const repository={
  saveEmail:save,
  query(kind,filters={}){
   if(!tables[kind])throw new Error('Unknown report kind');
   const where=[],params=[];
   for(const [key,column,op]of [['from','business_date','>='],['to','business_date','<='],['time','report_time','='],['store','store_name','=']])if(filters[key]!=null&&filters[key]!==''){where.push(`s.${column} ${op} ?`);params.push(filters[key]);}
   if(filters.rate){if(kind==='records'){where.push('s.rate_name = ?');params.push(filters.rate);}else{where.push('EXISTS (SELECT 1 FROM rate_summary r WHERE r.email_id=s.email_id AND r.business_date=s.business_date AND r.report_time=s.report_time AND r.store_name=s.store_name AND r.rate_name=?)');params.push(filters.rate);}}
   return db.prepare(`SELECT s.business_date AS date,s.report_time AS time,s.store_name AS store,${select[kind]},COALESCE(e.message_id,'hash:'||e.content_hash) AS mailId,e.content_hash AS mailHash FROM ${tables[kind]} s JOIN emails e ON e.id=s.email_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY s.business_date,s.report_time,s.store_name,s.id`).all(...params);
  },
  getData(){return {summaries:this.query('summaries'),records:this.query('records'),specials:this.query('specials'),mailKeys:db.prepare("SELECT COALESCE(message_id,'hash:'||content_hash) AS key FROM emails").all().map(r=>r.key),emails:db.prepare('SELECT count(*) AS count FROM emails').get().count};},
  getStatus(){return {...(getState('status')||{}),latestEmailAt:db.prepare('SELECT MAX(received_at) AS value FROM emails').get().value,latestDataDate:db.prepare('SELECT MAX(business_date) AS value FROM store_summary').get().value,emailCount:db.prepare('SELECT COUNT(*) AS count FROM emails').get().count};},
  setStatus(value){setState('status',{...(getState('status')||{}),...value});},
  getCursor:scope=>getState(`cursor:${scope}`),setCursor:(scope,cursor)=>setState(`cursor:${scope}`,cursor),
  close:()=>db.close()
 };
 return repository;
}
