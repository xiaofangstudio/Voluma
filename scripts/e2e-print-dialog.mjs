import puppeteer from 'puppeteer-core';
import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sample = path.resolve('assets/M0-阅读样本.pdf');
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('1420') || x.url().includes('tauri'));

await p.evaluate((pdfPath) => {
  localStorage.setItem('voluma.recents.v1', JSON.stringify([{ path: pdfPath, name: 'M0-阅读样本', size: 4764, pages: 5, lastPage: 1, zoom: 100, updatedAt: Date.now() }]));
}, sample);
await p.reload({ waitUntil: 'networkidle2' });
await sleep(600);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.pages canvas').length > 0, { timeout: 20000 });
await sleep(800);
await p.keyboard.down('Control');
await p.keyboard.press('P');
await p.keyboard.up('Control');
await p.waitForSelector('.print-panel', { timeout: 5000 });
await sleep(250);
console.log('clicking-print');
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.print-panel .btn-primary')].find((x) => x.textContent?.includes('打印'));
  btn?.click();
});
console.log('print-returned');
await sleep(800);
console.log('ui', await p.evaluate(() => ({
  printPanel: !!document.querySelector('.print-panel'),
  printRoot: !!document.querySelector('#voluma-print'),
})));
await b.disconnect();
