import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "review");
await mkdir(shots, { recursive: true });

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sample = path.join(root, "assets", "M0-阅读样本.pdf");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  defaultViewport: { width: 1280, height: 820 },
  args: ["--no-first-run", "--force-color-profile=srgb"],
});

try {
  const page = await browser.newPage();
  const snap = async (name) => {
    await page.mouse.move(4, 4);
    await sleep(420);
    await page.screenshot({ path: path.join(shots, name) });
  };
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("http://localhost:1420", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1200);
  const upload = await page.$("input[type=file]");
  await upload.uploadFile(sample);
  await page.waitForFunction(() => document.querySelectorAll(".page-wrap canvas").length > 0, {
    timeout: 20000,
  });
  await sleep(900);
  await snap("10-single.png");

  // 连续模式
  await page.click('button[aria-label="连续"]');
  await sleep(1200);
  await snap("11-continuous.png");
  const cont = await page.evaluate(() => {
    const sc = document.querySelector(".scroller.continuous");
    const slots = document.querySelectorAll(".page-wrap.slot");
    const canvases = document.querySelectorAll(".page-wrap.slot canvas");
    return {
      slots: slots.length,
      canvases: canvases.length,
      textSpans: document.querySelectorAll(".textLayer span").length,
      scrollHeight: sc ? sc.scrollHeight : 0,
      page: document.querySelector(".pageno input")?.value,
    };
  });

  // 滚动换页
  await page.evaluate(() => {
    const sc = document.querySelector(".scroller.continuous");
    if (sc) sc.scrollTop = 1400;
    sc?.dispatchEvent(new Event("scroll"));
  });
  await sleep(700);
  const afterScroll = await page.evaluate(() => ({
    page: document.querySelector(".pageno input")?.value,
    canvases: document.querySelectorAll(".page-wrap.slot canvas").length,
  }));

  // 目录
  await page.click('button[aria-label="目录"]');
  await sleep(600);
  await snap("12-outline.png");
  const outline = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".outline-row")].map((b) => b.textContent?.trim()),
  }));
  const rows = await page.$$(".outline-row");
  if (rows[1]) await rows[1].click();
  await sleep(800);
  const afterOutline = await page.evaluate(() => document.querySelector(".pageno input")?.value);

  // 缩略图
  await page.click('button[aria-label="缩略图"]');
  await sleep(1000);
  await snap("13-thumbs.png");
  const thumbs = await page.evaluate(() => ({
    count: document.querySelectorAll(".thumb").length,
    rendered: document.querySelectorAll(".thumb canvas[data-ready='1']").length,
  }));

  // 搜索
  await page.click('button[aria-label="搜索"]');
  await sleep(200);
  await page.type(".search-box input", "Papyra", { delay: 40 });
  await page.waitForFunction(
    () => {
      const m = document.querySelector(".search-meta");
      return !!m && !m.textContent?.includes("正在搜索") && m.textContent?.includes("条结果");
    },
    { timeout: 30000 }
  );
  await sleep(500);
  await snap("14-search.png");
  const found = await page.evaluate(() => ({
    meta: document.querySelector(".search-meta")?.textContent,
    rows: document.querySelectorAll(".search-row").length,
    highlights: document.querySelectorAll(".textLayer span.hl, .textLayer span.hl-current").length,
    current: document.querySelector(".search-row.current")?.textContent,
  }));

  // Enter 跳到下一条（连按三次应跨到第 2 页）
  await page.focus(".search-box input");
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Enter");
    await sleep(450);
  }
  await sleep(400);
  const afterEnter = await page.evaluate(() => ({
    page: document.querySelector(".pageno input")?.value,
    current: document.querySelector(".search-row.current")?.textContent,
    focused: document.querySelectorAll(".textLayer span.hl-focus").length,
  }));
  await snap("15-search-jump.png");

  console.log(
    JSON.stringify(
      { cont, afterScroll, outline, afterOutline, thumbs, found, afterEnter, consoleErrors: errors },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
