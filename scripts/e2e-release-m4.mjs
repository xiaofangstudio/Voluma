import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = path.resolve('tmp-e2e/rel-m4.pdf');
const clean = path.resolve('tmp-e2e/rel-m4-clean.pdf');
fs.copyFileSync(path.resolve('assets/M0-阅读样本.pdf'), src);
try { fs.rmSync(clean, { force: true }); } catch {}
const fill = (title, p) => console.log(execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/fill-file-dialog.ps1', '-Title', title, '-Path', p], { encoding: 'utf8' }));

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9444', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('tauri'));
console.log('page', p.url());
await p.evaluate((pdfPath) => {
  localStorage.setItem('voluma.recents.v1', JSON.stringify([{ path: pdfPath, name: 'rel-m4', size: 4764, pages: 5, lastPage: 1, zoom: 100, updatedAt: Date.now() }]));
}, src);
await p.reload({ waitUntil: 'networkidle2' });
await sleep(700);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.pages canvas').length > 0, { timeout: 20000 });
await sleep(900);

const line = await p.evaluate(() => {
  const spans = [...document.querySelectorAll('.textLayer span')].filter((s) => s.textContent.trim().length > 2);
  const target = spans.find((s) => s.getBoundingClientRect().width > 120) ?? spans[0];
  const r = target?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
});
await p.click('button[aria-label="高亮"]');
await sleep(220);
await p.mouse.move(line.x + 2, line.y + line.h / 2);
await p.mouse.down();
await p.mouse.move(line.x + line.w - 2, line.y + line.h / 2, { steps: 8 });
await p.mouse.up();
await sleep(1700);
console.log('annot', await p.evaluate(() => ({ count: document.querySelectorAll('.annot').length, chip: document.querySelector('.save-chip')?.textContent })));
await p.screenshot({ path: 'review-m2/80-release-m4-main.png' });

await p.keyboard.down('Control'); await p.keyboard.press('P'); await p.keyboard.up('Control');
await p.waitForSelector('.print-panel', { timeout: 5000 });
await sleep(300);
await p.screenshot({ path: 'review-m2/81-release-print-panel.png' });

await p.evaluate(() => { window.print = () => { window.__volumaPrinted = true; }; });
await p.evaluate(() => {
  const seg = [...document.querySelectorAll('.print-seg button')].find((x) => x.textContent?.trim() === '当前页');
  seg?.click();
});
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.print-panel .btn-primary')].find((x) => x.textContent?.includes('打印'));
  btn?.click();
});
await p.waitForFunction(() => document.querySelectorAll('#voluma-print canvas, #voluma-print img').length === 1, { timeout: 30000 });
await p.emulateMediaType('print');
await sleep(300);
await p.screenshot({ path: 'review-m2/82-release-print-annot.png', fullPage: true });
await p.emulateMediaType('screen');

await p.reload({ waitUntil: 'networkidle2' });
await sleep(700);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.pages canvas').length > 0, { timeout: 20000 });
await sleep(900);
await p.click('button[aria-label="导出无注释版"]');
let filled = false;
for (let i = 0; i < 12 && !filled; i++) {
  await sleep(250);
  try {
    fill('导出无注释版 PDF', clean);
    filled = true;
  } catch {}
}
if (!filled) throw new Error('native save dialog did not appear');
for (let i = 0; i < 32 && !fs.existsSync(clean); i++) await sleep(250);
await sleep(900);
console.log('toast', await p.evaluate(() => document.querySelector('.toast')?.textContent));
console.log('clean', fs.existsSync(clean), fs.existsSync(clean) ? fs.statSync(clean).size : 0);
await p.screenshot({ path: 'review-m2/83-release-export-clean.png' });

await p.keyboard.down('Control'); await p.keyboard.press('P'); await p.keyboard.up('Control');
await p.waitForSelector('.print-panel', { timeout: 5000 });
await sleep(250);
console.log('open-native-preview');
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.print-panel .btn-primary')].find((x) => x.textContent?.includes('打印'));
  btn?.click();
});
await sleep(6000);
await b.disconnect();
