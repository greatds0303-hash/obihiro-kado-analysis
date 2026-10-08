import {ingestEmail} from './ingest.js';
import {validDate} from './parser.js';
export function createSyncService(repository,source,{since='2026-01-01',sender=''}={}){
 let running=false;
 return {
  status(){return {...repository.getStatus(),running,configured:source.configured!==false};},
  async sync(options={}){
   if(running)throw Object.assign(Error('同期は既に実行中です'),{code:'SYNC_BUSY'});
   if(options.since&&!validDate(options.since))throw Object.assign(Error('取得開始日が不正です'),{code:'INVALID_DATE'});
   running=true;const stats={newCount:0,duplicateCount:0,ignoredCount:0,skippedCount:0};
   const unresolved=new Map((repository.getStatus().unprocessedMessages||[]).map(m=>[`${m.uidValidity}/${m.uid}`,m]));
   repository.setStatus({lastAttempt:new Date().toISOString(),error:null});
   try{
    const scope=source.scope;
    if(options.since)repository.setCursor(scope,{uidValidity:null,uid:0,since:options.since});
    const previous=repository.getCursor(scope),effectiveSince=previous?.since||since;
    const batch=await source.fetch({since:effectiveSince,cursor:previous});
    const uidValidity=String(batch.uidValidity);
    let cursor=previous&&previous.uidValidity===uidValidity?{...previous,since:effectiveSince}:{uidValidity,uid:0,since:effectiveSince};
    repository.setCursor(scope,cursor);
    for(const mail of batch.messages.sort((a,b)=>a.uid-b.uid)){
     try{
      if(mail.skipReason){
       if(mail.skipReason==='oversized'){stats.skippedCount++;unresolved.set(`${uidValidity}/${mail.uid}`,{uidValidity,uid:mail.uid,reason:'oversized'});}
       else stats.ignoredCount++;
      }else{
      const result=ingestEmail(repository,{...mail,imapIdentity:`${scope}/${uidValidity}/${mail.uid}`},{sender});
      stats[result.outcome==='new'?'newCount':result.outcome==='duplicate'?'duplicateCount':'ignoredCount']++;
      }
     }catch{
      throw Object.assign(Error('対象メールの解析に失敗しました。本文形式を確認してください'),{code:'PARSE_FAILED'});
     }
     cursor={uidValidity,uid:Math.max(cursor.uid,mail.uid),since:effectiveSince};repository.setCursor(scope,cursor);
    }
    repository.setStatus({...stats,unprocessedMessages:[...unresolved.values()],warning:unresolved.size?`サイズ上限で未取込のメールが${unresolved.size}通あります。必要な報告は本文を手動で取り込んでください`:null,lastSuccess:new Date().toISOString(),error:null,hasMore:Boolean(batch.hasMore)});
    return {...stats,hasMore:Boolean(batch.hasMore)};
   }catch(e){
    const message=e.code==='PARSE_FAILED'?e.message:e.code==='IMAP_NOT_CONFIGURED'?'docomo IMAP専用ID・パスワードをサーバーに設定してください':'メール接続・同期に失敗しました。設定・ネットワーク・認証を確認してください';
    repository.setStatus({...stats,error:message});throw Object.assign(Error(message),{code:e.code==='PARSE_FAILED'?e.code:e.code==='IMAP_NOT_CONFIGURED'?e.code:'SYNC_FAILED'});
   }finally{running=false;}
  }
 };
}
