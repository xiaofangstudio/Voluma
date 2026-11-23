import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = path.resolve('tmp-e2e/long-40.pdf');
const baseBytes = fs.readFileSync(path.resolve('assets/M0-阅读样本.pdf'));
const base = await PDFDocument.load(baseBytes);
const out = await PDFDocument.create();
for (let i = 0; i < 40; i++) {
  const [page] = await out.copyPages(base, [i % base.getPageCount()]);
  out.addPage(page);
}
fs.writeFileSync(src, await out.save());

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('1420') || x.url().includes('tauri'));
await p.evaluate((pdfPath) => {
  localStorage.setItem('voluma.recents.v1', JSON.stringify([{ path: pdfPath, name: 'long-40', size: 0, pages: 40, lastPage: 1, zoom: 100, updatedAt: Date.now() }]));
}, src);
await p.reload({ waitUntil: 'networkidle2' });
await sleep(700);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelector('.pagebar')?.textContent?.includes('40'), { timeout: 20000 });
await sleep(900);

await p.keyboard.down('Control'); await p.keyboard.press('P'); await p.keyboard.up('Control');
await p.waitForSelector('.print-panel', { timeout: 5000 });
await p.evaluate(() => { window.print = () => { window.__volumaPrinted = true; }; });
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.print-panel .btn-primary')].find((x) => x.textContent?.includes('打印'));
  btn?.click();
});
await p.waitForFunction(() => {
  const root = document.querySelector('#voluma-print');
  return root && (root.querySelectorAll('img').length === 40 || root.querySelectorAll('canvas').length === 40);
}, { timeout: 60000 });
await sleep(300);
const dom = await p.evaluate(() => {
  const root = document.querySelector('#voluma-print');
  const imgs = [...root.querySelectorAll('img')];
  return {
    imgs: imgs.length,
    canvases: root.querySelectorAll('canvas').length,
    natural: imgs[0] && { w: imgs[0].naturalWidth, h: imgs[0].naturalHeight },
    bytes: imgs[0]?.src?.length,
    pages: root.querySelectorAll('.print-page').length,
    rootH: Math.round(root.getBoundingClientRect().height),
  };
});
console.log('long', JSON.stringify(dom));
await p.emulateMediaType('print');
await sleep(300);
await p.screenshot({ path: 'review-m2/76-print-40p-firstpage.png', clip: { x: 0, y: 0, width: 780, height: 1080 } });
await p.emulateMediaType('screen');
await p.evaluate(() => { document.querySelector('#voluma-print')?.remove(); });
await b.disconnect();
