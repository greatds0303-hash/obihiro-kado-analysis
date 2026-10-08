export async function request(path,options={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),90000);
 try{
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,signal:controller.signal});
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.error||'サーバー処理に失敗しました'),{status:response.status});
  return data;
 }catch(e){
  if(e.status)throw e;
  throw Error(navigator.onLine?'サーバーに接続できません。接続先と通信状態を確認してください':'オフラインです。最終取得データを表示中');
 }finally{clearTimeout(timeout);}
}
