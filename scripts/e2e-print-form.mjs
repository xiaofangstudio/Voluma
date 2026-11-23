import puppeteer from 'puppeteer-core';
import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sample = path.resolve('tmp-e2e/forms-m3-cjk.pdf');

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('1420') || x.url().includes('tauri'));
await p.evaluate((pdfPath) => {
  localStorage.setItem('voluma.recents.v1', JSON.stringify([{ path: pdfPath, name: 'forms-m3-cjk', size: 11181, pages: 1, lastPage: 1, zoom: 100, updatedAt: Date.now() }]));
}, sample);
await p.reload({ waitUntil: 'networkidle2' });
await sleep(600);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.pages canvas').length > 0, { timeout: 20000 });
await sleep(900);

await p.keyboard.down('Control'); await p.keyboard.press('P'); await p.keyboard.up('Control');
await p.waitForSelector('.print-panel', { timeout: 5000 });
await p.evaluate(() => { window.print = () => { window.__volumaPrinted = true; }; });
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.print-panel .btn-primary')].find((x) => x.textContent?.includes('打印'));
  btn?.click();
});
await p.waitForFunction(() => document.querySelectorAll('#voluma-print canvas').length === 1, { timeout: 20000 });
await p.emulateMediaType('print');
await sleep(300);
await p.screenshot({ path: 'review-m2/73-print-form.png', fullPage: true });
await p.emulateMediaType('screen');
await b.disconnect();
