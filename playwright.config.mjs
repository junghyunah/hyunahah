import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
export default defineConfig({
  testDir:'./tests/browser',
  use:{baseURL:'http://127.0.0.1:3101',launchOptions:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{}},
  webServer:{command:'node tests/browser-server.mjs',url:'http://127.0.0.1:3101/api/health',reuseExistingServer:false},
  workers:1
});
