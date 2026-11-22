import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "review-m2");
await mkdir(shots, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  defaultViewport: { width: 1280, height: 820 },
  args: ["--no-first-run", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
  await sleep(900);
  const up = await page.$("input[type=file]");
  await up.uploadFile(path.join(root, "assets", "M0-阅读样本.pdf"));
  await page.waitForFunction(() => document.querySelectorAll(".page-wrap canvas").length > 0, {
    timeout: 20000,
  });
  await sleep(800);

  const wrap = await page.evaluate(() => {
    const r = document.querySelector(".page-wrap").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  const lineOf = async (needle) =>
    page.evaluate((text) => {
      const span = [...document.querySelectorAll(".page-wrap .textLayer span")].find((s) =>
        s.textContent.includes(text)
      );
      const r = span.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, needle);

  const dragText = async (needle) => {
    const line = await lineOf(needle);
    await page.mouse.move(line.x + 2, line.y + line.h / 2);
    await page.mouse.down();
    await page.mouse.move(line.x + Math.min(line.w, 260), line.y + line.h / 2, { steps: 8 });
    await page.mouse.up();
    await sleep(350);
  };

  const pick = async (label) => {
    await page.click(`button[aria-label="${label}"]`);
    await sleep(200);
  };

  await pick("高亮");
  await dragText("Voluma reads");
  await pick("下划线");
  await dragText("Papyra suite");
  await pick("删除线");
  await dragText("Page 1 of 5");

  await pick("矩形");
  await page.mouse.move(wrap.x + 100, wrap.y + 360);
  await page.mouse.down();
  await page.mouse.move(wrap.x + 300, wrap.y + 470, { steps: 8 });
  await page.mouse.up();

  await pick("椭圆");
  await page.mouse.move(wrap.x + 330, wrap.y + 360);
  await page.mouse.down();
  await page.mouse.move(wrap.x + 520, wrap.y + 470, { steps: 8 });
  await page.mouse.up();

  await pick("画笔");
  await page.mouse.move(wrap.x + 120, wrap.y + 520);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(wrap.x + 120 + i * 10, wrap.y + 520 + Math.sin(i / 2) * 16);
  }
  await page.mouse.up();

  await pick("便签");
  await page.mouse.click(wrap.x + 60, wrap.y + 240);
  await page.waitForSelector(".note-composer textarea");
  await page.type(".note-composer textarea", "这里的措辞再克制一点。");
  await page.click(".note-composer .btn-primary");
  await sleep(300);

  await pick("图钉");
  await page.mouse.click(wrap.x + 600, wrap.y + 240);
  await page.waitForSelector(".note-composer textarea");
  await page.type(".note-composer textarea", "图 3 位置待补。");
  await page.click(".note-composer .btn-primary");
  await sleep(400);

  const result = await page.evaluate(() => ({
    classes: [...document.querySelectorAll("g.annot")].map((a) => a.getAttribute("class")),
    layers: document.querySelectorAll(".annot-layer").length,
    listRows: document.querySelectorAll(".annot-row").length,
    save: document.querySelector(".save-chip")?.textContent,
  }));
  await page.screenshot({ path: path.join(shots, "27-all-tools.png") });

  // 注释列表
  await page.click('button[aria-label="注释列表"]');
  await sleep(300);
  await page.screenshot({ path: path.join(shots, "28-all-list.png") });

  // 900 宽最小窗口
  await page.setViewport({ width: 900, height: 700 });
  await sleep(700);
  await page.screenshot({ path: path.join(shots, "29-min-window.png") });
  const min = await page.evaluate(() => ({
    bar: document.querySelector(".iconbar").scrollWidth,
    view: document.querySelector(".iconbar").clientWidth,
    overflow: document.querySelector(".iconbar").scrollWidth > document.querySelector(".iconbar").clientWidth,
  }));

  console.info(JSON.stringify({ result, min, errors }, null, 2));
} finally {
  await browser.close();
}
