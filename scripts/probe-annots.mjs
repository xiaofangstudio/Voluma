// 用 PDF.js 回读 Rust 写出的注释，核对字段名与坐标空间。
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const path = process.argv[2];
const doc = await getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: 1 });
const annots = await page.getAnnotations();
console.info('page size', viewport.width, viewport.height, 'annots', annots.length);
for (const a of annots) {
  console.info(JSON.stringify({
    id: a.id,
    subtype: a.subtype,
    rect: a.rect,
    quadPoints: a.quadPoints,
    inkLists: a.inkLists,
    color: a.color,
    contents: a.contents,
    name: a.name,
    hasAppearance: !!a.hasAppearance,
  }));
  console.info('rect -> viewport', viewport.convertToViewportRectangle(a.rect));
}
await doc.destroy();

async function readFile(p) {
  const { readFile } = await import('node:fs/promises');
  return readFile(p);
}
