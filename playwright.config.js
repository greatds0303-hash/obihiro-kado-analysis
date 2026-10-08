import {existsSync} from 'node:fs';
import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./test',testMatch:'pwa.spec.js',fullyParallel:false,workers:1,timeout:30000,use:{baseURL:'http://127.0.0.1:3100',viewport:{width:390,height:844},launchOptions:{executablePath:process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)},trace:'retain-on-failure'},webServer:{command:'node test/e2e-server.js',url:'http://127.0.0.1:3100',reuseExistingServer:false,timeout:15000}});
