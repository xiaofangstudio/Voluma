import puppeteer from 'puppeteer-core';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.resolve('.');
const sample = path.join(root, 'assets', 'M0-阅读样本.pdf');
const formSample = path.join(root, 'assets', 'M3-表单样本.pdf');

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9444', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('tauri'));
if (!p) throw new Error('Voluma WebView not found on port 9444');

const theme = () => p.evaluate(() => document.documentElement.dataset.theme);
const assertTheme = async (want, where) => {
  const got = await theme();
  if (got !== want) throw new Error(`${where}: theme ${got}, want ${want}`);
};
const shot = (name) => p.screenshot({ path: `review-m2/${name}.png` });
const park = async () => {
  await p.mouse.move(30, 300);
  await sleep(220);
};

const openMenu = async () => {
  await p.click('button[aria-label^="界面主题"]');
  await p.waitForSelector('.theme-pop', { timeout: 5000 });
  await sleep(200);
};
const chooseTheme = async (label) => {
  await p.evaluate((text) => {
    const node = [...document.querySelectorAll('.theme-opt')].find(
      (x) => x.querySelector('strong')?.textContent?.trim() === text
    );
    if (!node) throw new Error(`no theme option ${text}`);
    node.click();
  }, label);
  await sleep(250);
  await park();
};

await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
await p.evaluate(
  ({ pdfPath, formPath }) => {
    localStorage.setItem('voluma.theme.v1', 'dark');
    localStorage.setItem(
      'voluma.recents.v1',
      JSON.stringify([
        { path: pdfPath, name: 'M0-阅读样本', size: 4764, pages: 5, lastPage: 1, zoom: 100, updatedAt: Date.now() },
        { path: formPath, name: 'M3-表单样本', size: 8173, pages: 1, lastPage: 1, zoom: 100, updatedAt: Date.now() - 1000 },
      ])
    );
  },
  { pdfPath: sample, formPath: formSample }
);
await p.reload({ waitUntil: 'networkidle2' });
await sleep(1100);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await assertTheme('dark', 'welcome');
await shot('120-m7-welcome-dark');
const bar = await p.evaluate(() => {
  const el = document.querySelector('.pdf-card .bar');
  const fill = el?.querySelector('i');
  return el && fill ? [el.getBoundingClientRect().height, fill.getBoundingClientRect().height] : null;
});
if (!bar || bar.some((h) => h > 4)) throw new Error(`recent progress bar height ${bar}`);

await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.page-wrap canvas').length > 0, { timeout: 20000 });
await sleep(900);
await assertTheme('dark', 'reader');
await shot('121-m7-reader-dark');

const pageCheck = await p.evaluate(() => {
  const wrap = document.querySelector('.page-wrap');
  const canvas = wrap?.querySelector('canvas');
  if (!wrap || !canvas) return null;
  const ctx = canvas.getContext('2d');
  const pixel = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 3), 1, 1).data;
  return {
    paper: getComputedStyle(wrap).backgroundColor,
    pixel: [pixel[0], pixel[1], pixel[2]],
    innerWidth: window.innerWidth,
  };
});
if (!pageCheck) throw new Error('page canvas missing');
if (!/255,\s*255,\s*255/.test(pageCheck.paper)) throw new Error(`paper not white: ${pageCheck.paper}`);
if (pageCheck.pixel.some((v) => v < 238)) throw new Error(`page pixel not white: ${pageCheck.pixel}`);
console.log('paper stays white:', pageCheck.paper, pageCheck.pixel.join(','));

/* 顶栏：所有可见按钮都在窗口内，主题入口存在 */
const fit = await p.evaluate(() => {
  const buttons = [...document.querySelectorAll('.iconbar .iconbtn, .iconbar .theme-menu button')];
  const overflow = buttons
    .filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && (r.left < 0 || r.right > window.innerWidth + 0.5);
    })
    .map((b) => b.getAttribute('aria-label') || b.className);
  const themeBtn = document.querySelector('button[aria-label^="界面主题"]');
  return { width: window.innerWidth, count: buttons.length, overflow, hasTheme: !!themeBtn };
});
if (fit.overflow.length) throw new Error(`toolbar overflow: ${fit.overflow.join(',')}`);
if (!fit.hasTheme) throw new Error('theme button missing');
console.log('toolbar:', fit.width, fit.count, 'buttons, no overflow');
await p.hover('button[aria-label^="界面主题"]');
await sleep(700);
const tip = await p.$eval('.theme-menu .tip', (el) => {
  const r = el.getBoundingClientRect();
  return { right: r.right, left: r.left, width: r.width };
});
if (tip.right > fit.width + 0.5 || tip.left < 0) throw new Error(`theme tooltip clipped: ${JSON.stringify(tip)}`);
await park();

/* 深色侧栏 */
await p.click('button[aria-label="缩略图"]');
await sleep(700);
await park();
await shot('122-m7-sidebar-dark');
await p.click('button[aria-label="缩略图"]');

/* 深色页面管理 */
await p.click('button[aria-label="页面管理"]');
await p.waitForSelector('.pm', { timeout: 8000 });
await sleep(600);
await shot('123-m7-pages-dark');
await p.click('button[aria-label="关闭页面管理"]');
await sleep(300);

/* 深色 PDF 工具 */
await p.click('button[aria-label="PDF 工具"]');
await p.waitForSelector('.tk', { timeout: 8000 });
await sleep(600);
await shot('124-m7-toolkit-dark');
await p.click('button[aria-label="关闭工具"]');
await sleep(300);

/* 深色打印面板 */
await p.click('button[aria-label="打印"]');
await p.waitForSelector('.print-panel', { timeout: 8000 });
await sleep(400);
await shot('129-m7-print-dark');
await p.click('button[aria-label="关闭打印面板"]');
await sleep(300);

/* 深色注释工具条 */
await p.click('button[aria-label="高亮"]');
await sleep(500);
await park();
await shot('128-m7-annotbar-dark');
await p.click('button[aria-label="高亮"]');
await sleep(200);

/* 主题菜单与浅色切换 */
await openMenu();
await park();
await shot('125-m7-theme-menu-dark');
await chooseTheme('浅色');
await assertTheme('light', 'switch to light');
await sleep(500);
await shot('127-m7-reader-light');

/* 回到深色 */
await openMenu();
await chooseTheme('深色');
await assertTheme('dark', 'switch back to dark');

/* 跟随系统 */
await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await openMenu();
await chooseTheme('跟随系统');
await assertTheme('dark', 'system dark');
await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
await sleep(500);
await assertTheme('light', 'system follows light');
await openMenu();
await chooseTheme('深色');
await assertTheme('dark', 'system -> fixed dark');

/* 持久化：重载后仍为深色 */
await p.reload({ waitUntil: 'networkidle2' });
await sleep(1000);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await assertTheme('dark', 'persisted after reload');
const stored = await p.evaluate(() => localStorage.getItem('voluma.theme.v1'));
if (stored !== 'dark') throw new Error(`stored theme ${stored}`);

/* 欢迎页浅色截图，再切回深色 */
await openMenu();
await chooseTheme('浅色');
await assertTheme('light', 'welcome light');
await shot('126-m7-welcome-light');
await openMenu();
await chooseTheme('深色');
await assertTheme('dark', 'welcome dark final');

/* 深色表单概览 */
await p.evaluate(() => {
  const row = [...document.querySelectorAll('.recent-row')].find((x) => x.textContent?.includes('M3-表单样本'));
  if (!row) throw new Error('M3 recent row missing');
  row.click();
});
await p.waitForFunction(() => document.querySelectorAll('.page-wrap canvas').length > 0, { timeout: 20000 });
await p.waitForFunction(() => !document.querySelector('button[aria-label="表单"]')?.disabled, { timeout: 8000 });
await sleep(500);
await p.click('button[aria-label="表单"]');
await p.waitForSelector('.form-panel', { timeout: 8000 });
await sleep(500);
await park();
await shot('130-m7-form-dark');
await p.click('button[aria-label="关闭表单"]');
await sleep(250);
await p.click('button[aria-label="关闭文档"]');
await sleep(600);
await assertTheme('dark', 'final welcome');

await b.disconnect();
console.log('Theme UI OK');
