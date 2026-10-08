import {ImapFlow} from 'imapflow';
import {simpleParser} from 'mailparser';
export function createImapSource(config,{Client=ImapFlow}={}){
 const configured=Boolean(config.user&&config.password);
 return {scope:config.scope,configured,async fetch({since,cursor}){
  if(!configured)throw Object.assign(Error('IMAP未設定'),{code:'IMAP_NOT_CONFIGURED'});
  const client=new Client({host:config.host,port:config.port,secure:true,auth:{user:config.user,pass:config.password},tls:{rejectUnauthorized:true},logger:false,disableAutoIdle:true,connectionTimeout:20000,greetingTimeout:20000,socketTimeout:60000});
  // imapflow emits errors as well as rejecting operations; never log raw events.
  client.on('error',()=>{});
  let lock;
  try{
   await client.connect();lock=await client.getMailboxLock(config.mailbox,{readOnly:true});
   const uidValidity=String(client.mailbox.uidValidity);
   const same=cursor&&cursor.uidValidity===uidValidity;
   const query=same?{uid:`${cursor.uid+1}:*`}:{since:new Date(`${since}T00:00:00Z`)};
   const found=await client.search(query,{uid:true});
   const uids=(found||[]).filter(uid=>!same||uid>cursor.uid).sort((a,b)=>a-b);
   const limited=uids.slice(0,500),messages=[],metadata=[];
   if(limited.length)for await(const msg of client.fetch(limited,{envelope:true,size:true,uid:true},{uid:true}))metadata.push(msg);
   metadata.sort((a,b)=>a.uid-b.uid);
   const selected=[];let bytes=0,hasMore=uids.length>limited.length;
   for(const msg of metadata){
    const sender=msg.envelope?.from?.[0]?.address||'';
    if(config.sender&&sender.toLowerCase()!==config.sender.toLowerCase()){messages.push({uid:msg.uid,skipReason:'sender'});continue;}
    if(msg.size>10*1024*1024){messages.push({uid:msg.uid,skipReason:'oversized'});continue;}
    if(bytes+(msg.size||0)>50*1024*1024){hasMore=true;break;}
    bytes+=msg.size||0;selected.push(msg.uid);
   }
   if(selected.length)for await(const msg of client.fetch(selected,{source:true,internalDate:true,uid:true},{uid:true})){
    if(msg.source.length>10*1024*1024){messages.push({uid:msg.uid,skipReason:'oversized'});continue;}
    const parsed=await simpleParser(msg.source,{skipHtmlToText:false,skipTextToHtml:true});
    messages.push({uid:msg.uid,messageId:parsed.messageId||null,subject:parsed.subject||'',sender:parsed.from?.value?.[0]?.address||'',receivedAt:msg.internalDate?new Date(msg.internalDate).toISOString():parsed.date?.toISOString()||null,text:parsed.text||''});
   }
   return {uidValidity,messages:messages.sort((a,b)=>a.uid-b.uid),hasMore};
  }finally{
   lock?.release();try{await client.logout();}catch{client.close();}
  }
 }};
}
