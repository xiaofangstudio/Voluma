import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = path.resolve('tmp-e2e/clean-export.pdf');
const dest = path.resolve('tmp-e2e/clean-export-out.pdf');
fs.copyFileSync(path.resolve('assets/M0-阅读样本.pdf'), src);
try { fs.rmSync(dest, { force: true }); } catch {}

const fill = (title, p) => {
  console.log(execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/fill-file-dialog.ps1', '-Title', title, '-Path', p], { encoding: 'utf8' }));
};

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('1420') || x.url().includes('tauri'));
await p.evaluate((pdfPath) => {
  localStorage.setItem('voluma.recents.v1', JSON.stringify([{ path: pdfPath, name: 'clean-export', size: 4764, pages: 5, lastPage: 1, zoom: 100, updatedAt: Date.now() }]));
}, src);
await p.reload({ waitUntil: 'networkidle2' });
await sleep(600);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.pages canvas').length > 0, { timeout: 20000 });
await sleep(800);

const line = await p.evaluate(() => {
  const spans = [...document.querySelectorAll('.textLayer span')].filter((s) => s.textContent.trim().length > 2);
  const target = spans.find((s) => s.getBoundingClientRect().width > 120) ?? spans[0];
  if (!target) return null;
  const r = target.getBoundingClientRect();
  return { text: target.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log('line', line?.text);
await p.click('button[aria-label="高亮"]');
await sleep(200);
await p.mouse.move(line.x + 2, line.y + line.h / 2);
await p.mouse.down();
await p.mouse.move(line.x + line.w - 2, line.y + line.h / 2, { steps: 8 });
await p.mouse.up();
await sleep(1600);
console.log('annot', await p.evaluate(() => ({ count: document.querySelectorAll('.annot').length, chip: document.querySelector('.save-chip')?.textContent })));

await p.click('button[aria-label="导出无注释版"]');
await sleep(400);
fill('导出无注释版 PDF', dest);
for (let i = 0; i < 32 && !fs.existsSync(dest); i++) await sleep(250);
await sleep(900);
console.log('toast', await p.evaluate(() => document.querySelector('.toast')?.textContent));
console.log('out', fs.existsSync(dest), fs.existsSync(dest) ? fs.statSync(dest).size : 0);
await p.screenshot({ path: 'review-m2/71-export-clean.png' });
await b.disconnect();
