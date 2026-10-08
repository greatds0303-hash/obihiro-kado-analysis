import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {validDate} from './parser.js';
export function loadConfig(env=process.env){
 const number=(name,fallback)=>{const n=Number(env[name]??fallback);if(!Number.isInteger(n)||n<1||n>65535)throw Error(`${name}の設定が不正です`);return n;};
 const production=env.NODE_ENV==='production';
 const password=env.APP_PASSWORD||'';
 if(production&&password.length<16)throw Error('本番環境には16文字以上のAPI認証パスワードが必要です');
 const since=env.IMAP_SINCE||'2026-01-01';if(!validDate(since))throw Error('IMAP_SINCEの日付が不正です');
 const user=env.DOCOMO_IMAP_USER||'',host=env.DOCOMO_IMAP_HOST||'imap.spmode.ne.jp',mailbox=env.DOCOMO_IMAP_MAILBOX||'INBOX';
 return {production,password,port:number('PORT',3000),host:env.HOST||'127.0.0.1',dbPath:resolve(env.DB_PATH||'data/kado.sqlite'),cron:env.ENABLE_CRON!=='false',since,
  imap:{host,port:number('DOCOMO_IMAP_PORT',993),user,password:env.DOCOMO_IMAP_PASSWORD||'',mailbox,sender:env.REPORT_SENDER??'square_obihiro@eaglegroup.co.jp',
  scope:createHash('sha256').update(`${host}\0${user}\0${mailbox}`).digest('hex')},
 };
}
