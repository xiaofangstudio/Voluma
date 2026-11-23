import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = path.resolve('tmp-e2e/clean-form.pdf');
const dest = path.resolve('tmp-e2e/clean-form-out.pdf');
fs.copyFileSync(path.resolve('assets/M3-表单样本.pdf'), src);
try { fs.rmSync(dest, { force: true }); } catch {}
const fill = (title, p) => console.log(execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/fill-file-dialog.ps1', '-Title', title, '-Path', p], { encoding: 'utf8' }));

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('1420') || x.url().includes('tauri'));
await p.evaluate((pdfPath) => {
  localStorage.setItem('voluma.recents.v1', JSON.stringify([{ path: pdfPath, name: 'clean-form', size: 8173, pages: 1, lastPage: 1, zoom: 100, updatedAt: Date.now() }]));
}, src);
await p.reload({ waitUntil: 'networkidle2' });
await sleep(600);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.widgetLayer input').length > 0, { timeout: 20000 });
await sleep(800);
await p.click('button[aria-label="导出无注释版"]');
await sleep(400);
fill('导出无注释版 PDF', dest);
for (let i = 0; i < 32 && !fs.existsSync(dest); i++) await sleep(250);
await sleep(900);
console.log('toast', await p.evaluate(() => document.querySelector('.toast')?.textContent));
console.log('out', fs.existsSync(dest), fs.existsSync(dest) ? fs.statSync(dest).size : 0);
await b.disconnect();
