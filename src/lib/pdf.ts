import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { registerPageMeta, type ViewportLike } from "./annots";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PDFDocumentProxy = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
export { pdfjs };

/** PDF 一个点（1/72 英寸）对应 CSS 像素数 */
export const PDF_TO_CSS = 96 / 72;

export type BaseSize = { w: number; h: number };
export type OutlineNode = { title: string; page: number | null; children: OutlineNode[] };
export type SearchHit = { page: number; index: number; order: number; snippet: string };

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  // pdf.js 会接管传入的缓冲区，先复制一份，避免调用方拿到的字节被 detach
  const copy = new Uint8Array(data.slice(0));
  return pdfjs.getDocument({ data: copy, isEvalSupported: false }).promise;
}

/** 渲染 240×180 的封面缩略图，供最近文件卡片墙使用 */
export async function renderCover(doc: PDFDocumentProxy, width = 240, height = 180): Promise<string> {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(width / base.width, height / base.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas.toDataURL("image/jpeg", 0.72);
}

export async function pageBaseSize(doc: PDFDocumentProxy, n: number): Promise<BaseSize> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  page.cleanup();
  return { w: vp.width, h: vp.height };
}

/** 批量取全部页面的原始尺寸；连续模式排版要用 */
export async function loadBaseSizes(
  doc: PDFDocumentProxy,
  total: number,
  onProgress?: (done: number, total: number) => void,
  batch = 24
): Promise<Map<number, BaseSize>> {
  const map = new Map<number, BaseSize>();
  for (let start = 1; start <= total; start += batch) {
    const end = Math.min(total, start + batch - 1);
    const nums: number[] = [];
    for (let n = start; n <= end; n++) nums.push(n);
    const sizes = await Promise.all(
      nums.map(async (n) => {
        try {
          return [n, await pageBaseSize(doc, n)] as const;
        } catch {
          return null;
        }
      })
    );
    for (const item of sizes) {
      if (item) map.set(item[0], item[1]);
    }
    onProgress?.(end, total);
  }
  return map;
}

type RenderOpts = {
  text?: boolean;
  dpr?: number;
  query?: string;
  current?: boolean;
};

/** 把一页画进给定容器（先清空），可选生成文本层与搜索高亮 */
export async function renderPageInto(
  doc: PDFDocumentProxy,
  n: number,
  cssScale: number,
  wrap: HTMLDivElement,
  opts: RenderOpts = {}
): Promise<{ width: number; height: number; viewport: ViewportLike }> {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: cssScale });
  const dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);

  const width = Math.floor(viewport.width);
  const height = Math.floor(viewport.height);
  wrap.style.width = `${width}px`;
  wrap.style.height = `${height}px`;
  wrap.dataset.page = String(n);
  wrap.replaceChildren();
  registerPageMeta(wrap, n, viewport, cssScale);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
  canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  wrap.appendChild(canvas);

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("无法创建 2D 画布");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise;

  if (opts.text) {
    const textDiv = document.createElement("div");
    textDiv.className = "textLayer";
    textDiv.style.width = `${width}px`;
    textDiv.style.height = `${height}px`;
    textDiv.style.setProperty("--scale-factor", String(cssScale));
    wrap.appendChild(textDiv);
    try {
      const textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true }),
        container: textDiv,
        viewport,
      });
      await textLayer.render();
    } catch {
      textDiv.remove();
    }
    if (opts.query) paintHighlights(wrap, opts.query, !!opts.current);
  }

  page.cleanup();
  return { width, height, viewport };
}

/** 按文本层 span 做搜索高亮；当前页使用更重的颜色 */
export function paintHighlights(wrap: HTMLElement, query: string, current: boolean) {
  wrap.querySelectorAll(".hl, .hl-current").forEach((el) => {
    el.classList.remove("hl", "hl-current");
  });
  const q = query.trim().toLowerCase();
  if (!q) return;
  const spans = wrap.querySelectorAll<HTMLElement>(".textLayer span");
  spans.forEach((span) => {
    const t = span.textContent?.toLowerCase() ?? "";
    if (t.includes(q)) span.classList.add(current ? "hl-current" : "hl");
  });
}

export async function renderThumbnail(
  doc: PDFDocumentProxy,
  n: number,
  canvas: HTMLCanvasElement,
  width: number,
  rotation = 0
): Promise<void> {
  const page = await doc.getPage(n);
  const total = (((page.rotate + rotation) % 360) + 360) % 360;
  const base = page.getViewport({ scale: 1, rotation: total });
  const scale = width / base.width;
  const viewport = page.getViewport({ scale, rotation: total });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise;
  page.cleanup();
}

/** 取整页文字（带缓存），搜索用 */
export async function pageText(
  doc: PDFDocumentProxy,
  n: number,
  cache: Map<number, string>
): Promise<string> {
  const hit = cache.get(n);
  if (hit !== undefined) return hit;
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  const text = content.items
    .map((it) => ("str" in it ? it.str : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  page.cleanup();
  cache.set(n, text);
  return text;
}

export async function searchDocument(
  doc: PDFDocumentProxy,
  total: number,
  rawQuery: string,
  token: { cancel: boolean },
  cache: Map<number, string>,
  onProgress?: (done: number) => void,
  maxHits = 400
): Promise<SearchHit[]> {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (let n = 1; n <= total; n++) {
    if (token.cancel) break;
    const text = await pageText(doc, n, cache);
    const lower = text.toLowerCase();
    let from = 0;
    let order = 0;
    while (from < lower.length && hits.length < maxHits) {
      const at = lower.indexOf(q, from);
      if (at < 0) break;
      let start = at > 26 ? text.lastIndexOf(" ", at - 26) : 0;
      if (start < 0 || start >= at) start = Math.max(0, at - 26);
      let end = Math.min(text.length, at + q.length + 40);
      if (end < text.length) {
        const nextSpace = text.indexOf(" ", end);
        if (nextSpace > 0 && nextSpace - end < 14) end = nextSpace;
      }
      const prefix = start > 0 ? "…" : "";
      hits.push({
        page: n,
        index: at,
        order: order++,
        snippet: prefix + text.slice(start, end).trim(),
      });
      from = at + q.length;
    }
    onProgress?.(n);
    if (hits.length >= maxHits) break;
  }
  return hits;
}

export async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = (await doc.getOutline()) as any[] | null;
  if (!raw || !raw.length) return [];

  const resolvePage = async (dest: any): Promise<number | null> => {
    try {
      let d = dest;
      if (typeof d === "string") d = await doc.getDestination(d);
      if (!Array.isArray(d)) return null;
      const index = await doc.getPageIndex(d[0]);
      return index + 1;
    } catch {
      return null;
    }
  };

  const walk = async (items: any[], depth: number): Promise<OutlineNode[]> => {
    const out: OutlineNode[] = [];
    for (const it of items) {
      if (!it) continue;
      out.push({
        title: String(it.title ?? "未命名"),
        page: it.dest ? await resolvePage(it.dest) : null,
        children:
          depth < 3 && Array.isArray(it.items) && it.items.length ? await walk(it.items, depth + 1) : [],
      });
    }
    return out;
  };

  return walk(raw, 0);
}
