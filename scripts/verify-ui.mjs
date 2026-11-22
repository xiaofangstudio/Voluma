import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "review");
await mkdir(shots, { recursive: true });

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const url = "http://localhost:1420";
const sample = path.join(root, "assets", "M0-阅读样本.pdf");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  defaultViewport: { width: 1280, height: 820 },
  args: ["--no-first-run", "--force-color-profile=srgb"],
});

const state = async (page) =>
  page.evaluate(() => {
    const canvases = [...document.querySelectorAll(".page-wrap canvas")];
    const canvas = canvases[0];
    let ink = 0;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      const w = Math.min(canvas.width, 260);
      const h = Math.min(canvas.height, 260);
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 200 && data[i + 1] < 200 && data[i + 2] < 200) ink++;
      }
    }
    return {
      pages: canvases.length,
      widths: canvases.map((c) => c.style.width),
      pageInput: document.querySelector(".pageno input")?.value ?? null,
      zoom: document.querySelector(".zoomchip")?.textContent ?? null,
      ink,
    };
  });

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1500);
  await page.screenshot({ path: path.join(shots, "01-welcome.png") });

  const upload = await page.$("input[type=file]");
  await upload.uploadFile(sample);
  await page.waitForFunction(() => document.querySelectorAll(".page-wrap canvas").length > 0, {
    timeout: 20000,
  });
  await sleep(700);
  await page.screenshot({ path: path.join(shots, "02-reader-100.png") });
  const at100 = await state(page);

  await page.click('button[aria-label="适应宽度"]');
  await sleep(900);
  await page.screenshot({ path: path.join(shots, "03-fit-width.png") });
  const fit = await state(page);

  await page.click('button[aria-label="下一页"]');
  await sleep(600);
  const afterNext = await state(page);

  await page.click('button[aria-label="双页对开"]');
  await sleep(700);
  await page.click('button[aria-label="适应宽度"]');
  await sleep(900);
  await page.screenshot({ path: path.join(shots, "04-spread.png") });
  const spread = await state(page);

  await page.click('button[aria-label="夜间反转"]');
  await sleep(600);
  await page.screenshot({ path: path.join(shots, "05-night.png") });

  console.log(JSON.stringify({ at100, fit, afterNext, spread, consoleErrors: errors }, null, 2));
} finally {
  await browser.close();
}
