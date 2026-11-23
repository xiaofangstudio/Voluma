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
await p.evaluate(() => { window.print = () => { window.__volumaPrinted = true; }; });

for (const [label, file] of [['每张 2 页', '74-print-2up.png'], ['每张 4 页', '75-print-4up.png']]) {
  await p.keyboard.down('Control'); await p.keyboard.press('P'); await p.keyboard.up('Control');
  await p.waitForSelector('.print-panel', { timeout: 5000 });
  await p.evaluate((name) => {
    const card = [...document.querySelectorAll('.print-layout')].find((x) => x.textContent?.trim() === name);
    card?.click();
  }, label);
  await sleep(250);
  const note = await p.evaluate(() => [...document.querySelectorAll('.print-panel .print-note')].map((x) => x.textContent?.trim()));
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.print-panel .btn-primary')].find((x) => x.textContent?.includes('打印'));
    btn?.click();
  });
  await p.waitForFunction(() => document.querySelectorAll('#voluma-print canvas').length === 5, { timeout: 30000 });
  await p.emulateMediaType('print');
  await sleep(300);
  const geo = await p.evaluate(() => {
    const root = document.querySelector('#voluma-print');
    return {
      layout: root.className,
      sheets: root.querySelectorAll('.print-sheet').length,
      first: [...root.querySelectorAll('.print-sheet')].map((s) => ({
        cells: s.querySelectorAll('.print-cell').length,
        w: Math.round(s.getBoundingClientRect().width),
        h: Math.round(s.getBoundingClientRect().height),
      })),
    };
  });
  console.log(label, note, JSON.stringify(geo));
  await p.screenshot({ path: `review-m2/${file}`, fullPage: true });
  await p.emulateMediaType('screen');
  await p.evaluate(() => { document.querySelector('#voluma-print')?.remove(); });
}
await b.disconnect();
