import puppeteer from 'puppeteer-core';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.resolve('.');
const sample = path.join(root, 'assets', 'M8-朗读样本.pdf');

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9444', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('tauri'));
if (!p) throw new Error('Voluma WebView not found on port 9444');
await p.setViewport({ width: 1280, height: 820 });

const shot = (name) => p.screenshot({ path: `review-m2/${name}.png` });
const park = async () => {
  await p.mouse.move(30, 300);
  await sleep(200);
};
const state = () =>
  p.evaluate(() => ({
    status: document.querySelector('.tts-state')?.textContent ?? '',
    text: document.querySelector('.tts-text')?.textContent ?? '',
    head: document.querySelector('.tts-head')?.textContent ?? '',
    page: Number(document.querySelector('.page-wrap')?.dataset.page ?? 0),
    high: document.querySelectorAll('.tts-focus .tts-line').length,
    speaking: window.speechSynthesis.speaking,
    paused: window.speechSynthesis.paused,
    bar: !!document.querySelector('.tts-bar'),
  }));
const waitStatus = async (want, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await state();
    if (s.status === want) return s;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${want}: ${JSON.stringify(await state())}`);
};

/* 打开 2 页中文朗读样本，固定深色主题，清空朗读偏好 */
await p.evaluate(
  ({ pdfPath }) => {
    localStorage.setItem('voluma.theme.v1', 'dark');
    localStorage.removeItem('voluma.tts.v1');
    localStorage.setItem(
      'voluma.recents.v1',
      JSON.stringify([
        { path: pdfPath, name: 'M8-朗读样本', size: 41202, pages: 2, lastPage: 1, zoom: 100, updatedAt: Date.now() },
      ])
    );
  },
  { pdfPath: sample }
);
await p.reload({ waitUntil: 'networkidle2' });
await sleep(900);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.page-wrap canvas').length > 0, { timeout: 20000 });
await sleep(700);

/* 顶栏 28 个入口，1280 不溢出 */
const fit = await p.evaluate(() => {
  const buttons = [...document.querySelectorAll('.iconbar .iconbtn, .iconbar .theme-menu button')];
  return {
    width: window.innerWidth,
    count: buttons.length,
    overflow: buttons
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && (r.left < -0.5 || r.right > window.innerWidth + 0.5);
      })
      .map((b) => b.getAttribute('aria-label') || b.className),
  };
});
if (fit.overflow.length) throw new Error(`toolbar overflow: ${fit.overflow.join(',')}`);
console.log('toolbar:', fit.width, fit.count, 'buttons, no overflow');

/* 打开朗读条，系统语音列表 */
await p.click('button[aria-label="朗读"]');
await p.waitForSelector('.tts-bar', { timeout: 5000 });
await sleep(600);
const voices = await p.evaluate(() =>
  [...document.querySelectorAll('.tts-voice option')].map((o) => ({
    value: o.value,
    text: o.textContent,
  }))
);
if (!voices.length) throw new Error('no system voices');
const zhCount = await p.evaluate(() => speechSynthesis.getVoices().filter((v) => /^zh/i.test(v.lang)).length);
if (!zhCount) throw new Error('no zh-CN system voice');
const localCount = await p.evaluate(() => speechSynthesis.getVoices().filter((v) => v.localService).length);
if (!localCount) throw new Error('no local system voice');
const remoteInList = await p.evaluate(
  (local) => [...document.querySelectorAll('.tts-voice option')].filter((o) => !local.includes(o.value)).length,
  await p.evaluate(() => speechSynthesis.getVoices().filter((v) => v.localService).map((v) => v.name))
);
if (remoteInList) throw new Error('remote voice leaked into list');
console.log('voices:', voices.map((v) => v.text).join(' / '));

/* 播放、页内高亮 */
await p.click('.tts-play');
const playing = await waitStatus('正在朗读');
if (!/朗读样本第一页/.test(playing.text)) throw new Error(`unexpected first segment: ${playing.text}`);
if (!playing.high) throw new Error('no in-page highlight');
await park();
await shot('131-m8-tts-dark');
console.log('playing:', playing.text, 'highlight lines', playing.high);

/* 暂停 / 继续 */
await p.click('.tts-play');
await waitStatus('已暂停');
const paused = await state();
if (!paused.paused) throw new Error('speechSynthesis not paused');
await p.click('.tts-play');
await waitStatus('正在朗读');
console.log('pause and resume OK');

/* 下一段 */
await p.click('button[aria-label="下一段"]');
await sleep(1000);
const next = await state();
if (!/第一页读完后/.test(next.text)) throw new Error(`next segment wrong: ${next.text}`);
if (!/2\/3 段/.test(next.head)) throw new Error(`segment counter wrong: ${next.head}`);
console.log('next segment OK:', next.head);

/* 停止 */
await p.click('button[aria-label="停止朗读"]');
await waitStatus('未开始', 3000);
const stopped = await state();
if (stopped.high !== 0) throw new Error('highlight not cleared after stop');
if (!/已停止/.test(stopped.text)) throw new Error(`stop message missing: ${stopped.text}`);
console.log('stop OK');

/* 语速持久化，并自动跨页读完 */
await p.evaluate(() => {
  const input = document.querySelector('.tts-rate input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '1.6');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await p.select('.tts-voice select', voices[voices.length - 1].value);
await sleep(250);
const prefs = await p.evaluate(() => localStorage.getItem('voluma.tts.v1'));
if (!prefs?.includes('1.6') || !prefs.includes(voices[voices.length - 1].value)) throw new Error('prefs not saved');
await p.click('.tts-play');
const t0 = Date.now();
let done = null;
while (Date.now() - t0 < 32000) {
  await sleep(300);
  const s = await state();
  if (s.status === '已读完' && /已读完/.test(s.text)) {
    done = s;
    break;
  }
}
if (!done) throw new Error(`auto finish timeout: ${JSON.stringify(await state())}`);
if (done.page !== 2 || done.high !== 0) throw new Error(`finish state wrong: ${JSON.stringify(done)}`);
console.log('auto page advance and finish OK in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await shot('132-m8-tts-finished');

/* 重载后偏好仍在 */
await p.reload({ waitUntil: 'networkidle2' });
await sleep(900);
await p.waitForSelector('.recent-row', { timeout: 10000 });
await p.click('.recent-row');
await p.waitForFunction(() => document.querySelectorAll('.page-wrap canvas').length > 0, { timeout: 20000 });
await sleep(600);
await p.click('button[aria-label="朗读"]');
await sleep(500);
const persisted = await p.evaluate(() => ({
  voice: document.querySelector('.tts-voice select')?.value,
  rate: document.querySelector('.tts-rate input')?.value,
  stored: localStorage.getItem('voluma.tts.v1'),
}));
if (String(persisted.rate) !== '1.6') throw new Error(`rate not persisted: ${JSON.stringify(persisted)}`);
console.log('prefs persisted:', persisted.voice, persisted.rate);

/* 滚到第 2 页再点播放，应该从当前页开始而不是旧页 */
await p.keyboard.press('End');
await sleep(500);
if ((await state()).page !== 2) throw new Error('End did not go to page 2');
await p.click('.tts-play');
const fromCurrent = await waitStatus('正在朗读');
if (!/第 2 页/.test(fromCurrent.head) || !/朗读样本第二页/.test(fromCurrent.text)) {
  throw new Error(`did not start from current page: ${JSON.stringify(fromCurrent)}`);
}
await p.click('button[aria-label="停止朗读"]');
await waitStatus('未开始', 3000);
console.log('start from current page OK');

/* 快捷键：Alt+R 开关，Escape 关闭 */
await p.keyboard.press('Escape');
await sleep(350);
if ((await state()).bar) throw new Error('Escape did not close TTS bar');
await p.keyboard.down('Alt');
await p.keyboard.press('r');
await p.keyboard.up('Alt');
await sleep(450);
if (!(await state()).bar) throw new Error('Alt+R did not open TTS bar');
await p.keyboard.press('Escape');
await sleep(350);

/* 900 宽窗口工具栏与朗读条不溢出 */
await p.setViewport({ width: 900, height: 620 });
await sleep(500);
await p.click('button[aria-label="朗读"]');
await sleep(400);
const narrow = await p.evaluate(() => {
  const buttons = [...document.querySelectorAll('.iconbar .iconbtn, .iconbar .theme-menu button')];
  const bar = document.querySelector('.tts-bar')?.getBoundingClientRect();
  return {
    width: window.innerWidth,
    overflow: buttons
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && (r.left < -0.5 || r.right > window.innerWidth + 0.5);
      })
      .map((b) => b.getAttribute('aria-label') || b.className),
    bar: bar ? { left: bar.left, right: bar.right, bottom: bar.bottom } : null,
  };
});
if (narrow.overflow.length) throw new Error(`narrow toolbar overflow: ${narrow.overflow.join(',')}`);
if (!narrow.bar || narrow.bar.left < 0 || narrow.bar.right > narrow.width) throw new Error('TTS bar clipped');
await park();
await shot('133-m8-tts-900');
console.log('900px fit:', JSON.stringify(narrow));

/* 复位默认语音与语速，恢复 1280，回到欢迎页 */
await p.setViewport({ width: 1280, height: 820 });
await sleep(400);
if (await p.$('.tts-bar')) await p.click('button[aria-label="关闭朗读"]');
const huihui = voices.find((v) => v.value.includes('Huihui'))?.value ?? voices[0].value;
await p.click('button[aria-label="朗读"]');
await sleep(400);
await p.select('.tts-voice select', huihui);
await p.evaluate(() => {
  const input = document.querySelector('.tts-rate input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '1');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(250);
await p.click('button[aria-label="关闭朗读"]');
await p.click('button[aria-label="关闭文档"]');
await sleep(700);
const finalTheme = await p.evaluate(() => document.documentElement.dataset.theme);
if (finalTheme !== 'dark') throw new Error(`final theme ${finalTheme}`);

await b.disconnect();
console.log('TTS UI OK');
