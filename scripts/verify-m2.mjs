import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "review-m2");
await mkdir(shots, { recursive: true });

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sample = path.join(root, "assets", "M0-阅读样本.pdf");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  defaultViewport: { width: 1280, height: 820 },
  args: ["--no-first-run", "--force-color-profile=srgb"],
});

try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("http://localhost:1420", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1000);
  const upload = await page.$("input[type=file]");
  await upload.uploadFile(sample);
  await page.waitForFunction(() => document.querySelectorAll(".page-wrap canvas").length > 0, {
    timeout: 20000,
  });
  await sleep(800);

  const wrap = await page.evaluate(() => {
    const el = document.querySelector(".page-wrap");
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  const textRects = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".page-wrap .textLayer span")]
      .filter((s) => s.textContent.trim().length > 2)
      .slice(0, 12);
    return spans.map((s) => {
      const r = s.getBoundingClientRect();
      return { text: s.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
    });
  });
  console.info("text spans", textRects.length, textRects[0]?.text);

  // 高亮：先选工具，再用鼠标拖选一段文字
  await page.click('button[aria-label="高亮"]');
  await sleep(180);
  const line = textRects.find((r) => r.w > 120) || textRects[0];
  await page.mouse.move(line.x + 2, line.y + line.h / 2);
  await page.mouse.down();
  await page.mouse.move(line.x + line.w - 2, line.y + line.h / 2, { steps: 8 });
  await page.mouse.up();
  await sleep(500);

  const afterHl = await page.evaluate(() => ({
    annots: document.querySelectorAll(".annot").length,
    hl: document.querySelectorAll(".annot-highlight").length,
    polygons: document.querySelectorAll(".annot-highlight polygon").length,
    save: document.querySelector(".save-chip")?.textContent,
  }));

  // 矩形
  await page.click('button[aria-label="矩形"]');
  await sleep(220);
  await page.mouse.move(wrap.x + 120, wrap.y + wrap.h * 0.55);
  await page.mouse.down();
  await page.mouse.move(wrap.x + 340, wrap.y + wrap.h * 0.68, { steps: 10 });
  await page.mouse.up();
  await sleep(300);

  // 画笔
  await page.click('button[aria-label="画笔"]');
  await sleep(220);
  await page.mouse.move(wrap.x + 180, wrap.y + 620);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(
      wrap.x + 180 + i * 14,
      wrap.y + 620 + Math.sin(i / 2.2) * 28
    );
  }
  await page.mouse.up();
  await sleep(300);

  // 便签
  await page.click('button[aria-label="便签"]');
  await sleep(220);
  await page.mouse.click(wrap.x + 60, wrap.y + wrap.h * 0.32);
  await page.waitForSelector(".note-composer textarea", { timeout: 5000 });
  await page.type(".note-composer textarea", "第二段的数据需要复核，和图 3 对不上。");
  await page.screenshot({ path: path.join(shots, "20-note-composer.png") });
  await page.click('.note-composer .btn-primary');
  await sleep(400);

  const counts = await page.evaluate(() => ({
    highlight: document.querySelectorAll(".annot-highlight").length,
    square: document.querySelectorAll(".annot-square").length,
    ink: document.querySelectorAll(".annot-ink").length,
    note: document.querySelectorAll("g.annot-note").length,
    total: document.querySelectorAll(".annot").length,
    classes: [...document.querySelectorAll(".annot")].map((a) => a.getAttribute("class")),
  }));
  console.info("annot counts", counts);

  // 注释列表面板
  await page.click('button[aria-label="注释列表"]');
  await sleep(400);
  await page.screenshot({ path: path.join(shots, "21-annot-list.png") });
  const list = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".annot-row")].map((r) => r.textContent?.trim()),
    count: document.querySelectorAll(".annot-row").length,
  }));
  console.info("list rows", list.count, list.rows);

  // 选第一条并改色
  const jump = await page.$$(".annot-jump");
  if (jump[0]) await jump[0].click();
  await sleep(300);
  const dots = await page.$$(".annot-row.current .color-dot");
  if (dots[2]) await dots[2].click();
  await sleep(350);
  const recolored = await page.evaluate(() => ({
    colors: [...document.querySelectorAll(".annot-row.current .color-dot")].map((d) =>
      d.classList.contains("on")
    ),
    selected: document.querySelector(".annot-row.current")?.textContent?.trim(),
  }));

  // 删除一条
  const dels = await page.$$(".annot-del");
  const before = dels.length;
  if (dels[dels.length - 1]) await dels[dels.length - 1].click();
  await sleep(350);
  const afterDelete = await page.evaluate(() => ({
    rows: document.querySelectorAll(".annot-row").length,
    annots: document.querySelectorAll(".annot").length,
  }));

  // 连续模式重绘
  await page.click('button[aria-label="连续"]');
  await sleep(1200);
  await page.evaluate(() => {
    const sc = document.querySelector(".scroller.continuous");
    if (sc) sc.scrollTop = 300;
  });
  await sleep(900);
  const cont = await page.evaluate(() => ({
    slots: document.querySelectorAll(".page-wrap.slot").length,
    layers: document.querySelectorAll(".page-wrap.slot .annot-layer").length,
    firstSlotAnnots: document.querySelectorAll('.page-wrap.slot[data-page="1"] .annot').length,
  }));
  await page.screenshot({ path: path.join(shots, "22-continuous-annots.png") });

  // 快捷键：退出工具
  await page.keyboard.press("Escape");
  await sleep(300);
  const escaped = await page.evaluate(() => ({
    bar: !!document.querySelector(".annot-bar"),
    toolActive: document.querySelectorAll(".iconbtn.tool-active").length,
  }));

  console.info(
    JSON.stringify(
      { afterHl, counts, list, recolored, before, afterDelete, cont, escaped, errors },
      null,
      2
    )
  );
} finally {
  await browser.close();
}


