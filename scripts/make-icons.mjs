import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "assets");
const out = path.join(root, "src-tauri", "icons");

await mkdir(out, { recursive: true });

const mainSvg = await readFile(path.join(assets, "voluma-icon.svg"));
const smallSvg = await readFile(path.join(assets, "voluma-icon-small.svg"));

const render = (svg, size) =>
  sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

const png1024 = await render(mainSvg, 1024);
await writeFile(path.join(out, "icon.png"), png1024);
await writeFile(path.join(out, "128x128@2x.png"), await render(mainSvg, 256));
await writeFile(path.join(out, "128x128.png"), await render(mainSvg, 128));
await writeFile(path.join(out, "32x32.png"), await render(smallSvg, 32));

const icoSizes = [256, 128, 64, 48, 32, 24, 16];
const icoBuffers = [];
for (const size of icoSizes) {
  const svg = size <= 24 ? smallSvg : mainSvg;
  icoBuffers.push(await render(svg, size));
}await writeFile(path.join(out, "icon.ico"), await pngToIco(icoBuffers));

console.log("icons written:", out);
console.log("sizes:", icoSizes.join(", "));
