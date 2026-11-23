import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sample = path.resolve('assets/M0-阅读样本.pdf');
const outDir = path.resolve('tmp-e2e');
fs.mkdirSync(outDir, { recursive: true });

const cases = [
  { tag: 'all', label: null, expected: 5 },
  { tag: '2up', label: '每张 2 页', expected: 3 },
  { tag: '4up', label: '每张 4 页', expected: 2 },
];

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9444', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('tauri'));
if (!p) throw new Error('Voluma WebView not found on port 9444');

await p.evaluate((pdfPath) => {
  localStorage.setItem(
    'voluma.recents.v1',
    JSON.stringify([{ path: pdfPath, name: 'paginate-check', size: 4764, pages: 5, lastPage: 1, zoom: 100, updatedAt: Date.now() }])
  );
}, sample);
await p.reload({ waitUntil: 'networkidle2' });
await sleep(700);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.pages canvas').length > 0, { timeout: 20000 });
await sleep(700);

const results = [];
for (const c of cases) {
  await p.evaluate(() => document.getElementById('voluma-print')?.remove());
  await p.keyboard.down('Control');
  await p.keyboard.press('P');
  await p.keyboard.up('Control');
  await p.waitForSelector('.print-panel', { timeout: 8000 });
  if (c.label) {
    await p.evaluate((label) => {
      const item = [...document.querySelectorAll('.print-layout')].find((x) => x.textContent?.includes(label));
      item?.click();
    }, c.label);
    await sleep(120);
  }
  await p.evaluate(() => {
    window.print = () => {};
    const btn = [...document.querySelectorAll('.print-panel .btn-primary')].find((x) => x.textContent?.includes('打印'));
    btn?.click();
  });
  await p.waitForFunction(() => document.querySelectorAll('#voluma-print .print-page, #voluma-print .print-sheet').length > 0, { timeout: 30000 });
  const f = path.join(outDir, `paginate-${c.tag}.pdf`);
  await p.pdf({ path: f, printBackground: true, preferCSSPageSize: true });
  const doc = await PDFDocument.load(fs.readFileSync(f));
  const pages = doc.getPageCount();
  results.push({ tag: c.tag, expected: c.expected, actual: pages, size: `${Math.round(doc.getPage(0).getWidth())}x${Math.round(doc.getPage(0).getHeight())}` });
  console.log(`${c.tag}: ${pages} pages (expect ${c.expected})`);
}

await p.evaluate(() => document.getElementById('voluma-print')?.remove());
await b.disconnect();

const failed = results.filter((r) => r.actual !== r.expected);
if (failed.length) {
  console.error('Pagination regression:', JSON.stringify(results));
  process.exit(1);
}
console.log('Pagination OK:', JSON.stringify(results));
