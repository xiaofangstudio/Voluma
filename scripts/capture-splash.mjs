import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  defaultViewport: { width: 1280, height: 820 },
  args: ["--no-first-run", "--force-color-profile=srgb"],
});
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:1420", { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 260));
  await page.screenshot({ path: path.join(root, "review", "00-splash.png") });
  console.log("splash captured");
} finally {
  await browser.close();
}
