import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
const doc = await getDocument({ data: new Uint8Array(await readFile(process.argv[2])) }).promise;
const page = await doc.getPage(1);
const annots = await page.getAnnotations();
for (const a of annots) console.dir({titleObj:a.titleObj, contentsObj:a.contentsObj, annotationType:a.annotationType, subtype:a.subtype}, {depth:5});
await doc.destroy();
