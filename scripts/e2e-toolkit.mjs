import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.resolve('.');
const sample = path.join(root, 'assets', 'M0-阅读样本.pdf');
const outDir = path.join(root, 'tmp-e2e');
fs.mkdirSync(outDir, { recursive: true });
const mergePart = path.join(outDir, 'merge-part.pdf');
fs.copyFileSync(sample, mergePart);

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9444', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('tauri'));
if (!p) throw new Error('Voluma WebView not found on port 9444');

const setInput = async (selector, value) => {
  await p.evaluate(
    (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`input not found: ${sel}`);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    selector,
    value
  );
};

const clickText = async (selector, text) => {
  await p.evaluate(
    (sel, t) => {
      const node = [...document.querySelectorAll(sel)].find((x) => x.textContent?.includes(t));
      if (!node) throw new Error(`no ${sel} containing ${t}`);
      node.click();
    },
    selector,
    text
  );
};

const openPanel = async () => {
  if (await p.$('.tk')) return;
  await p.click('button[aria-label="PDF 工具"]');
  await p.waitForSelector('.tk', { timeout: 10000 });
  await sleep(400);
};

await p.evaluate((pdfPath) => {
  localStorage.setItem(
    'voluma.recents.v1',
    JSON.stringify([
      { path: pdfPath, name: 'M0-阅读样本', size: 4764, pages: 5, lastPage: 1, zoom: 100, updatedAt: Date.now() },
    ])
  );
}, sample);
await p.reload({ waitUntil: 'networkidle2' });
await sleep(900);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.page-wrap canvas').length > 0, { timeout: 20000 });
await sleep(900);
console.log('window css width:', await p.evaluate(() => window.innerWidth));
await p.screenshot({ path: 'review-m2/110-m6-main.png' });
await openPanel();
await p.screenshot({ path: 'review-m2/111-m6-merge.png' });
await clickText('.tk-tab', '拆分');
await sleep(300);
await p.screenshot({ path: 'review-m2/112-m6-split.png' });
await clickText('.tk-tab', '裁切');
await p.waitForFunction(() => document.querySelectorAll('.tk-preview-frame canvas').length > 0, { timeout: 12000 });
await sleep(500);
await p.screenshot({ path: 'review-m2/113-m6-crop.png' });
if (!(await p.$eval('.tk-foot .btn-primary', (b) => b.disabled))) throw new Error('zero-margin crop button should be disabled');
await clickText('.tk-tab', '合并');
await sleep(300);

/* 合并：走真实原生文件对话框，加入同一个样本，结果 10 页 */
await clickText('.tk-add', '加入其他 PDF');
await sleep(500);
execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/fill-file-dialog.ps1', '-Title', '选择要合并的 PDF', '-Path', mergePart], {
  encoding: 'utf8',
});
await p.waitForFunction(() => document.querySelectorAll('.tk-file').length === 2, { timeout: 12000 });
const mergeDest = path.join(outDir, 'ui-merge.pdf');
await setInput('.tk-body input', mergeDest);
await sleep(100);
await p.screenshot({ path: 'review-m2/114-m6-merge-staged.png' });
await p.click('.tk-foot .btn-primary');
await p.waitForFunction(() => document.querySelector('.tk-foot .pm-hint')?.textContent?.includes('已合并'), { timeout: 20000 });
const merged = await PDFDocument.load(fs.readFileSync(mergeDest));
if (merged.getPageCount() !== 10) throw new Error(`merge pages ${merged.getPageCount()}`);
await p.screenshot({ path: 'review-m2/115-m6-merge-done.png' });
console.log('merge ok: 10 pages');

/* 拆分：每 2 页一份，输出到 tmp-e2e */
await clickText('.tk-tab', '拆分');
await sleep(300);
await setInput('.tk-body input[type="number"]', '2');
await setInput('.tk-row input:not([type="number"])', 'ui-part');
await setInput('.tk-path input', outDir);
await sleep(150);
await p.click('.tk-foot .btn-primary');
await p.waitForFunction(() => document.querySelectorAll('.tk-results span').length === 3, { timeout: 20000 });
const splitFiles = await p.evaluate(() => [...document.querySelectorAll('.tk-results span')].map((x) => x.getAttribute('title')));
const counts = splitFiles.map((f) => PDFDocument.load(fs.readFileSync(f)).then((d) => d.getPageCount()));
const pages = await Promise.all(counts);
if (pages.join(',') !== '2,2,1') throw new Error(`split pages ${pages.join(',')}`);
await p.screenshot({ path: 'review-m2/116-m6-split-done.png' });
console.log('split ok:', pages.join(','));

/* 裁切：四边 10mm，检查 CropBox */
await clickText('.tk-tab', '裁切');
await sleep(500);
for (let i = 0; i < 4; i++) {
  await p.evaluate((idx) => {
    const el = document.querySelectorAll('.tk-margin input')[idx];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, '10');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, i);
}
const cropDest = path.join(outDir, 'ui-crop.pdf');
await setInput('.tk-body .tk-field input', cropDest);
await sleep(300);
const overlay = await p.evaluate(() => {
  const f = document.querySelector('.tk-preview-frame').getBoundingClientRect();
  const c = document.querySelector('.tk-crop-box').getBoundingClientRect();
  return { fw: f.width, fh: f.height, top: c.top - f.top, left: c.left - f.left, right: f.right - c.right, bottom: f.bottom - c.bottom };
});
const mm10 = 10 / 25.4;
const wantTop = (mm10 / (792 / 72)) * overlay.fh;
const wantLeft = (mm10 / (612 / 72)) * overlay.fw;
for (const [name, got, want] of [
  ['top', overlay.top, wantTop],
  ['left', overlay.left, wantLeft],
  ['right', overlay.right, wantLeft],
  ['bottom', overlay.bottom, wantTop],
]) {
  if (Math.abs(got - want) > 2) throw new Error(`crop preview ${name} ${got.toFixed(1)} vs ${want.toFixed(1)}`);
}
await p.screenshot({ path: 'review-m2/117-m6-crop-preview.png' });
if (await p.$eval('.tk-foot .btn-primary', (b) => b.disabled)) throw new Error('crop button still disabled after margins');
await p.click('.tk-foot .btn-primary');
await p.waitForFunction(() => document.querySelector('.tk-foot .pm-hint')?.textContent?.includes('已裁切'), { timeout: 20000 });
const cropped = await PDFDocument.load(fs.readFileSync(cropDest));
const box = cropped.getPage(0).getCropBox();
const expected = 10 * (72 / 25.4);
const media = cropped.getPage(0).getMediaBox();
if (Math.abs(box.x - (media.x + expected)) > 0.1 || Math.abs(box.width - (media.width - expected * 2)) > 0.1) {
  throw new Error(`crop box ${JSON.stringify(box)} media ${JSON.stringify(media)}`);
}
await p.screenshot({ path: 'review-m2/118-m6-crop-done.png' });
console.log('crop ok:', JSON.stringify(box));

await b.disconnect();
console.log('Toolkit UI OK');
