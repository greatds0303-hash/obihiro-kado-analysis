import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
export function createAuth(config){
 const sessions=new Map(),attempts=new Map(),ttl=8*60*60*1000;
 const digest=value=>createHash('sha256').update(String(value)).digest();
 const token=req=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('kado_session='))?.slice('kado_session='.length);
 const cookie=value=>`kado_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value?ttl/1000:0}${config.production?'; Secure':''}`;
 return {
  login(req,res){
   const now=Date.now();for(const [k,v]of attempts)if(now-v.start>600000)attempts.delete(k);
   const ip=req.ip||'local';const attempt=attempts.get(ip)||{start:now,count:0};
   if(attempt.count>=20)return res.status(429).json({error:'ログイン試行が多すぎます。10分後に再試行してください'});
   attempt.count++;attempts.set(ip,attempt);
   if(typeof req.body?.password!=='string'||!config.password||!timingSafeEqual(digest(req.body.password),digest(config.password)))return res.status(401).json({error:'パスワードを確認してください'});
   for(const [k,v]of sessions)if(v<now)sessions.delete(k);
   if(sessions.size>=1000)return res.status(503).json({error:'しばらく待って再試行してください'});
   const value=randomBytes(32).toString('hex');sessions.set(value,now+ttl);attempts.delete(ip);
   res.setHeader('Set-Cookie',cookie(value));res.json({authenticated:true});
  },
  logout(req,res){sessions.delete(token(req));res.setHeader('Set-Cookie',cookie(''));res.json({authenticated:false});},
  require(req,res,next){
   if(!config.password)return next();
   const key=token(req),expires=sessions.get(key);
   if(expires&&expires>Date.now())return next();
   if(key)sessions.delete(key);
   res.status(401).json({authenticationRequired:true,error:'ログインしてください'});
  }
 };
}
