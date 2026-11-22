import React, { useEffect, useMemo, useRef, useState } from "react";
import { IconClose, IconSearch } from "./Icons";
import {
  renderThumbnail,
  type OutlineNode,
  type PDFDocumentProxy,
  type SearchHit,
} from "../lib/pdf";
import {
  ANNOT_COLORS,
  ANNOT_LABEL,
  annotSnippet,
  type Annot,
} from "../lib/annots";

export type PanelKind = "outline" | "thumbs" | "search" | "annots";

type Props = {
  kind: PanelKind;
  doc: PDFDocumentProxy;
  numPages: number;
  currentPage: number;
  outline: OutlineNode[] | null;
  outlineLoading: boolean;
  query: string;
  onQuery: (q: string) => void;
  hits: SearchHit[];
  hitIndex: number;
  searching: boolean;
  searched: number;
  annots: Annot[];
  annotsLoading: boolean;
  selectedAnnot: string | null;
  onPickHit: (i: number) => void;
  onJump: (page: number) => void;
  onPickAnnot: (a: Annot) => void;
  onDeleteAnnot: (id: string) => void;
  onRecolorAnnot: (id: string, color: string) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onEnter: () => void;
  onOpenThumbs: () => void;
};

function OutlineRows({
  nodes,
  depth,
  current,
  onJump,
}: {
  nodes: OutlineNode[];
  depth: number;
  current: number;
  onJump: (p: number) => void;
}) {
  return (
    <>
      {nodes.map((n, i) => (
        <div key={`${depth}-${i}-${n.title}`} className="outline-item">
          <button
            className={`outline-row${n.page === current ? " current" : ""}`}
            style={{ paddingLeft: 12 + depth * 14 }}
            disabled={n.page == null}
            onClick={() => n.page && onJump(n.page)}
            title={n.page ? `跳到第 ${n.page} 页` : "该项无跳转目标"}
          >
            <span className="outline-title">{n.title}</span>
            {n.page != null && <span className="outline-page">{n.page}</span>}
          </button>
          {n.children.length > 0 && (
            <OutlineRows nodes={n.children} depth={Math.min(depth + 1, 3)} current={current} onJump={onJump} />
          )}
        </div>
      ))}
    </>
  );
}

function Thumbs({ doc, numPages, current, onJump }: { doc: PDFDocumentProxy; numPages: number; current: number; onJump: (p: number) => void }) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const canvases = Array.from(root.querySelectorAll<HTMLCanvasElement>("canvas[data-page]"));
    let cancelled = false;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const canvas = entry.target as HTMLCanvasElement;
          if (canvas.dataset.ready === "1") continue;
          canvas.dataset.ready = "1";
          const n = Number(canvas.dataset.page);
          renderThumbnail(doc, n, canvas, 168).catch(() => {
            canvas.dataset.ready = "0";
          });
        }
      },
      { root, rootMargin: "120px 0px" }
    );

    canvases.forEach((c) => observer.observe(c));
    return () => {
      cancelled = true;
      observer.disconnect();
      void cancelled;
    };
  }, [doc, numPages]);

  useEffect(() => {
    const root = listRef.current;
    const cur = root?.querySelector<HTMLElement>(`.thumb[data-page="${current}"]`);
    cur?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <div className="thumb-list" ref={listRef}>
      {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          data-page={n}
          className={`thumb${n === current ? " current" : ""}`}
          onClick={() => onJump(n)}
        >
          <canvas data-page={n} data-ready="0" />
          <span className="thumb-no">{n}</span>
        </button>
      ))}
    </div>
  );
}

export default function Sidebar({
  kind,
  doc,
  numPages,
  currentPage,
  outline,
  outlineLoading,
  query,
  onQuery,
  hits,
  hitIndex,
  searching,
  searched,
  annots,
  annotsLoading,
  selectedAnnot,
  onPickHit,
  onJump,
  onPickAnnot,
  onDeleteAnnot,
  onRecolorAnnot,
  onClose,
  inputRef,
  onEnter,
  onOpenThumbs,
}: Props) {
  const [sort, setSort] = useState<"page" | "time">("page");
  const ordered = useMemo(() => {
    const list = annots.slice();
    if (sort === "page") {
      list.sort((a, b) => (a.page - b.page) || (a.createdAt - b.createdAt));
    } else {
      list.sort((a, b) => b.createdAt - a.createdAt);
    }
    return list;
  }, [annots, sort]);

  const title =
    kind === "outline" ? "目录" : kind === "thumbs" ? "缩略图" : kind === "search" ? "搜索" : "注释";

  return (
    <aside className="sidepanel" aria-label={title}>
      <div className="panel-head">
        <span>{title}</span>
        <button className="iconbtn" onClick={onClose} aria-label="关闭侧栏">
          <IconClose />
        </button>
      </div>

      {kind === "outline" && (
        <div className="panel-body outline-body">
          {outlineLoading && <div className="panel-empty">正在读取目录…</div>}
          {!outlineLoading && outline && outline.length > 0 && (
            <OutlineRows nodes={outline} depth={0} current={currentPage} onJump={onJump} />
          )}
          {!outlineLoading && (!outline || outline.length === 0) && (
            <div className="panel-empty">
              这份 PDF 没有书签目录。
              <button className="link-btn" onClick={onOpenThumbs}>
                改用缩略图浏览
              </button>
            </div>
          )}
        </div>
      )}

      {kind === "thumbs" && (
        <div className="panel-body">
          <Thumbs doc={doc} numPages={numPages} current={currentPage} onJump={onJump} />
        </div>
      )}

      {kind === "search" && (
        <div className="panel-body search-body">
          <div className="search-box">
            <IconSearch size={16} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onEnter();
                }
              }}
              placeholder="在全文里搜索…"
              aria-label="全文搜索"
              spellCheck={false}
            />
          </div>
          <div className="search-meta">
            {searching ? `正在搜索 ${searched}/${numPages} 页…` : hits.length ? `${hits.length} 条结果` : query ? "没有找到" : "输入关键词开始搜索"}
          </div>
          <div className="search-list">
            {hits.map((h, i) => (
              <button
                key={`${h.page}-${h.index}`}
                className={`search-row${i === hitIndex ? " current" : ""}`}
                onClick={() => onPickHit(i)}
              >
                <span className="search-page">第 {h.page} 页</span>
                <span className="search-snippet">{h.snippet}</span>
              </button>
            ))}
          </div>
          {hits.length > 0 && (
            <div className="search-foot">
              <span>
                {hitIndex + 1} / {hits.length}
              </span>
              <span className="kbd-hint">Enter 下一个</span>
            </div>
          )}
        </div>
      )}

      {kind === "annots" && (
        <div className="panel-body annots-body">
          <div className="annots-head">
            <span>{annotsLoading ? "正在读取…" : `${annots.length} 条注释`}</span>
            <div className="annots-sort">
              <button className={sort === "page" ? "on" : ""} onClick={() => setSort("page")}>
                按页
              </button>
              <button className={sort === "time" ? "on" : ""} onClick={() => setSort("time")}>
                按时间
              </button>
            </div>
          </div>

          {!annotsLoading && annots.length === 0 && (
            <div className="panel-empty">
              还没有注释。选中文字后用高亮，或在上方工具栏里选矩形、画笔、便签。
            </div>
          )}

          <div className="annot-list">
            {ordered.map((a) => (
              <div
                key={a.id}
                className={`annot-row${a.id === selectedAnnot ? " current" : ""}`}
              >
                <button className="annot-jump" onClick={() => onPickAnnot(a)}>
                  <span
                    className="annot-dot"
                    style={{ background: a.color }}
                    aria-hidden="true"
                  />
                  <span className="annot-main">
                    <span className="annot-meta">
                      {ANNOT_LABEL[a.type]} · 第 {a.page} 页
                    </span>
                    <span className="annot-text">{annotSnippet(a)}</span>
                  </span>
                </button>
                <button
                  className="annot-del"
                  onClick={() => onDeleteAnnot(a.id)}
                  aria-label="删除这条注释"
                  title="删除"
                >
                  ×
                </button>
                {a.id === selectedAnnot && (
                  <div className="annot-colors">
                    {ANNOT_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`color-dot${a.color === c ? " on" : ""}`}
                        style={{ background: c }}
                        onClick={() => onRecolorAnnot(a.id, c)}
                        aria-label={`改为${c}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
