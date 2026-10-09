import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseReport, normalizeText} from '../src/parser.js';
import {decodeVmg} from '../src/vmg.js';
const body = readFileSync(new URL('./fixtures/report.txt', import.meta.url), 'utf8');
for (const hour of [11,15,19]) test(`${hour}時の複数店舗・貸玉・総合・注目群`, () => {
 const r = parseReport(body.replace('2026/10/06 11時', `2026/10/06 ${hour}時`));
 assert.equal(r.summaries.length,2); assert.equal(r.records.length,5);
 assert.equal(r.summaries[0].time,hour); assert.equal(r.summaries[0].customers,129);
 assert.equal(r.records[4].rate,'7.5円S'); assert.equal(r.records[4].share,null);
 assert.equal(r.specials[0].group,'スマスロ');
});
test('全角・空白・空行の揺れを解析',()=>{
 const r = parseReport(body.replace('男1名 女0名','男 １ 名   女 ０ 名').replaceAll('\n','\r\n\r\n').replace('2.5円P','２．５ 円 Ｐ'));
 assert.equal(r.records[0].male,1); assert.equal(r.records[0].rate,'2.5円P');
});
test('対象外・不正日付は解析しない',()=>{
 assert.equal(parseReport('普通のメール').summaries.length,0);
 assert.equal(parseReport(body.replace('2026/10/06','2026/02/30')).records.length,0);
});
test('総合なしは算出しシェアを捏造しない',()=>{
 const r = parseReport(body.split('総合計')[0]);
 assert.equal(r.summaries[0].customers,129); assert.equal(r.summaries[0].share,null);
 assert.equal(r.summaries[0].derived,true);
});
test('VMG複数base64本文とMessage-ID欠落',async()=>{
 const vmg = id=>`BEGIN:VMSG\nBEGIN:VBODY\nMessage-ID: ${id}\nSubject: report\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n${Buffer.from(body).toString('base64')}\nEND:VBODY\nEND:VMSG`;
 const emails = await decodeVmg(Buffer.from(vmg('<one>')+'\n'+vmg('')));
 assert.equal(emails.length,2); assert.equal(emails[0].messageId,'<one>');
 assert.equal(emails[1].messageId,null); assert.ok(emails[0].text.includes('129名'));
});
test('正規化はCRLFと全角括弧を統一',()=>assert.equal(normalizeText('（１）\r\n'),' (1)\n'.trimStart()));
test('実Shift_JISのVMGを復号し解析',async()=>{
 const emails=await decodeVmg(readFileSync(new URL('./fixtures/shift-jis.vmg',import.meta.url)));
 assert.equal(parseReport(emails[0].text).summaries[0].customers,129);
});
test('機種別客数と店舗のイベントを次の店舗に混ぜず読み取る',()=>{
 const r=parseReport(body.replace('スマスロ【30台】 10名 33%','ジャグラー 【30台】 6名20%\n北斗転生 【6台】 0名0%\n4.5 9時開店 来店ポイント交換会').replace('総合計12名 12%','総合計12名 12%\n客数シェア 30%\n新台入替'));
 assert.equal(r.specials.find(x=>x.group==='ジャグラー').customers,6);
 assert.equal(r.summaries[0].event,'4.5 9時開店 来店ポイント交換会');
 assert.equal(r.summaries[1].event,'新台入替');
});
