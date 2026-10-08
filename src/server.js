import {loadConfig} from './config.js';
import {openRepository} from './db.js';
import {createImapSource} from './imap.js';
import {createSyncService} from './sync.js';
import {startScheduler} from './scheduler.js';
import {createApp} from './app.js';
const config=loadConfig();
const repository=openRepository(config.dbPath);
const source=createImapSource(config.imap);
const syncService=createSyncService(repository,source,{since:config.since,sender:config.imap.sender});
const app=createApp({repository,syncService,config});
const server=app.listen(config.port,config.host,()=>{
 console.log(`稼働分析サーバーをポート${config.port}で起動しました。IMAP設定: ${source.configured?'設定済み':'未設定'}`);
 if(source.configured)syncService.sync().catch(()=>{});
});
const stop=config.cron?startScheduler(syncService):()=>{};
let closing=false;
async function shutdown(){
 if(closing)return;closing=true;stop();server.close();
 const deadline=Date.now()+65000;
 while(syncService.status().running&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 if(syncService.status().running)process.exit(1);
 server.closeAllConnections();repository.close();process.exit(0);
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
server.on('error',()=>{console.error('サーバーを起動できません。ポートと実行環境を確認してください');stop();repository.close();process.exitCode=1;});
