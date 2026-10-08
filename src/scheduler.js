import cron from 'node-cron';
export const SCHEDULE='10,30 11,15,19 * * *';
export function startScheduler(service,runner=cron){
 const task=runner.schedule(SCHEDULE,async()=>{try{await service.sync();}catch{/* Safe error is available from /api/status. */}},{timezone:'Asia/Tokyo',noOverlap:true});
 return ()=>task.stop();
}
