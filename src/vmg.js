import {simpleParser} from 'mailparser';
export async function decodeVmg(buffer) {
 const chunks=Buffer.from(buffer).toString('utf8').split(/BEGIN:VMSG/i).slice(1);
 if(!chunks.length)throw new Error('VMG形式のメールが見つかりません');
 const emails=[];
 for(const chunk of chunks){
  const match=chunk.match(/BEGIN:VBODY\s*\r?\n([\s\S]*?)\r?\nEND:VBODY/i);
  if(!match)throw new Error('VMG本文が見つかりません');
  const content=match[1].replace(/^(?:Date|Message-ID|Subject|From):[ \t]*\r?\n/gim,'');
  const mail=await simpleParser(Buffer.from(content,'utf8'));
  if(!mail.text?.trim())throw new Error('VMG本文を復号できません');
  const outerId=chunk.match(/Message-ID:[ \t]*([^\r\n]+)/i)?.[1]?.trim();
  emails.push({messageId:mail.messageId||outerId||null,subject:mail.subject||'',sender:mail.from?.value?.[0]?.address||'',receivedAt:mail.date?.toISOString()||null,text:mail.text});
 }
 return emails;
}
