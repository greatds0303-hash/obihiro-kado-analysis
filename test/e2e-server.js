import express from 'express';
import {fileURLToPath} from 'node:url';
import {createApp} from '../src/app.js';
import {openRepository} from '../src/db.js';
import {createSyncService} from '../src/sync.js';
import {loadConfig} from '../src/config.js';
import {readFileSync} from 'node:fs';
const repository=openRepository(':memory:');
const text=readFileSync(new URL('./fixtures/report.txt',import.meta.url),'utf8');
const syncService=createSyncService(repository,{scope:'e2e',async fetch(){return {uidValidity:'1',messages:[{uid:1,messageId:'<e2e>',subject:'稼働報告',sender:'square_obihiro@eaglegroup.co.jp',text}]};}});
createApp({repository,syncService,config:loadConfig({})}).listen(3100,'127.0.0.1');

// A real static-only host: no API routes or backend integration.
express().use(express.static(fileURLToPath(new URL('../public/',import.meta.url)))).listen(3102,'127.0.0.1');
