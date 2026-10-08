import {normalizeText,parseReport} from './parser.js';
export function isTargetEmail(email,sender=''){
 const t=normalizeText(`${email.subject||''}\n${email.text||''}`).replace(/\s+/g,'');
 const matches=t.includes('イーグルスクエア帯広店') && (t.includes('稼働報告')||/\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:11|15|19)時/.test(t));
 return matches && (!sender || String(email.sender||'').toLowerCase()===sender.toLowerCase());
}
export function ingestEmail(repository,email,{sender=''}={}){
 if(!isTargetEmail(email,sender))return {outcome:'ignored'};
 const report=parseReport(email.text);
 if(!report.summaries.length)throw new Error('対象メールの本文を解析できません');
 const result=repository.saveEmail(email,report);
 return {...result,outcome:result.duplicate?'duplicate':'new'};
}
