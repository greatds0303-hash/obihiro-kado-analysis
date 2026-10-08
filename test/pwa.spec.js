import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const text=readFileSync(new URL('./fixtures/report.txt',import.meta.url),'utf8');
const vmg=`BEGIN:VMSG\nBEGIN:VBODY\nMessage-ID: <e2e>\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n${Buffer.from(text).toString('base64')}\nEND:VBODY\nEND:VMSG`;
test('スマホ起動・同期・総合一覧・貸玉比較・CSV・オフライン再起動',async({page,context})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#syncBtn')).toBeVisible();
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
 await page.goto('/');await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
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
