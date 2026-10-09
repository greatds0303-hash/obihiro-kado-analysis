import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const text=readFileSync(new URL('./fixtures/report.txt',import.meta.url),'utf8');
const vmg=`BEGIN:VMSG\nBEGIN:VBODY\nMessage-ID: <e2e>\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n${Buffer.from(text).toString('base64')}\nEND:VBODY\nEND:VMSG`;
test('スマホ起動・同期・総合一覧・貸玉比較・CSV・オフライン再起動',async({page,context})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.locator('details').filter({has:page.locator('#connectionMode')}).locator('summary').click();await page.locator('#connectionMode').selectOption('server');await expect(page.locator('#syncBtn')).toBeVisible();
 await page.locator('#syncBtn').click();await expect(page.locator('#kLatest')).toHaveText('129');
 await expect(page.locator('#syncStatus')).toContainText('新規');await expect(page.locator('#tableWrap')).toContainText('129');
 await page.locator('[data-tab="records"]').click();await page.locator('#store').selectOption('');await expect(page.locator('#tableWrap')).toContainText('7.5円S');
 const download=page.waitForEvent('download');await page.locator('#csvBtn').click();expect((await download).suggestedFilename()).toContain('records');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
 await context.setOffline(true);await page.reload();await expect(page.locator('#networkStatus')).toContainText('最終取得データを表示中');await expect(page.locator('#kLatest')).toHaveText('129');
 await expect(page.locator('#syncBtn')).toBeDisabled();await context.setOffline(false);await expect(page.locator('#syncBtn')).toBeEnabled();
 expect(errors).toEqual([]);
});
test('VMG・JSON復元・重複・オフラインVMG保留と復帰',async({page,context})=>{
 await page.goto('/');await page.locator('details').filter({has:page.locator('#connectionMode')}).locator('summary').click();await page.locator('#connectionMode').selectOption('server');await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
 await context.setOffline(true);
 await page.locator('#file').setInputFiles({name:'report.vmg',mimeType:'text/plain',buffer:Buffer.from(vmg)});
 await expect(page.locator('#kLatest')).toHaveText('129');await expect(page.locator('#status')).toContainText('読み込み完了');
 await context.setOffline(false);await expect(page.locator('#pendingStatus')).toContainText('未送信 0');
 const backupDownload=page.waitForEvent('download');await page.locator('#backupBtn').click();const backup=await backupDownload;
 const path=await backup.path();expect(path).toBeTruthy();
 await page.locator('#restoreFile').setInputFiles(path);await expect(page.locator('#status')).toContainText('復元しました');await expect(page.locator('#kLatest')).toHaveText('129');
 await page.locator('#syncBtn').click();await expect(page.locator('#kEmails')).toHaveText('1');
});
test('バックアップ内の不正な数値フィールドをHTMLとして実行しない',async({page})=>{
 await page.goto('/');
 const row={date:'2026-10-06',time:11,store:'イーグル スクエア帯広店',customers:1,util:1,share:null,storeTotal:'<img src=x onerror="window.__injected=true">',mailId:'backup'};
 await page.locator('#restoreFile').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({summaries:[row],records:[],specials:[],mailKeys:['backup'],emails:1}))});
 await expect(page.locator('#status')).toContainText('復元しました');
 await expect(page.locator('#tableWrap img')).toHaveCount(0);
 expect(await page.evaluate(()=>window.__injected)).toBeUndefined();
});
test('サーバーなしでメール本文を貼り付け・重複除外・オフライン保存',async({page,context})=>{
 const requests=[];page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.url());});
 await page.goto('http://127.0.0.1:3102/');await expect(page.locator('#connectionMode')).toHaveValue('manual');
 await page.locator('#mailText').fill(text);await page.locator('#pasteImportBtn').click();await expect(page.locator('#kLatest')).toHaveText('129');
 await page.locator('#mailText').fill(text);await page.locator('#pasteImportBtn').click();await expect(page.locator('#pasteStatus')).toContainText('重複');await expect(page.locator('#kEmails')).toHaveText('1');
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await context.setOffline(true);await page.reload();await expect(page.locator('#kLatest')).toHaveText('129');
 await expect(page.locator('#pasteImportBtn')).toBeEnabled();expect(requests).toEqual([]);
});
test('破損メッセージを含むVMGのローカル取込は原子的',async({page,context})=>{
 await page.goto('/');await context.setOffline(true);
 const malformed=vmg+'\nBEGIN:VMSG\nBEGIN:VBODY\n壊れた本文\nEND:VBODY\nEND:VMSG';
 await page.locator('#file').setInputFiles({name:'broken.vmg',mimeType:'text/plain',buffer:Buffer.from(malformed)});
 await expect(page.locator('#status')).toContainText('失敗');await expect(page.locator('#kEmails')).toHaveText('0');await expect(page.locator('#kLatest')).toHaveText('-');
});
test('保留送信が拒否されてもサーバーの最新データを表示',async({page,context})=>{
 await page.goto('/');await page.request.post('/api/sync');await context.setOffline(true);await page.locator('#mailText').fill(text.replaceAll('2026/10/06','2026/09/01'));await page.locator('#pasteImportBtn').click();await expect(page.locator('#kLatest')).toHaveText('129');
 await context.setOffline(false);await page.route('**/api/import/email',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'import failed'})}));
 await page.locator('details').filter({has:page.locator('#connectionMode')}).locator('summary').click();await page.locator('#connectionMode').selectOption('server');
 await expect(page.locator('#tableWrap')).toContainText('2026-10-06');await expect(page.locator('#syncError')).toContainText('import failed');
});
test('競合店の客数と稼働率を同時に表示して店舗を切り替える',async({page})=>{
 await page.goto('http://127.0.0.1:3102/');
 await page.locator('#mailText').fill(text);await page.locator('#pasteImportBtn').click();
 await expect(page.locator('#chartStores input')).toHaveCount(2);
 await expect(page.locator('#chartStores input:checked')).toHaveCount(2);
 await expect(page.locator('#utilChart')).toBeVisible();
 await expect(page.locator('#chart')).toHaveAttribute('aria-label',/2店舗/);
 await page.locator('#chartStores input').last().uncheck();
 await expect(page.locator('#chart')).toHaveAttribute('aria-label',/1店舗/);
 await page.locator('#rate').selectOption('7.5円S');
 await expect(page.locator('#chartLabel')).toContainText('7.5円S');
 await expect(page.locator('#chartStores')).toContainText('競合店');
 await expect(page.locator('#chartStores')).not.toContainText('イーグル');
 await page.locator('#chartStores input').check();
 await expect(page.locator('#utilChart')).toHaveAttribute('aria-label',/1店舗.*7.5円S/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('12.5円Sを20スロカテゴリーとして表示する',async({page})=>{
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(text);await page.locator('#pasteImportBtn').click();
 await page.locator('#rate').selectOption({label:'20スロ'});
 await expect(page.locator('#chartStores')).toContainText('イーグル');
 await page.locator('[data-tab="records"]').click();
 await expect(page.locator('#tableWrap')).toContainText('34');
});
test('機種別の全店シェアと勝っている店舗のイベントを表示・再取込で補完',async({page})=>{
 const report=text.replace('スマスロ【30台】 10名 33%','ジャグラー【30台】 6名20%\n4.5 9時開店 来店ポイント交換会').replace('総合計12名 12%','総合計212名 21%\n客数シェア 30%\nジャグラー【60台】 18名30%\n新台入替');
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(report);await page.locator('#pasteImportBtn').click();
 await expect(page.locator('#shareChart')).toBeVisible();await expect(page.locator('#eventCompare')).toContainText('新台入替');
 await page.locator('#chartGroup').selectOption('ジャグラー');
 await expect(page.locator('#chart')).toHaveAttribute('aria-label',/2店舗.*ジャグラー/);
 await expect(page.locator('#chartValues')).toContainText('75%');
 await expect(page.locator('#eventCompare')).toContainText('新台入替');
 await page.locator('#mailText').fill(report);await page.locator('#pasteImportBtn').click();await expect(page.locator('#pasteStatus')).toContainText('重複');
 await page.reload();await expect(page.locator('#eventCompare')).toContainText('新台入替');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('サーバー連携でも重複メールのイベント補完を送信する',async({page})=>{
 const report=text.replace('総合計12名 12%','総合計212名 21%\n客数シェア 30%\n新台入替');
 await page.goto('/');await page.locator('details').filter({has:page.locator('#connectionMode')}).locator('summary').click();await page.locator('#connectionMode').selectOption('server');
 await page.locator('#mailText').fill(report);await page.locator('#pasteImportBtn').click();await expect(page.locator('#pendingStatus')).toContainText('本文未送信 0');
 let refreshed=false;
 await page.route('**/api/import/email',async route=>{refreshed=true;await route.continue();});
 await page.route('**/api/data',async route=>{const response=await route.fetch();const data=await response.json();if(!refreshed)for(const row of data.summaries)row.event='';await route.fulfill({response,json:data});});
 await page.locator('#mailText').fill(report);await page.locator('#pasteImportBtn').click();await expect.poll(()=>refreshed).toBeTruthy();
 await expect(page.locator('#eventCompare')).toContainText('新台入替');
});
test('スマホの拡大グラフ・日付選択と客数からのシェア計算',async({page})=>{
 const rows=Array.from({length:20},(_,i)=>['イーグル スクエア帯広店','競合店'].map((store,j)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,time:11,store,customers:j?75:25,util:j?15:5,share:j?1:99,event:j?'新台入替':'',mailId:'visual'}))).flat();
 await page.goto('http://127.0.0.1:3102/');await page.locator('#restoreFile').setInputFiles({name:'chart.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({summaries:rows,records:[],specials:[],mailKeys:['visual']}))});
 await expect(page.locator('#chartValues')).toContainText('25%');await expect(page.locator('#chartValues')).toContainText('75%');
 await page.locator('#chartZoom').selectOption('wide');
 expect(await page.locator('#shareChart').evaluate(el=>el.clientWidth>el.parentElement.clientWidth)).toBeTruthy();
 await page.locator('#chartDate').selectOption('2026-09-01');await expect(page.locator('#chartValues')).toContainText('2026-09-01');await expect(page.locator('#eventCompare')).toContainText('新台入替');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.locator('#chartZoom').selectOption('fit');await page.locator('#shareChart').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/obihiro-chart-mobile.png'});
});
test('6.25Sと5.61Sの競合店舗を5スロとして同時表示する',async({page})=>{
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(text.replace('12.5円S','6.25S').replace('7.5円S','5.61S'));await page.locator('#pasteImportBtn').click();
 await page.locator('#rate').selectOption('5スロ');await expect(page.locator('#chartStores input')).toHaveCount(2);
 await expect(page.locator('#chartValues')).toContainText('73.9%');await expect(page.locator('#chartValues')).toContainText('26.1%');
});
test('時間別表示と別に3時刻の平均を確認しグラフに切り替える',async({page})=>{
 const report=[11,15,19].map((time,i)=>text.replace('2026/10/06 11時',`2026/10/06 ${time}時`).replace('総合計129名 25%',`総合計${[30,60,90][i]}名 25%`)).join('\n');
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(report);await page.locator('#pasteImportBtn').click();
 await expect(page.locator('#dailyAverage')).toContainText('60名');await expect(page.locator('#chartLabel')).toContainText('11時');
 await page.locator('#chartAggregation').selectOption('average');await expect(page.locator('#chartLabel')).toContainText('11・15・19時平均');await expect(page.locator('#chartValues')).toContainText('60名');
});
test('パチンコの近い貸玉を1パチ・4パチで比較する',async({page})=>{
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(text.replace('7.5円S','4.21P'));await page.locator('#pasteImportBtn').click();
 await page.locator('#rate').selectOption('4パチ');await expect(page.locator('#chartStores input')).toHaveCount(2);await expect(page.locator('#chartValues')).toContainText('92.3%');
 await page.locator('#rate').selectOption('1パチ');await expect(page.locator('#chartStores')).toContainText('イーグル');await expect(page.locator('#chartLabel')).toContainText('1パチ');
});
test('スマホの先頭で市場客数・自店シェア・順位・競合イベントが分かる',async({page})=>{
 const report=text.replace('総合計12名 12%','総合計212名 21%\n新台入替');
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(report);await page.locator('#pasteImportBtn').click();
 await expect(page.locator('#marketOverview')).toContainText('341名');await expect(page.locator('#marketOverview')).toContainText('2位');await expect(page.locator('#marketOverview')).toContainText('新台入替');
 expect(await page.locator('.wrap > .card').first().getAttribute('id')).toBe('marketOverview');
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/obihiro-market-overview.png'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('週間・月間のシェア表示へ切り替えられる',async({page})=>{
 const report=[text,text.replaceAll('2026/10/06','2026/10/07')].join('\n');
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(report);await page.locator('#pasteImportBtn').click();
 await page.locator('#chartPeriod').selectOption('week');await expect(page.locator('#chartLabel')).toContainText('週間');await expect(page.locator('#chartValues')).toContainText('2日');
 await page.locator('#chartPeriod').selectOption('month');await expect(page.locator('#chartLabel')).toContainText('月間');await expect(page.locator('#chartDate')).toHaveValue('2026-10-01');
});
test('店舗選択で時間帯比較の店舗とデータを切り替える',async({page})=>{
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(text);await page.locator('#pasteImportBtn').click();
 await page.locator('#store').selectOption('競合店');await expect(page.locator('#timeCompareTitle')).toContainText('競合店');await expect(page.locator('#latestCompare .box').first()).toContainText('12');
 await expect(page.locator('#latestCompare')).not.toContainText('129');
 await page.locator('#store').selectOption('イーグル スクエア帯広店');await expect(page.locator('#latestCompare')).toContainText('129');
});
test('自由な比較日を時間帯・貸玉・市場概要に反映する',async({page})=>{
 const previous=text.replaceAll('2026/10/06','2026/09/01').replace('総合計129名 25%','総合計100名 19%').replace('合計1名 2%','合計0名 0%').replace('男1名 女0名','男0名 女0名').replace('合計34名 20%','合計6名 4%').replace('男34名 女0名','男6名 女0名');
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(text+'\n'+previous);await page.locator('#pasteImportBtn').click();
 await page.locator('#compareDate').fill('2026-09-01');await expect(page.locator('#base')).toHaveValue('custom');
 await expect(page.locator('#latestCompare')).toContainText('2026-09-01');await expect(page.locator('#latestCompare')).toContainText('+29名');await expect(page.locator('#rateCompare')).toContainText('+1名');await expect(page.locator('#marketOverview')).toContainText('+29名');
 await page.locator('#compareDate').fill('2025-01-01');await expect(page.locator('#latestCompare')).toContainText('比較なし');
});
test('市場概要から過去の市場データを選び前後へ移動できる',async({page})=>{
 const older=text.replaceAll('2026/10/06','2026/09/01').replace('総合計129名 25%','総合計100名 19%');
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(older+'\n'+text);await page.locator('#pasteImportBtn').click();
 await page.locator('#marketDate').selectOption('2026-09-01');await expect(page.locator('#marketOverview')).toContainText('112名');await expect(page.locator('#chartDate')).toHaveValue('2026-09-01');
 await page.locator('[data-market-shift="1"]').click();await expect(page.locator('#marketOverview')).toContainText('141名');
 await page.locator('#from').fill('2026-10-06');await page.locator('#marketDate').selectOption('2026-09-01');await expect(page.locator('#marketOverview')).toContainText('112名');
});
test('最新客数欄で各時間と全体平均を選び店舗選択も反映する',async({page})=>{
 const report=[11,15,19].map((time,i)=>text.replace('2026/10/06 11時',`2026/10/06 ${time}時`).replace('総合計129名 25%',`総合計${[30,60,90][i]}名 25%`)).join('\n');
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(report);await page.locator('#pasteImportBtn').click();
 await expect(page.locator('#latestTime')).toBeVisible();await page.locator('#latestTime').selectOption('15');await expect(page.locator('#kLatest')).toHaveText('60');
 await page.locator('#latestTime').selectOption('19');await expect(page.locator('#kLatest')).toHaveText('90');
 await page.locator('#latestTime').selectOption('average');await expect(page.locator('#kLatest')).toHaveText('60');await expect(page.locator('#latestCustomerInfo')).toContainText('2026-10-06');
 await page.locator('#store').selectOption('競合店');await expect(page.locator('#kLatest')).toHaveText('12');await expect(page.locator('#latestCustomerInfo')).toContainText('競合店');
});

test('貸玉比較に選択店舗の種別台数と総台数を表示する',async({page})=>{
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(text);await page.locator('#pasteImportBtn').click();
 const table=page.locator('#rateCompare');await expect(table).toContainText('総台数 516台');await expect(table.locator('thead')).toContainText('台数');await expect(table.locator('tbody')).toContainText('64台');
 await page.locator('#rate').selectOption('4パチ');await expect(table).toContainText('総台数 516台');
 await page.locator('#rate').selectOption('');await page.locator('#store').selectOption('競合店');await expect(table).toContainText('総台数 100台');await expect(table.locator('tbody')).toContainText('100台');await expect(table).not.toContainText('516台');
});

test('グラフをタッチすると店舗名と値が表示される',async({page})=>{
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(text);await page.locator('#pasteImportBtn').click();
 await page.locator('#chart').click({position:{x:150,y:45}});await expect(page.locator('#chart').locator('..').getByRole('status')).toContainText('イーグル スクエア帯広店');await expect(page.locator('#chart').locator('..').getByRole('status')).toContainText('129名');
 await page.locator('#chart').click({position:{x:150,y:265}});await expect(page.locator('#chart').locator('..').getByRole('status')).toContainText('競合店');await expect(page.locator('#chart').locator('..').getByRole('status')).toContainText('12名');
 await page.locator('#shareChart').click({position:{x:150,y:45}});await expect(page.locator('#shareChart').locator('..').getByRole('status')).toContainText('%');
});

test('店舗総合を全店舗の日別3回平均で表示しCSVにも反映する',async({page})=>{
 const reports=[text,text.replaceAll('2026/10/06 11時','2026/10/06 15時').replace('総合計129名','総合計159名'),text.replaceAll('2026/10/06 11時','2026/10/06 19時').replace('総合計129名','総合計189名'),text.replaceAll('2026/10/06','2026/10/07')].join('\n');
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(reports);await page.locator('#pasteImportBtn').click();
 await page.locator('#summaryAggregation').selectOption('average');await page.locator('#summaryScope').selectOption('all');
 const rows=page.locator('#tableWrap tbody tr');await expect(rows).toHaveCount(4);await expect(rows.filter({hasText:'2026-10-06'}).filter({hasText:'イーグル'})).toContainText('159');await expect(rows.filter({hasText:'2026-10-06'}).filter({hasText:'競合店'})).toContainText('12');await expect(rows.filter({hasText:'2026-10-07'}).first()).toContainText('未取得');
 await page.locator('#time').selectOption('15');await expect(rows).toHaveCount(4);
 const pending=page.waitForEvent('download');await page.locator('#csvBtn').click();const download=await pending;const csv=readFileSync(await download.path(),'utf8');expect(csv).toContain('1日平均');expect(csv).toContain('競合店');
 await page.locator('#summaryScope').selectOption('selected');await expect(rows).toHaveCount(2);await page.locator('#summaryAggregation').selectOption('time');await expect(rows).toHaveCount(1);await expect(rows.first()).toContainText('15時');
});

test('全店舗ランキングは時間・貸玉・順位基準を反映して店舗選択に依存しない',async({page})=>{
 const summaries=[],records=[];
 for(const time of [11,15,19])for(const [store,total,customers] of [['イーグル スクエア帯広店',100,time===15?60:40],['競合店',20,time===15?15:10]]){
  summaries.push({date:'2026-10-06',time,store,storeTotal:total,customers,util:customers/total*100});
  records.push({date:'2026-10-06',time,store,rate:'1.12円P',machines:total,customers:store==='競合店'?18:10,util:store==='競合店'?90:10});
 }
 await page.goto('http://127.0.0.1:3102/');await page.locator('#restoreFile').setInputFiles({name:'ranking.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({summaries,records,specials:[]}))});
 const rows=page.locator('#ranking tbody tr');await expect(rows).toHaveCount(2);await page.locator('#time').selectOption('');await expect(page.locator('#rankingContext')).toContainText('1日平均');await expect(rows.first()).toContainText('46.7');
 await page.locator('#time').selectOption('15');await expect(rows.first()).toContainText('60');await expect(page.locator('#rankingContext')).toContainText('15時');await expect(rows.first()).toContainText('80%');
 await page.locator('#rankingMetric').selectOption('util');await expect(rows.first()).toContainText('競合店');await expect(rows.first()).toContainText('75%');
 await page.locator('#store').selectOption('競合店');await expect(rows).toHaveCount(2);
 await page.locator('#rankingMetric').selectOption('share');await expect(rows.first()).toContainText('イーグル');
 await page.locator('#rate').selectOption('1パチ');await expect(page.locator('#rankingContext')).toContainText('1パチ');await expect(rows.first()).toContainText('競合店');await expect(rows.first()).toContainText('64.3%');
 await page.locator('#rankingMetric').selectOption('customers');await expect(rows.first()).toContainText('18');await page.locator('#rate').selectOption('');await expect(rows.first()).toContainText('60');
});

test('時間選択を貸玉比較とグラフに連動しすべては3回平均を表示する',async({page})=>{
 const report=[text,text.replace('2026/10/06 11時','2026/10/06 15時').replace('合計1名 2%','合計7名 11%'),text.replace('2026/10/06 11時','2026/10/06 19時').replace('合計1名 2%','合計10名 16%')].join('\n');
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(report);await page.locator('#pasteImportBtn').click();
 await page.locator('#time').selectOption('15');await expect(page.locator('#rateCompare')).toContainText('15時');await expect(page.locator('#chartLabel')).toContainText('15時');await expect(page.locator('#rateCompare tbody tr').filter({hasText:'4パチ'})).toContainText('7');
 await page.locator('#time').selectOption('');await expect(page.locator('#rateCompare')).toContainText('11・15・19時平均');await expect(page.locator('#chartLabel')).toContainText('11・15・19時平均');await expect(page.locator('#rateCompare tbody tr').filter({hasText:'4パチ'})).toContainText('6');
 await page.locator('#time').selectOption('19');await expect(page.locator('#rateCompare')).toContainText('19時');await expect(page.locator('#chartLabel')).toContainText('19時');
});

test('最新客数・貸玉比較・共通時間のどこで変更しても全表示が連動する',async({page})=>{
 const report=[text,text.replace('2026/10/06 11時','2026/10/06 15時'),text.replace('2026/10/06 11時','2026/10/06 19時')].join('\n');
 await page.goto('http://127.0.0.1:3102/');await page.locator('#mailText').fill(report);await page.locator('#pasteImportBtn').click();
 await page.locator('#latestTime').selectOption('15');await expect(page.locator('#time')).toHaveValue('15');await expect(page.locator('#rateCompareTime')).toHaveValue('15');await expect(page.locator('#rateCompare')).toContainText('15時');await expect(page.locator('#chartLabel')).toContainText('15時');await expect(page.locator('#rankingContext')).toContainText('15時');
 await page.locator('#rateCompareTime').selectOption('19');await expect(page.locator('#latestTime')).toHaveValue('19');await expect(page.locator('#chartLabel')).toContainText('19時');
 await page.locator('#time').selectOption('');await expect(page.locator('#latestTime')).toHaveValue('average');await expect(page.locator('#rateCompareTime')).toHaveValue('');await expect(page.locator('#rateCompare')).toContainText('11・15・19時平均');
 await page.locator('#chartAggregation').selectOption('time');await expect(page.locator('#latestTime')).toHaveValue('11');await expect(page.locator('#rateCompareTime')).toHaveValue('11');
});
