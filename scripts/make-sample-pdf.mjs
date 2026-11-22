import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = 5;

const content = (n) => {
  const body = [
    "BT /F1 34 Tf 72 700 Td (Voluma Reading Sample) Tj ET",
    "BT /F1 18 Tf 72 652 Td (Page " + n + " of " + pages + ") Tj ET",
    "BT /F2 11 Tf 72 612 Td (Voluma reads, searches and navigates local PDF files.) Tj ET",
    "BT /F2 11 Tf 72 590 Td (Papyra suite keeps everything on this computer.) Tj ET",
    "0.69 0.16 0.22 RG 2 w 72 330 450 230 re S",
    "0.69 0.16 0.22 rg 72 330 450 24 re f",
    "0 g",
    "BT /F1 12 Tf 84 300 Td (Section " + n + " - Papyra / Voluma) Tj ET",
    "BT /F2 9 Tf 72 84 Td (Search keyword: Papyra. Chapter navigation uses the outline panel.) Tj ET",
    "BT /F1 10 Tf 500 40 Td (" + n + ") Tj ET",
  ];
  return body.join("\n");
};

const enc = (s) => Buffer.byteLength(s, "latin1");

// 固定编号
const CATALOG = 1;
const PAGES = 2;
const FONT_BOLD = 3;
const FONT_REG = 4;
const INFO = 15;
const OUTLINE_ROOT = 16;
const OUTLINE_1 = 17;
const OUTLINE_2 = 18;

const pageId = (i) => 5 + i * 2;
const contentId = (i) => 6 + i * 2;

let pdf = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n";
const offsets = [];
const obj = (id, body) => {
  offsets[id] = enc(pdf);
  pdf += `${id} 0 obj\n${body}\nendobj\n`;
};

const kids = Array.from({ length: pages }, (_, i) => `${pageId(i)} 0 R`).join(" ");
obj(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R /Outlines ${OUTLINE_ROOT} 0 R /PageMode /UseOutlines >>`);
obj(PAGES, `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
obj(FONT_BOLD, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
obj(FONT_REG, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

for (let i = 0; i < pages; i++) {
  const body = content(i + 1);
  obj(
    pageId(i),
    `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${FONT_BOLD} 0 R /F2 ${FONT_REG} 0 R >> >> /Contents ${contentId(i)} 0 R >>`
  );
  obj(contentId(i), `<< /Length ${enc(body)} >>\nstream\n${body}\nendstream`);
}

obj(INFO, "<< /Title (Voluma Reading Sample) /Producer (Papyra) >>");
obj(
  OUTLINE_ROOT,
  `<< /Type /Outlines /First ${OUTLINE_1} 0 R /Last ${OUTLINE_2} 0 R /Count 2 >>`
);
obj(
  OUTLINE_1,
  `<< /Title (Chapter One) /Parent ${OUTLINE_ROOT} 0 R /Next ${OUTLINE_2} 0 R /Dest [${pageId(0)} 0 R /Fit] >>`
);
obj(
  OUTLINE_2,
  `<< /Title (Chapter Two) /Parent ${OUTLINE_ROOT} 0 R /Prev ${OUTLINE_1} 0 R /Dest [${pageId(2)} 0 R /Fit] >>`
);

const size = OUTLINE_2 + 1;
const xrefPos = enc(pdf);
pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
for (let i = 1; i < size; i++) {
  pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
}
pdf += `trailer\n<< /Size ${size} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

await writeFile(path.join(root, "assets", "M0-阅读样本.pdf"), Buffer.from(pdf, "latin1"));
console.log("sample pdf written:", pages, "pages");
