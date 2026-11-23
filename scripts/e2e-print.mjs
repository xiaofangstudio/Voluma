import puppeteer from 'puppeteer-core';
import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sample = path.resolve('assets/M0-阅读样本.pdf');
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('1420') || x.url().includes('tauri'));
p.on('dialog', async (d) => { console.log('dialog', d.message()); await d.accept(); });

await p.evaluate((pdfPath) => {
  localStorage.setItem('voluma.recents.v1', JSON.stringify([{ path: pdfPath, name: 'M0-阅读样本', size: 4764, pages: 5, lastPage: 1, zoom: 100, updatedAt: Date.now() }]));
}, sample);
await p.reload({ waitUntil: 'networkidle2' });
await sleep(700);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.pages canvas').length > 0, { timeout: 20000 });
await sleep(1000);
await p.screenshot({ path: 'review-m2/61-m4-main.png' });

await p.keyboard.down('Control');
await p.keyboard.press('P');
await p.keyboard.up('Control');
await p.waitForSelector('.print-panel', { timeout: 5000 });
await sleep(350);
await p.screenshot({ path: 'review-m2/62-print-panel.png' });

const panel = await p.evaluate(() => ({
  title: document.querySelector('.print-panel h2')?.textContent?.trim(),
  sub: document.querySelector('.print-panel .form-sub')?.textContent?.trim(),
  notes: [...document.querySelectorAll('.print-panel .print-note')].map((x) => x.textContent?.trim()),
  layouts: [...document.querySelectorAll('.print-layout')].map((x) => ({ label: x.textContent?.trim(), on: x.classList.contains('on') })),
}));
console.log('panel', JSON.stringify(panel));

await p.evaluate(() => {
  const seg = [...document.querySelectorAll('.print-seg button')].find((x) => x.textContent?.trim() === '自定义');
  seg?.click();
});
await p.waitForSelector('.print-range', { timeout: 3000 });
await p.click('.print-range');
await p.keyboard.type('1-3');
await sleep(300);
console.log('range-note', await p.evaluate(() => document.querySelectorAll('.print-panel .print-note')[0]?.textContent?.trim()));
await p.screenshot({ path: 'review-m2/63-print-custom.png' });

await p.evaluate(() => {
  window.print = () => { window.__volumaPrinted = true; };
});
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.print-panel .btn-primary')].find((x) => x.textContent?.includes('打印'));
  btn?.click();
});
await p.waitForFunction(() => document.querySelectorAll('#voluma-print canvas').length === 3, { timeout: 30000 });
await sleep(500);
const dom = await p.evaluate(() => {
  const root = document.querySelector('#voluma-print');
  return {
    root: !!root,
    layout: root?.className,
    pages: root?.querySelectorAll('.print-page').length,
    canvas: root?.querySelectorAll('canvas').length,
    first: root?.querySelector('canvas') && {
      w: root.querySelector('canvas').width,
      h: root.querySelector('canvas').height,
      page: root.querySelector('canvas').dataset.page,
    },
    printed: !!window.__volumaPrinted,
  };
});
console.log('dom', JSON.stringify(dom));

await p.emulateMediaType('print');
await sleep(300);
await p.screenshot({ path: 'review-m2/64-print-layout.png', fullPage: true });
await p.emulateMediaType('screen');

await p.reload({ waitUntil: 'networkidle2' });
await sleep(500);
console.log('cleanup-after-reload', await p.evaluate(() => !!document.querySelector('#voluma-print')));
await p.screenshot({ path: 'review-m2/65-print-closed.png' });
await b.disconnect();
