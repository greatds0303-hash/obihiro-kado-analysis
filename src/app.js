import express from 'express';
import {fileURLToPath} from 'node:url';
import {createAuth} from './auth.js';
import {validDate} from './parser.js';
import {decodeVmg} from './vmg.js';
import {ingestEmail} from './ingest.js';
export function createApp({repository,syncService,config}){
 const app=express(),auth=createAuth(config);
 app.disable('x-powered-by');
 app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  if(req.path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
   const origin=req.headers.origin;let foreign=false;
   try{foreign=Boolean(origin&&new URL(origin).host!==req.headers.host);}catch{foreign=true;}
   if(foreign||req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({error:'別オリジンからの更新は許可されていません'});
  }
  next();
 });
 app.use(express.json({limit:'256kb'}));
 app.post('/api/session',auth.login);app.delete('/api/session',auth.logout);
 app.use('/api',auth.require);
 const filters=req=>{
  const f={};for(const k of ['from','to','time','store','rate']){
   const v=req.query[k];if(v!==undefined&&(typeof v!=='string'||v.length>200))throw Error('検索条件が不正です');if(v)f[k]=v;
  }
  if((f.from&&!validDate(f.from))||(f.to&&!validDate(f.to))||(f.from&&f.to&&f.from>f.to)||(f.time&&!['11','15','19'].includes(f.time)))throw Error('日付・時間の検索条件が不正です');
  return f;
 };
 app.get('/api/status',(req,res)=>res.json(syncService.status()));
 app.get('/api/data',(req,res)=>res.json(repository.getData()));
 for(const [path,kind]of [['summary','summaries'],['rates','records'],['specials','specials']])app.get(`/api/${path}`,(req,res)=>{
  let f;try{f=filters(req);}catch(e){return res.status(400).json({error:e.message});}
  res.json(repository.query(kind,f));
 });
 app.post('/api/sync',async(req,res)=>{
  if(req.body?.since!==undefined&&(typeof req.body.since!=='string'||!validDate(req.body.since)))return res.status(400).json({error:'取得開始日が不正です'});
  try{res.json(await syncService.sync({since:req.body?.since}));}
  catch(e){res.status(e.code==='SYNC_BUSY'?409:e.code==='IMAP_NOT_CONFIGURED'?503:502).json({error:e.message});}
 });
 app.post('/api/import/email',(req,res)=>{
  const text=req.body?.text;
  if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text,'utf8')>128*1024)return res.status(400).json({error:'128KB以下のメール本文を入力してください'});
  try{
   const result=ingestEmail(repository,{text,messageId:null,subject:'',sender:'',receivedAt:null});
   if(result.outcome==='ignored')return res.status(400).json({error:'対象の稼働報告が見つかりません。日時と店舗名を含めて貼り付けてください'});
   res.json(result);
  }catch{res.status(400).json({error:'本文を解析できません。日時と店舗名・客数の記載を確認してください'});}
 });
 app.post('/api/import/vmg',express.raw({type:'application/octet-stream',limit:'20mb'}),async(req,res)=>{
  if(!Buffer.isBuffer(req.body))return res.status(415).json({error:'VMGをapplication/octet-streamで送信してください'});
  try{
   const emails=await decodeVmg(req.body);const stats={newCount:0,duplicateCount:0,ignoredCount:0};
   for(const email of emails){const {outcome}=ingestEmail(repository,email);stats[outcome==='new'?'newCount':outcome==='duplicate'?'duplicateCount':'ignoredCount']++;}
   res.json(stats);
  }catch{res.status(400).json({error:'VMGを解析できません。一部が登録済みの場合も安全に再送できます'});}
 });
 app.use('/api',(req,res)=>res.status(404).json({error:'APIが見つかりません'}));
 app.use(express.static(fileURLToPath(new URL('../public/',import.meta.url)),{dotfiles:'deny',setHeaders(res,path){if(path.endsWith('service-worker.js'))res.setHeader('Cache-Control','no-cache');}}));
 app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=err.type==='entity.too.large'?413:err instanceof SyntaxError?400:500;
  res.status(status).json({error:status===413?'ファイル・リクエストのサイズが上限を超えています':status===400?'JSON形式が不正です':'サーバー処理に失敗しました'});
 });
 return app;
}
