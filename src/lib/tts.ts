import type { PDFDocumentProxy } from "./pdf";

export type TtsStatus = "idle" | "loading" | "speaking" | "paused" | "done" | "error";

export type TtsSegment = {
  page: number;
  text: string;
  rects: number[][];
};

type TtsTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
};

type Line = {
  text: string;
  y: number;
  h: number;
  rects: number[][];
};

const MAX_SEGMENT = 220;

export type TtsPrefs = { voiceName: string; rate: number };

export function readTtsPrefs(): TtsPrefs {
  try {
    const raw = localStorage.getItem("voluma.tts.v1");
    if (raw) {
      const p = JSON.parse(raw) as Partial<TtsPrefs>;
      const rate = typeof p.rate === "number" ? Math.min(1.6, Math.max(0.7, p.rate)) : 1;
      return { voiceName: typeof p.voiceName === "string" ? p.voiceName : "", rate };
    }
  } catch {
    /* 偏好损坏就用默认 */
  }
  return { voiceName: "", rate: 1 };
}

export function saveTtsPrefs(prefs: TtsPrefs): void {
  try {
    localStorage.setItem("voluma.tts.v1", JSON.stringify(prefs));
  } catch {
    /* 不持久化也能继续读 */
  }
}

function isCjk(ch: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(ch);
}

function joinText(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  if (/\s$/.test(a) || /^\s/.test(b)) return a + b;
  if (isCjk(a.slice(-1)) || isCjk(b[0])) return a + b;
  return `${a} ${b}`;
}

function clean(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLong(text: string): string[] {
  if (text.length <= MAX_SEGMENT) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > MAX_SEGMENT) {
    const window = rest.slice(0, MAX_SEGMENT);
    const cut = Math.max(
      window.lastIndexOf("。"),
      window.lastIndexOf("！"),
      window.lastIndexOf("？"),
      window.lastIndexOf("；"),
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
      window.lastIndexOf("; ")
    );
    const at = cut > MAX_SEGMENT * 0.55 ? cut + 1 : MAX_SEGMENT;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

function pushSegment(out: TtsSegment[], page: number, text: string, rects: number[][]) {
  const t = clean(text);
  if (!t) return;
  if (t.length < 2 && !isCjk(t)) return;
  for (const part of splitLong(t)) {
    if (clean(part)) out.push({ page, text: clean(part), rects });
  }
}

/**
 * 把一页 PDF 的文本项按基线和段落间距重组，切成适合一次朗读的段。
 * 返回的 rect 是 PDF 坐标，前端再用 viewport 转成 CSS 像素做临时高亮。
 */
export async function extractPageSegments(doc: PDFDocumentProxy, pageNo: number): Promise<TtsSegment[]> {
  const page = await doc.getPage(pageNo);
  const content = await page.getTextContent();
  const items: TtsTextItem[] = (content.items as unknown as TtsTextItem[])
    .filter((it) => typeof it.str === "string" && !!it.str.trim())
    .map((it) => ({ ...it, hasEOL: it.hasEOL ?? false }));
  if (!items.length) return [];

  const sorted = items
    .map((it) => ({
      ...it,
      x: it.transform[4],
      y: it.transform[5],
      h: Math.max(1, it.height || Math.abs(it.transform[3]) || 10),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: { y: number; h: number; items: typeof sorted }[] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    const tol = Math.max(2, Math.min(it.h, row?.h ?? it.h) * 0.45);
    if (row && Math.abs(row.y - it.y) <= tol) {
      row.items.push(it);
      row.y = (row.y + it.y) / 2;
      row.h = Math.max(row.h, it.h);
    } else {
      rows.push({ y: it.y, h: it.h, items: [it] });
    }
  }

  const lines: Line[] = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let text = "";
    const rects: number[][] = [];
    for (const it of row.items) {
      text = joinText(text, it.str);
      rects.push([it.x, row.y - row.h * 0.82, it.x + it.width, row.y + row.h * 0.2]);
    }
    const t = clean(text);
    if (!t) continue;
    lines.push({ text: t, y: row.y, h: row.h, rects });
  }
  if (!lines.length) return [];

  const segments: TtsSegment[] = [];
  let buf: Line[] = [];
  let chars = 0;
  const flush = () => {
    if (!buf.length) return;
    let text = "";
    const rects: number[][] = [];
    for (const line of buf) {
      text = joinText(text, line.text);
      rects.push(...line.rects);
    }
    pushSegment(segments, pageNo, text, rects);
    buf = [];
    chars = 0;
  };

  for (const line of lines) {
    const prev = buf[buf.length - 1];
    if (prev && Math.abs(prev.y - line.y) > Math.max(prev.h, line.h) * 1.85) flush();
    if (chars + line.text.length > MAX_SEGMENT && buf.length) flush();
    buf.push(line);
    chars += line.text.length;
  }
  flush();

  return segments;
}
