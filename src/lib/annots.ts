/** PDF 用户坐标（1/72 英寸，原点左下）中的注释模型。 */

export type AnnotKind =
  | "highlight"
  | "underline"
  | "strike"
  | "square"
  | "circle"
  | "ink"
  | "note"
  | "pin";

export type Annot = {
  id: string;
  page: number;
  type: AnnotKind;
  color: string;
  /** [x0, y0, x1, y1]，PDF 用户坐标 */
  rect: [number, number, number, number];
  /** PDF.js QuadPoints 顺序：TL, TR, BL, BR，可多组 */
  quads?: number[];
  /** 画笔路径，PDF 用户坐标 */
  path?: [number, number][];
  text?: string;
  createdAt: number;
};

export type ViewportLike = {
  width: number;
  height: number;
  convertToPdfPoint: (x: number, y: number) => number[];
  convertToViewportPoint: (x: number, y: number) => number[];
  convertToViewportRectangle: (rect: number[]) => number[];
};

type PageMeta = { page: number; viewport: ViewportLike; scale: number };
const META = new WeakMap<HTMLElement, PageMeta>();

export const ANNOT_COLORS = ["#b02a37", "#3b5bdb", "#2f9e44", "#e8590c", "#7048e8"];

export const ANNOT_LABEL: Record<AnnotKind, string> = {
  highlight: "高亮",
  underline: "下划线",
  strike: "删除线",
  square: "矩形",
  circle: "椭圆",
  ink: "画笔",
  note: "便签",
  pin: "图钉",
};

export function nextAnnotId(): string {
  return `voluma-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function registerPageMeta(
  wrap: HTMLElement,
  page: number,
  viewport: ViewportLike,
  scale: number
) {
  META.set(wrap, { page, viewport, scale });
}

export function pageMeta(wrap: HTMLElement): PageMeta | undefined {
  return META.get(wrap);
}

export function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function cssRect(viewport: ViewportLike, rect: number[]) {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

export function quadCss(
  viewport: ViewportLike,
  quads: number[],
  offset = 0
): { x: number; y: number }[][] {
  const groups: { x: number; y: number }[][] = [];
  for (let i = 0; i + 7 < quads.length; i += 8) {
    const pts: { x: number; y: number }[] = [];
    for (let k = 0; k < 4; k++) {
      const [x, y] = viewport.convertToViewportPoint(quads[i + k * 2], quads[i + k * 2 + 1]);
      pts.push({ x, y: y + offset });
    }
    groups.push(pts);
  }
  return groups;
}

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function ensureLayer(wrap: HTMLElement): SVGSVGElement {
  let layer = wrap.querySelector<SVGSVGElement>("svg.annot-layer");
  if (layer) return layer;
  layer = el("svg", { class: "annot-layer" });
  wrap.appendChild(layer);
  return layer;
}

const PAINT_CACHE = new WeakMap<HTMLElement, string>();

/** 把一页的注释画成 SVG 覆盖层；坐标全部经 viewport 从 PDF 空间换算 */
export function paintAnnotationsForWrap(
  wrap: HTMLElement,
  annots: Annot[],
  selectedId: string | null = null
) {
  const meta = META.get(wrap);
  if (!meta) return;
  const mine = annots.filter((a) => a.page === meta.page);
  const existing = wrap.querySelector<SVGSVGElement>("svg.annot-layer");
  if (!mine.length) {
    existing?.remove();
    PAINT_CACHE.delete(wrap);
    return;
  }
  const signature =
    `${wrap.clientWidth}x${wrap.clientHeight}#${selectedId ?? ""}#` +
    mine.map((a) => `${a.id}:${a.type}:${a.color}`).join("|");
  if (existing && existing.childElementCount > 0 && PAINT_CACHE.get(wrap) === signature) {
    return;
  }
  PAINT_CACHE.set(wrap, signature);

  const layer = ensureLayer(wrap);
  layer.setAttribute("width", String(wrap.clientWidth));
  layer.setAttribute("height", String(wrap.clientHeight));
  layer.setAttribute("viewBox", `0 0 ${wrap.clientWidth} ${wrap.clientHeight}`);
  layer.replaceChildren();

  for (const a of mine) {
    const g = el("g", {
      class: `annot annot-${a.type}${a.id === selectedId ? " annot-selected" : ""}`,
      "data-id": a.id,
    });
    const box = cssRect(meta.viewport, a.rect);

    if (a.type === "highlight" && a.quads?.length) {
      for (const pts of quadCss(meta.viewport, a.quads)) {
        g.appendChild(
          el("polygon", {
            points: pts.map((p) => `${p.x},${p.y}`).join(" "),
            fill: a.color,
            "fill-opacity": 0.32,
          })
        );
      }
    } else if ((a.type === "underline" || a.type === "strike") && a.quads?.length) {
      for (const pts of quadCss(meta.viewport, a.quads, a.type === "underline" ? -1 : 0)) {
        const y =
          a.type === "underline"
            ? Math.max(pts[2].y, pts[3].y) - 1
            : (pts[0].y + pts[2].y) / 2;
        g.appendChild(
          el("line", {
            x1: pts[2].x,
            y1: y,
            x2: pts[3].x,
            y2: y,
            stroke: a.color,
            "stroke-width": 2,
          })
        );
      }
    } else if (a.type === "square") {
      g.appendChild(
        el("rect", {
          x: box.x + 1,
          y: box.y + 1,
          width: Math.max(1, box.w - 2),
          height: Math.max(1, box.h - 2),
          rx: 2,
          fill: "none",
          stroke: a.color,
          "stroke-width": 2,
        })
      );
    } else if (a.type === "circle") {
      g.appendChild(
        el("ellipse", {
          cx: box.x + box.w / 2,
          cy: box.y + box.h / 2,
          rx: Math.max(1, box.w / 2 - 1),
          ry: Math.max(1, box.h / 2 - 1),
          fill: "none",
          stroke: a.color,
          "stroke-width": 2,
        })
      );
    } else if (a.type === "ink" && a.path?.length) {
      const pts = a.path.map((p) => meta.viewport.convertToViewportPoint(p[0], p[1]));
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
      g.appendChild(
        el("path", {
          d,
          fill: "none",
          stroke: a.color,
          "stroke-width": 2.2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        })
      );
    } else if (a.type === "note" || a.type === "pin") {
      const icon = Math.max(14, Math.min(20, box.w));
      const x = box.x;
      const y = box.y;
      if (a.type === "note") {
        g.appendChild(
          el("rect", {
            x,
            y,
            width: icon,
            height: icon,
            rx: 3,
            fill: a.color,
            "fill-opacity": 0.95,
          })
        );
        for (let i = 0; i < 3; i++) {
          g.appendChild(
            el("rect", {
              x: x + 4,
              y: y + 4.5 + i * 4,
              width: icon - 8,
              height: 1.2,
              fill: "#fff",
              "fill-opacity": 0.9,
            })
          );
        }
      } else {
        g.appendChild(
          el("path", {
            d: `M${x + icon / 2} ${y + icon * 0.92} L${x + icon * 0.32} ${y + icon * 0.66} A${icon * 0.38} ${icon * 0.38} 0 1 1 ${x + icon * 0.68} ${y + icon * 0.66} Z`,
            fill: a.color,
          })
        );
        g.appendChild(
          el("circle", {
            cx: x + icon / 2,
            cy: y + icon * 0.42,
            r: icon * 0.12,
            fill: "#fff",
          })
        );
      }
    }
    if (g.childNodes.length) layer.appendChild(g);
  }
}

export function repaintAnnotations(
  host: HTMLElement | null,
  annots: Annot[],
  selectedId: string | null = null
) {
  if (!host) return;
  host.querySelectorAll<HTMLElement>(".page-wrap").forEach((wrap) => {
    paintAnnotationsForWrap(wrap, annots, selectedId);
  });
}

export type Draft = { rect: [number, number, number, number]; quads?: number[]; text?: string };

function intersect(r: DOMRect, bounds: DOMRect) {
  const left = Math.max(r.left, bounds.left);
  const right = Math.min(r.right, bounds.right);
  const top = Math.max(r.top, bounds.top);
  const bottom = Math.min(r.bottom, bounds.bottom);
  if (right - left < 1 || bottom - top < 1) return null;
  return { left, right, top, bottom };
}

/** 从当前文本选区提取 PDF QuadPoints；选区跨页时按指针所在页取 */
export function selectionDraft(wrap: HTMLElement): Draft | null {
  const meta = META.get(wrap);
  const sel = window.getSelection();
  if (!meta || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;

  const range = sel.getRangeAt(0);
  const bounds = wrap.getBoundingClientRect();
  const walks: { left: number; right: number; top: number; bottom: number }[] = [];
  for (const raw of Array.from(range.getClientRects())) {
    const clipped = intersect(raw as DOMRect, bounds);
    if (clipped) walks.push(clipped);
  }
  if (!walks.length) return null;

  const quads: number[] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  for (const r of walks) {
    const lx = r.left - bounds.left;
    const rx = r.right - bounds.left;
    const ty = r.top - bounds.top;
    const by = r.bottom - bounds.top;
    const tl = meta.viewport.convertToPdfPoint(lx, ty);
    const tr = meta.viewport.convertToPdfPoint(rx, ty);
    const bl = meta.viewport.convertToPdfPoint(lx, by);
    const br = meta.viewport.convertToPdfPoint(rx, by);
    quads.push(
      round(tl[0]), round(tl[1]),
      round(tr[0]), round(tr[1]),
      round(bl[0]), round(bl[1]),
      round(br[0]), round(br[1])
    );
    for (const p of [tl, tr, bl, br]) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
  }

  return { rect: [round(x0), round(y0), round(x1), round(y1)], quads, text };
}

export function rectFromPoints(a: [number, number], b: [number, number]): [number, number, number, number] {
  return [
    round(Math.min(a[0], b[0])),
    round(Math.min(a[1], b[1])),
    round(Math.max(a[0], b[0])),
    round(Math.max(a[1], b[1])),
  ];
}

export function toPayload(annots: Annot[]) {
  return annots
    .slice()
    .sort((a, b) => (a.page - b.page) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id))
    .map((a) => ({
      id: a.id,
      page: a.page,
      type: a.type,
      color: a.color,
      rect: a.rect.map(round),
      quads: a.quads?.map(round),
      path: a.path?.map((p) => [round(p[0]), round(p[1])]),
      text: a.text || undefined,
    }));
}

/** 列表摘要 */
export function annotSnippet(a: Annot): string {
  if (a.text?.trim()) return a.text.trim().replace(/\s+/g, " ");
  return ANNOT_LABEL[a.type];
}
