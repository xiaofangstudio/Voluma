import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { open, save } from "@tauri-apps/plugin-dialog";
import { baseName, documentPageCount } from "../lib/tauri";
import { renderThumbnail } from "../lib/pdf";
import { IconClose, IconExtract, IconInsert, IconRotate } from "./Icons";

type InsertDraft = {
  key: string;
  kind: "pdf" | "image";
  path: string;
  name: string;
  pages: number;
};

type Item =
  | { key: string; kind: "page"; page: number }
  | { key: string; kind: "insert"; draft: InsertDraft };

export type PagePlan = {
  order: number[];
  rotations: Record<number, number>;
  inserts: { index: number; kind: "pdf" | "image"; path: string }[];
};

type Props = {
  doc: PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  docName: string;
  path: string;
  busy: boolean;
  onClose: () => void;
  onNotice: (msg: string) => void;
  onApply: (plan: PagePlan) => Promise<void>;
  onExtract: (pages: number[], dest: string) => Promise<void>;
};

const THUMB_W = 148;

function pageItems(count: number): Item[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `p${i + 1}`,
    kind: "page" as const,
    page: i + 1,
  }));
}

function PageThumb({
  doc,
  page,
  rotation,
}: {
  doc: PDFDocumentProxy | null;
  page: number;
  rotation: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !doc) return;
    let alive = true;
    const run = async () => {
      try {
        await renderThumbnail(doc, page, canvas, THUMB_W, rotation);
      } catch {
        if (alive && canvas) canvas.dataset.failed = "1";
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void run();
        }
      },
      { rootMargin: "160px 0px" }
    );
    io.observe(canvas);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [doc, page, rotation]);
  return <canvas ref={ref} className="pm-canvas" />;
}

export default function PageManager({
  doc,
  numPages,
  currentPage,
  docName,
  path,
  busy,
  onClose,
  onNotice,
  onApply,
  onExtract,
}: Props) {
  const [items, setItems] = useState<Item[]>(() => pageItems(numPages));
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set([Math.min(Math.max(1, currentPage), numPages)])
  );
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const [baseRot, setBaseRot] = useState<Record<number, number>>({});
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    setItems(pageItems(numPages));
    setSelected(new Set([Math.min(Math.max(1, currentPage), numPages)]));
    setRotations({});
  }, [numPages]);

  useEffect(() => {
    if (!doc) return;
    let alive = true;
    setBaseRot({});
    const load = async () => {
      const map: Record<number, number> = {};
      for (let start = 1; start <= numPages; start += 24) {
        const end = Math.min(numPages, start + 23);
        const nums = Array.from({ length: end - start + 1 }, (_, i) => start + i);
        await Promise.all(
          nums.map(async (n) => {
            try {
              const page = await doc.getPage(n);
              map[n] = (((page.rotate % 360) + 360) % 360);
            } catch {
              map[n] = 0;
            }
          })
        );
        if (!alive) return;
      }
      if (alive) setBaseRot(map);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [doc, numPages]);

  const pageOrder = useMemo(
    () => items.filter((it): it is Extract<Item, { kind: "page" }> => it.kind === "page").map((it) => it.page),
    [items]
  );

  const dirty = useMemo(() => {
    if (items.some((it) => it.kind === "insert")) return true;
    if (Object.keys(rotations).length > 0) return true;
    if (pageOrder.length !== numPages) return true;
    return pageOrder.some((n, i) => n !== i + 1);
  }, [items, rotations, pageOrder, numPages]);

  const targetPages = useCallback(() => {
    if (selected.size) return [...selected].sort((a, b) => a - b);
    if (pageOrder.includes(currentPage)) return [currentPage];
    return pageOrder.length ? [pageOrder[0]] : [];
  }, [selected, pageOrder, currentPage]);

  const toggle = (page: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  const reorder = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    setItems((prev) => {
      const from = prev.findIndex((it) => it.key === fromKey);
      const to = prev.findIndex((it) => it.key === toKey);
      if (from < 0 || to < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const rotate = (delta: number) => {
    const pages = targetPages().filter((n) => pageOrder.includes(n));
    if (!pages.length) return;
    setRotations((prev) => {
      const next = { ...prev };
      for (const n of pages) {
        const cur = next[n] ?? 0;
        const val = ((cur + delta) % 360 + 360) % 360;
        if (val === 0) delete next[n];
        else next[n] = val;
      }
      return next;
    });
  };

  const removeSelected = () => {
    const pages = targetPages().filter((n) => pageOrder.includes(n));
    if (!pages.length) return;
    setItems((prev) => prev.filter((it) => it.kind !== "page" || !pages.includes(it.page)));
    setSelected(new Set());
    setRotations((prev) => {
      const next = { ...prev };
      for (const n of pages) delete next[n];
      return next;
    });
  };

  const addInsert = async (kind: "pdf" | "image") => {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        title: kind === "pdf" ? "选择要插入的 PDF" : "选择要插入的图片",
        filters:
          kind === "pdf"
            ? [{ name: "PDF 文档", extensions: ["pdf"] }]
            : [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
      });
      if (typeof picked !== "string") return;
      const name = baseName(picked);
      let pages = 1;
      if (kind === "pdf") {
        pages = await documentPageCount(picked);
        if (!pages) throw new Error("这个 PDF 没有页面");
      }
      const draft: InsertDraft = {
        key: `i${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        path: picked,
        name,
        pages,
      };
      setItems((prev) => {
        let at = prev.length;
        if (selected.size) {
          const last = prev.reduce(
            (idx, it, i) => (it.kind === "page" && selected.has(it.page) ? i : idx),
            -1
          );
          at = last >= 0 ? last + 1 : at;
        } else {
          const cur = prev.findIndex((it) => it.kind === "page" && it.page === currentPage);
          at = cur >= 0 ? cur + 1 : at;
        }
        return [...prev.slice(0, at), { key: draft.key, kind: "insert", draft }, ...prev.slice(at)];
      });
      onNotice(`已加入待插入：${name}（${pages} 页），应用后生效`);
    } catch (e) {
      onNotice(`插入文件读取失败：${String(e)}`);
    }
  };

  const doExtract = async () => {
    const pages = targetPages();
    if (!pages.length) return;
    setExtracting(true);
    try {
      const sep = path.includes("\\") ? "\\" : "/";
      const cut = path.lastIndexOf(sep);
      const dir = cut >= 0 ? path.slice(0, cut + 1) : "";
      const dest = await save({
        title: "提取选中页",
        defaultPath: `${dir}${docName}-提取.pdf`,
        filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
      });
      if (typeof dest !== "string") return;
      await onExtract(pages, dest);
    } catch (e) {
      onNotice(`提取失败：${String(e)}`);
    } finally {
      setExtracting(false);
    }
  };

  const apply = async () => {
    if (!dirty) return;
    if (!pageOrder.length) {
      onNotice("至少要保留一页");
      return;
    }
    const removed = numPages - pageOrder.length;
    if (removed > 0) {
      const msg = `本次会删除 ${removed} 页，应用后不可撤销。继续？`;
      if (!window.confirm(msg)) return;
    }
    const inserts: PagePlan["inserts"] = [];
    let finalIndex = 0;
    for (const it of items) {
      if (it.kind === "insert") {
        inserts.push({ index: finalIndex, kind: it.draft.kind, path: it.draft.path });
        finalIndex += it.draft.pages;
      } else {
        finalIndex += 1;
      }
    }
    await onApply({ order: pageOrder, rotations, inserts });
  };

  return (
    <div className="pm-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="pm glass" role="dialog" aria-modal="true" aria-label="页面管理">
        <header className="pm-head">
          <div>
            <h2>页面管理</h2>
            <div className="pm-sub">
              {pageOrder.length} 页
              {selected.size ? ` · 已选 ${selected.size} 页` : ""}
              {Object.keys(rotations).length ? " · 已改旋转" : ""}
              {items.some((it) => it.kind === "insert") ? " · 含待插入页" : ""}
            </div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="关闭页面管理">
            <IconClose />
          </button>
        </header>

        <div className="pm-tools" role="toolbar" aria-label="页面操作">
          <button className="btn btn-secondary" onClick={() => rotate(-90)} disabled={busy}>
            <IconRotate /> 左转 90°
          </button>
          <button className="btn btn-secondary" onClick={() => rotate(90)} disabled={busy}>
            <IconRotate className="flip" /> 右转 90°
          </button>
          <button className="btn btn-secondary" onClick={removeSelected} disabled={busy}>
            删除
          </button>
          <span className="pm-sp" />
          <button className="btn btn-secondary" onClick={() => void addInsert("pdf")} disabled={busy}>
            <IconInsert /> 插入 PDF
          </button>
          <button className="btn btn-secondary" onClick={() => void addInsert("image")} disabled={busy}>
            插入图片
          </button>
          <button className="btn btn-secondary" onClick={() => void doExtract()} disabled={busy || extracting}>
            <IconExtract /> 提取
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setItems(pageItems(numPages));
              setSelected(new Set());
              setRotations({});
            }}
            disabled={busy || !dirty}
          >
            还原
          </button>
        </div>

        <div className="pm-grid">
          {items.map((it, index) => {
            if (it.kind === "insert") {
              return (
                <div
                  key={it.key}
                  className={`pm-card pm-insert${dragKey === it.key ? " dragging" : ""}${
                    overKey === it.key ? " over" : ""
                  }`}
                  draggable={!busy}
                  onDragStart={(e) => {
                    setDragKey(it.key);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", it.key);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverKey(it.key);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = e.dataTransfer.getData("text/plain") || dragKey;
                    if (from) reorder(from, it.key);
                    setDragKey(null);
                    setOverKey(null);
                  }}
                >
                  <div className="pm-insert-body">
                    <span className="pm-insert-kind">{it.draft.kind === "pdf" ? "PDF" : "图片"}</span>
                    <strong title={it.draft.name}>{it.draft.name}</strong>
                    <span>{it.draft.pages} 页 · 应用后插入</span>
                  </div>
                  <button
                    className="pm-remove"
                    aria-label="移除待插入文件"
                    onClick={() =>
                      setItems((prev) => prev.filter((x) => x.key !== it.key))
                    }
                    draggable={false}
                  >
                    ×
                  </button>
                  <span className="pm-pos">{index + 1}</span>
                </div>
              );
            }
            const delta = rotations[it.page] ?? 0;
            const rot = (((baseRot[it.page] ?? 0) + delta) % 360 + 360) % 360;
            return (
              <div
                key={it.key}
                data-page={it.page}
                className={`pm-card${selected.has(it.page) ? " selected" : ""}${
                  dragKey === it.key ? " dragging" : ""
                }${overKey === it.key ? " over" : ""}`}
                draggable={!busy}
                onClick={() => toggle(it.page)}
                onDragStart={(e) => {
                  setDragKey(it.key);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", it.key);
                }}
                onDragEnd={() => {
                  setDragKey(null);
                  setOverKey(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverKey(it.key);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = e.dataTransfer.getData("text/plain") || dragKey;
                  if (from) reorder(from, it.key);
                  setDragKey(null);
                  setOverKey(null);
                }}
              >
                <div className={`pm-thumb${rot === 90 || rot === 270 ? " quarter" : ""}`}>
                  <PageThumb doc={doc} page={it.page} rotation={delta} />
                  {rot ? <span className="pm-rot">↻ {rot}°</span> : null}
                </div>
                <div className="pm-cap">
                  <span>{index + 1}</span>
                  <small>原第 {it.page} 页</small>
                </div>
                {selected.has(it.page) && <span className="pm-check">✓</span>}
              </div>
            );
          })}
        </div>

        <footer className="pm-foot">
          <span className="pm-hint">拖动缩略图改变顺序；点选页面后批量旋转或删除。</span>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => void apply()} disabled={busy || !dirty}>
            {busy ? "正在写入…" : "应用到 PDF"}
          </button>
        </footer>
      </section>
    </div>
  );
}
