import { pdfjs, type PDFDocumentProxy } from "./pdf";

export type PrintLayout = "fit" | "actual" | "two" | "four";

export const PRINT_LAYOUT_LABEL: Record<PrintLayout, string> = {
  fit: "适应纸张",
  actual: "实际大小",
  two: "每张 2 页",
  four: "每张 4 页",
};

export type ParsedRange = { pages: number[]; error: null } | { pages: []; error: string };

/** 解析 “1-3,5,8-10” 这类页码；空串表示当前页。 */
export function parsePageRange(input: string, total: number, current: number): ParsedRange {
  const raw = input.trim();
  if (!raw) return { pages: [Math.min(Math.max(1, current), total)], error: null };
  const tokens = raw
    .replace(/[，、；;]/g, ",")
    .replace(/[－—–~～]/g, "-")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!tokens.length) return { pages: [Math.min(Math.max(1, current), total)], error: null };
  const picked = new Set<number>();
  for (const token of tokens) {
    const m = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > total) return { pages: [], error: `页码超出 1–${total}` };
      for (let i = a; i <= b; i++) picked.add(i);
      continue;
    }
    if (!/^\d+$/.test(token)) return { pages: [], error: `无法识别“${token}”` };
    const n = parseInt(token, 10);
    if (n < 1 || n > total) return { pages: [], error: `页码超出 1–${total}` };
    picked.add(n);
  }
  return { pages: [...picked].sort((a, b) => a - b), error: null };
}

type Job = {
  doc: PDFDocumentProxy;
  pages: number[];
  layout: PrintLayout;
  onProgress?: (done: number, total: number) => void;
};

const ROOT_ID = "voluma-print";
const STYLE_ID = "voluma-print-page";
let cleanupTimer: number | null = null;
const objectUrls: string[] = [];

/** 把选中页画成画布并塞进打印专用 DOM；返回后可直接调用 window.print()。 */
export async function buildPrintDocument({
  doc,
  pages,
  layout,
  onProgress,
}: Job): Promise<HTMLElement> {
  clearPrintDocument();
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = `print-root layout-${layout}`;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = pageRule(layout);
  document.head.appendChild(style);

  const dpi = layout === "two" || layout === "four" ? 120 : pages.length > 24 ? 108 : 144;
  const compress = pages.length > 24;
  const imageType = pages.length > 120 ? "image/jpeg" : "image/png";
  let sheet: HTMLElement | null = null;
  const perSheet = layout === "two" ? 2 : layout === "four" ? 4 : 1;

  for (let i = 0; i < pages.length; i++) {
    const pageNo = pages[i];
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.dataset.page = String(pageNo);
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: ctx,
      viewport,
      intent: "print",
      annotationMode: pdfjs.AnnotationMode.ENABLE,
    }).promise;
    page.cleanup();

    let media: HTMLCanvasElement | HTMLImageElement = canvas;
    if (compress) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, imageType, imageType === "image/jpeg" ? 0.95 : undefined)
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        const img = new Image();
        img.src = url;
        img.dataset.page = String(pageNo);
        await img.decode().catch(() => undefined);
        media = img;
        canvas.width = 1;
        canvas.height = 1;
      }
    }

    if (layout === "actual") {
      media.style.width = `${base.width / 72}in`;
      media.style.height = `${base.height / 72}in`;
    }

    if (perSheet === 1) {
      const frame = document.createElement("div");
      frame.className = "print-page";
      if (layout === "actual") frame.classList.add("actual");
      frame.appendChild(media);
      root.appendChild(frame);
    } else {
      if (!sheet || i % perSheet === 0) {
        sheet = document.createElement("div");
        sheet.className = "print-sheet";
        root.appendChild(sheet);
      }
      const cell = document.createElement("div");
      cell.className = "print-cell";
      cell.appendChild(media);
      sheet.appendChild(cell);
    }
    onProgress?.(i + 1, pages.length);
  }

  document.body.appendChild(root);
  return root;
}

export function printNow(): void {
  window.focus();
  window.print();
}

export function clearPrintDocument(): void {
  if (cleanupTimer !== null) {
    window.clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  while (objectUrls.length) {
    const url = objectUrls.pop();
    if (url) URL.revokeObjectURL(url);
  }
}

/** 系统打印对话框关闭后清场；个别平台不触发 afterprint 时兜底。 */
export function schedulePrintCleanup(): void {
  const done = () => {
    window.removeEventListener("afterprint", done);
    clearPrintDocument();
  };
  window.addEventListener("afterprint", done);
  cleanupTimer = window.setTimeout(done, 180000);
}

function pageRule(layout: PrintLayout): string {
  switch (layout) {
    case "actual":
      return "@page { size: auto; margin: 0; }";
    case "two":
      return "@page { size: A4 landscape; margin: 10mm; }";
    case "four":
      return "@page { size: A4 portrait; margin: 10mm; }";
    default:
      return "@page { size: A4 portrait; margin: 10mm; }";
  }
}
