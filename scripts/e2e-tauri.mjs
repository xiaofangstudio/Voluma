import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "tmp-e2e", "annot-e2e.pdf");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9333",
  defaultViewport: null,
});

const pages = await browser.pages();
const page = pages.find((p) => !p.url().startsWith("devtools://")) ?? pages[0];
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.waitForSelector(".welcome", { timeout: 40000 });
  await page.evaluate((pdfPath) => {
    localStorage.setItem(
      "voluma.recents.v1",
      JSON.stringify([
        {
          path: pdfPath,
          name: "annot-e2e",
          size: 4684,
          pages: 5,
          lastPage: 1,
          zoom: 100,
          updatedAt: Date.now(),
        },
      ])
    );
  }, target);
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1400);
  await page.click(".recent-row");
  await page.waitForFunction(() => document.querySelectorAll(".page-wrap canvas").length > 0, {
    timeout: 20000,
  });
  await page.waitForFunction(
    () => document.querySelector(".save-chip")?.textContent === "已保存",
    { timeout: 10000 }
  );
  console.info("loaded, save state", await page.evaluate(() => document.querySelector(".save-chip")?.textContent));

  const wrap = await page.evaluate(() => {
    const r = document.querySelector(".page-wrap").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const line = await page.evaluate(() => {
    const span = [...document.querySelectorAll(".page-wrap .textLayer span")].find(
      (s) => s.textContent.includes("Voluma reads")
    );
    const r = span.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  await page.click('button[aria-label="高亮"]');
  await sleep(200);
  await page.mouse.move(line.x + 2, line.y + line.h / 2);
  await page.mouse.down();
  await page.mouse.move(line.x + line.w - 2, line.y + line.h / 2, { steps: 8 });
  await page.mouse.up();
  await sleep(400);

  const dirty = await page.evaluate(() => ({
    chip: document.querySelector(".save-chip")?.textContent,
    annots: document.querySelectorAll(".annot").length,
  }));
  console.info("after annotate", dirty);

  await page.waitForFunction(
    () => document.querySelector(".save-chip")?.textContent === "已保存",
    { timeout: 15000 }
  );
  await sleep(600);

  const rows = await page.evaluate((pdfPath) =>
    window.__TAURI_INTERNALS__.invoke("read_annotations", { path: pdfPath }), target);
  console.info("disk annotations", JSON.stringify(rows, null, 2));

  await page.screenshot({ path: path.join(root, "review-m2", "30-tauri-saved.png") });

  // 再画一个矩形，验证第二次保存不重复
  await page.click('button[aria-label="矩形"]');
  await sleep(200);
  await page.mouse.move(wrap.x + 120, wrap.y + 320);
  await page.mouse.down();
  await page.mouse.move(wrap.x + 360, wrap.y + 430, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector(".save-chip")?.textContent === "已保存",
    { timeout: 15000 }
  );
  await sleep(400);
  const rows2 = await page.evaluate((pdfPath) =>
    window.__TAURI_INTERNALS__.invoke("read_annotations", { path: pdfPath }), target);
  console.info("after second save", rows2.length, rows2.map((r) => `${r.type}#${r.page}`).join(","));

  console.info("errors", errors);
} finally {
  await browser.disconnect();
}

