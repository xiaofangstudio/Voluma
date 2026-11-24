import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { open, save } from "@tauri-apps/plugin-dialog";
import { renderThumbnail } from "../lib/pdf";
import {
  baseName,
  cropPdf,
  documentPageCount,
  humanSize,
  mergePdfs,
  splitPdf,
  type SplitResult,
} from "../lib/tauri";
import { IconClose, IconToolkit } from "./Icons";

type Tab = "merge" | "split" | "crop";

type MergeItem = {
  key: string;
  path: string;
  name: string;
  pages: number;
  current?: boolean;
};

type Props = {
  doc: PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  docName: string;
  docPath: string;
  onClose: () => void;
  onNotice: (msg: string) => void;
  beforeRun: () => Promise<void>;
};

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "merge", label: "合并", hint: "多个 PDF 合成一份" },
  { key: "split", label: "拆分", hint: "按份数或区间拆开" },
  { key: "crop", label: "裁切", hint: "四边内缩，去掉白边" },
];

function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(0, i + 1) : "";
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith("\\") || dir.endsWith("/") ? `${dir}${name}` : `${dir}${sep}${name}`;
}

function parseRanges(spec: string, total: number): number[] {
  const normalized = spec.replace(/[，、]/g, ",");
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of normalized.split(/[,\s]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`页码「${part}」写法不对，用 1-3,5 这样`);
    const start = Number(m[1]);
    const end = Number(m[2] ?? m[1]);
    if (!start || !end) throw new Error("页码从 1 开始");
    if (start > end) throw new Error(`区间「${part}」起点大于终点`);
    if (end > total) throw new Error(`第 ${end} 页不存在（共 ${total} 页）`);
    for (let n = start; n <= end; n++) {
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  if (!out.length) throw new Error("没有有效页码");
  return out;
}

function firstPageOf(spec: string, total: number, fallback: number): number {
  const m = spec.match(/\d+/);
  if (!m) return Math.min(Math.max(1, fallback), total);
  return Math.min(Math.max(1, Number(m[0])), total);
}

function CropPreview({
  doc,
  page,
  margins,
  reset,
  pageSize,
  onSize,
}: {
  doc: PDFDocumentProxy | null;
  page: number;
  margins: [number, number, number, number];
  reset: boolean;
  pageSize: { w: number; h: number } | null;
  onSize: (size: { w: number; h: number } | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    let alive = true;
    const run = async () => {
      try {
        await renderThumbnail(doc, page, canvas, 250, 0);
        if (!alive) return;
        const p = await doc.getPage(page);
        const vp = p.getViewport({ scale: 1 });
        onSize({ w: (vp.width / 72) * 25.4, h: (vp.height / 72) * 25.4 });
        setFrame({ w: canvas.clientWidth, h: canvas.clientHeight });
      } catch {
        if (alive) onSize(null);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [doc, page, onSize]);

  const pct = (v: number, total: number) =>
    total > 0 ? Math.max(0, Math.min(100, (v / total) * 100)) : 0;
  const [top, right, bottom, left] = reset ? [0, 0, 0, 0] : margins;
  const topPct = pct(top, pageSize?.h ?? 0);
  const rightPct = pct(right, pageSize?.w ?? 0);
  const bottomPct = pct(bottom, pageSize?.h ?? 0);
  const leftPct = pct(left, pageSize?.w ?? 0);
  const innerW = frame.w * (1 - leftPct / 100 - rightPct / 100);
  const innerH = frame.h * (1 - topPct / 100 - bottomPct / 100);

  return (
    <div className="tk-preview" ref={frameRef} aria-label={`第 ${page} 页裁切预览`}>
      <div className="tk-preview-frame">
        <canvas ref={canvasRef} />
        {frame.w > 0 && (
          <div
            className="tk-crop-box"
            style={{
              top: `${topPct}%`,
              right: `${rightPct}%`,
              bottom: `${bottomPct}%`,
              left: `${leftPct}%`,
              opacity: innerW > 4 && innerH > 4 ? 1 : 0,
            }}
          />
        )}
      </div>
      <div className="tk-preview-cap">预览第 {page} 页 · 虚线内为成品</div>
    </div>
  );
}

export default function ToolkitPanel({
  doc,
  numPages,
  currentPage,
  docName,
  docPath,
  onClose,
  onNotice,
  beforeRun,
}: Props) {
  const [tab, setTab] = useState<Tab>("merge");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const currentItem: MergeItem = useMemo(
    () => ({
      key: `current:${docPath}`,
      path: docPath,
      name: docName,
      pages: numPages,
      current: true,
    }),
    [docPath, docName, numPages]
  );

  /* 合并 */
  const [mergeItems, setMergeItems] = useState<MergeItem[]>([currentItem]);
  const [mergeDest, setMergeDest] = useState(joinPath(dirOf(docPath), `${docName}-合并.pdf`));

  /* 拆分 */
  const [splitMode, setSplitMode] = useState<"chunk" | "ranges">("chunk");
  const [chunk, setChunk] = useState(2);
  const [ranges, setRanges] = useState(`1-${numPages}`);
  const [outDir, setOutDir] = useState(dirOf(docPath));
  const [prefix, setPrefix] = useState(docName);
  const [splitFiles, setSplitFiles] = useState<SplitResult["files"]>([]);

  /* 裁切 */
  const [cropScope, setCropScope] = useState<"all" | "custom">("all");
  const [cropRange, setCropRange] = useState(`1-${numPages}`);
  const [margins, setMargins] = useState({ top: "", right: "", bottom: "", left: "" });
  const [resetCrop, setResetCrop] = useState(false);
  const [cropDest, setCropDest] = useState(joinPath(dirOf(docPath), `${docName}-裁切.pdf`));
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const previewPage = useMemo(
    () =>
      cropScope === "all"
        ? Math.min(Math.max(1, currentPage), Math.max(1, numPages))
        : firstPageOf(cropRange, numPages, currentPage),
    [cropScope, cropRange, currentPage, numPages]
  );

  useEffect(() => {
    setMergeItems([currentItem]);
    setMergeDest(joinPath(dirOf(docPath), `${docName}-合并.pdf`));
    setSplitMode("chunk");
    setChunk(2);
    setRanges(`1-${numPages}`);
    setOutDir(dirOf(docPath));
    setPrefix(docName);
    setSplitFiles([]);
    setCropScope("all");
    setCropRange(`1-${numPages}`);
    setMargins({ top: "", right: "", bottom: "", left: "" });
    setResetCrop(false);
    setCropDest(joinPath(dirOf(docPath), `${docName}-裁切.pdf`));
    setResult(null);
  }, [docPath, docName, numPages, currentItem]);

  const value = (s: string) => {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const marginNums: [number, number, number, number] = [
    value(margins.top),
    value(margins.right),
    value(margins.bottom),
    value(margins.left),
  ];
  const tooMuch =
    !!pageSize &&
    !resetCrop &&
    (marginNums[3] + marginNums[1] >= pageSize.w - 6 ||
      marginNums[0] + marginNums[2] >= pageSize.h - 6);

  const estimate = useMemo(() => {
    if (splitMode === "chunk") return Math.ceil(numPages / Math.max(1, Math.floor(chunk || 1)));
    const parts = ranges
      .replace(/[，、]/g, ",")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length;
  }, [splitMode, chunk, ranges, numPages]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      await beforeRun();
      await fn();
    } catch (e) {
      onNotice(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const pickMergeFiles = async () => {
    try {
      const picked = await open({
        multiple: true,
        directory: false,
        title: "选择要合并的 PDF",
        filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
      });
      const paths = typeof picked === "string" ? [picked] : Array.isArray(picked) ? picked : [];
      if (!paths.length) return;
      const fresh: MergeItem[] = [];
      for (const p of paths) {
        if (p === docPath || mergeItems.some((it) => it.path === p)) continue;
        try {
          const pages = await documentPageCount(p);
          fresh.push({
            key: `file:${p}`,
            path: p,
            name: baseName(p),
            pages,
          });
        } catch (e) {
          onNotice(`跳过 ${baseName(p)}：${String(e)}`);
        }
      }
      if (fresh.length) {
        setMergeItems((prev) => [...prev, ...fresh]);
        onNotice(`已加入 ${fresh.length} 个文件`);
      }
    } catch (e) {
      onNotice(`选择文件失败：${String(e)}`);
    }
  };

  const moveMerge = (index: number, delta: number) => {
    setMergeItems((prev) => {
      const to = index + delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  };

  const chooseMergeDest = async () => {
    const dest = await save({
      title: "合并结果保存到",
      defaultPath: mergeDest,
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    if (typeof dest === "string") setMergeDest(dest);
  };

  const doMerge = () =>
    run(async () => {
      if (mergeItems.length < 2) throw new Error("至少加入一个别的 PDF 才能合并");
      let dest = mergeDest.trim();
      if (!dest) {
        const picked = await save({
          title: "合并结果保存到",
          defaultPath: joinPath(dirOf(docPath), `${docName}-合并.pdf`),
          filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
        });
        if (typeof picked !== "string") return;
        dest = picked;
        setMergeDest(picked);
      }
      const res = await mergePdfs(
        mergeItems.map((it) => it.path),
        dest
      );
      const name = dest.split(/[\\/]/).pop() ?? dest;
      setResult(`已合并 ${mergeItems.length} 个文件，共 ${res.pages} 页 · ${name}`);
      onNotice(`已合并：${name}（${res.pages} 页）`);
    });

  const chooseOutDir = async () => {
    const picked = await open({ directory: true, multiple: false, title: "选择拆分输出目录" });
    if (typeof picked === "string") setOutDir(picked);
  };

  const doSplit = () =>
    run(async () => {
      const req = {
        mode: splitMode,
        chunk: Math.max(1, Math.floor(chunk || 1)),
        ranges:
          splitMode === "ranges"
            ? ranges
                .replace(/[，、]/g, ",")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        destDir: outDir.trim() || undefined,
        prefix: prefix.trim() || undefined,
      };
      const res = await splitPdf(docPath, req);
      setSplitFiles(res.files);
      setResult(`已拆成 ${res.files.length} 个文件，共 ${res.pages} 页`);
      onNotice(`已拆成 ${res.files.length} 个文件`);
    });

  const chooseCropDest = async () => {
    const dest = await save({
      title: "裁切结果保存到",
      defaultPath: cropDest,
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    if (typeof dest === "string") setCropDest(dest);
  };

  const doCrop = () =>
    run(async () => {
      if (!resetCrop && marginNums.every((m) => m <= 0)) {
        throw new Error("请至少设置一边裁切，或勾选恢复整页");
      }
      let pages: number[] = [];
      if (cropScope === "custom") pages = parseRanges(cropRange, numPages);
      let dest = cropDest.trim();
      if (!dest) {
        const picked = await save({
          title: "裁切结果保存到",
          defaultPath: joinPath(dirOf(docPath), `${docName}-裁切.pdf`),
          filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
        });
        if (typeof picked !== "string") return;
        dest = picked;
        setCropDest(picked);
      }
      const res = await cropPdf(docPath, {
        dest,
        pages,
        margins: marginNums,
        resetCrop,
      });
      const name = dest.split(/[\\/]/).pop() ?? dest;
      setResult(
        resetCrop
          ? `已恢复完整页面 · ${name}`
          : `已裁切 ${res.pages} 页 · ${name}`
      );
      onNotice(resetCrop ? `已恢复完整页面：${name}` : `已裁切 ${res.pages} 页：${name}`);
    });

  return (
    <div
      className="pm-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className="pm glass tk" role="dialog" aria-modal="true" aria-label="PDF 工具">
        <header className="pm-head">
          <div>
            <h2>
              <IconToolkit /> PDF 工具
            </h2>
            <div className="pm-sub">合并 · 拆分 · 裁切，全部只生成新文件，不动原件</div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="关闭工具">
            <IconClose />
          </button>
        </header>

        <div className="tk-tabs" role="tablist" aria-label="工具">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`tk-tab${tab === t.key ? " active" : ""}`}
              onClick={() => {
                setTab(t.key);
                setResult(null);
              }}
            >
              <strong>{t.label}</strong>
              <small>{t.hint}</small>
            </button>
          ))}
        </div>

        <div className="tk-body">
          {tab === "merge" && (
            <>
              <div className="tk-section-head">
                <span>合并顺序</span>
                <small>当前文档固定参与；上下移动调整顺序</small>
              </div>
              <div className="tk-filelist">
                {mergeItems.map((it, i) => (
                  <div className="tk-file" key={it.key}>
                    <span className="tk-file-no">{i + 1}</span>
                    <div className="tk-file-main">
                      <strong title={it.path}>{it.name}</strong>
                      <small>
                        {it.pages} 页{it.current ? " · 当前文档" : ""}
                      </small>
                    </div>
                    <div className="tk-file-actions">
                      <button
                        className="tk-mini"
                        onClick={() => moveMerge(i, -1)}
                        disabled={busy || i === 0}
                        aria-label="上移"
                      >
                        ↑
                      </button>
                      <button
                        className="tk-mini"
                        onClick={() => moveMerge(i, 1)}
                        disabled={busy || i === mergeItems.length - 1}
                        aria-label="下移"
                      >
                        ↓
                      </button>
                      <button
                        className="tk-mini danger"
                        onClick={() => setMergeItems((prev) => prev.filter((x) => x.key !== it.key))}
                        disabled={busy || it.current}
                        aria-label="移除"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button className="btn btn-secondary tk-add" onClick={() => void pickMergeFiles()} disabled={busy}>
                + 加入其他 PDF
              </button>
              <div className="tk-field">
                <label>保存到</label>
                <div className="tk-path">
                  <input value={mergeDest} onChange={(e) => setMergeDest(e.target.value)} />
                  <button className="btn btn-ghost" onClick={() => void chooseMergeDest()} disabled={busy}>
                    选择…
                  </button>
                </div>
              </div>
              <div className="tk-hint">合并后清除目录、表单树这类跨文件引用，页面内容与注释保留。</div>
            </>
          )}

          {tab === "split" && (
            <>
              <div className="tk-segment">
                <button
                  className={`tk-seg${splitMode === "chunk" ? " active" : ""}`}
                  onClick={() => setSplitMode("chunk")}
                >
                  按份数
                </button>
                <button
                  className={`tk-seg${splitMode === "ranges" ? " active" : ""}`}
                  onClick={() => setSplitMode("ranges")}
                >
                  按区间
                </button>
              </div>
              {splitMode === "chunk" ? (
                <div className="tk-row">
                  <label>每份页数</label>
                  <input
                    type="number"
                    min={1}
                    max={numPages}
                    value={chunk}
                    onChange={(e) => setChunk(Number(e.target.value))}
                  />
                  <span className="tk-unit">页 / 份</span>
                </div>
              ) : (
                <div className="tk-field">
                  <label>拆分区间</label>
                  <input
                    value={ranges}
                    onChange={(e) => setRanges(e.target.value)}
                    placeholder="1-3, 5-8"
                  />
                </div>
              )}
              <div className="tk-row">
                <label>文件名前缀</label>
                <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
              </div>
              <div className="tk-field">
                <label>输出目录</label>
                <div className="tk-path">
                  <input value={outDir} onChange={(e) => setOutDir(e.target.value)} />
                  <button className="btn btn-ghost" onClick={() => void chooseOutDir()} disabled={busy}>
                    选择…
                  </button>
                </div>
              </div>
              <div className="tk-hint">
                预计 {estimate} 个文件，命名形如「{prefix || docName}-1-2.pdf」；重名自动加序号，不覆盖旧文件。
              </div>
              {splitFiles.length > 0 && (
                <div className="tk-results">
                  {splitFiles.map((f) => (
                    <span key={f.path} title={f.path}>
                      {f.path.split(/[\\/]/).pop()} · {f.pages} 页 · {humanSize(f.bytes)}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === "crop" && (
            <div className="tk-crop">
              <div className="tk-crop-left">
                <div className="tk-segment">
                  <button
                    className={`tk-seg${cropScope === "all" ? " active" : ""}`}
                    onClick={() => setCropScope("all")}
                  >
                    全部页
                  </button>
                  <button
                    className={`tk-seg${cropScope === "custom" ? " active" : ""}`}
                    onClick={() => setCropScope("custom")}
                  >
                    指定页
                  </button>
                </div>
                {cropScope === "custom" && (
                  <div className="tk-field">
                    <label>页码</label>
                    <input
                      value={cropRange}
                      onChange={(e) => setCropRange(e.target.value)}
                      placeholder="1-3,5"
                    />
                  </div>
                )}
                <div className="tk-margins">
                  {(["top", "bottom", "left", "right"] as const).map((k) => (
                    <div className="tk-margin" key={k}>
                      <label>{k === "top" ? "上" : k === "bottom" ? "下" : k === "left" ? "左" : "右"}</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        placeholder="0"
                        value={margins[k]}
                        disabled={resetCrop}
                        onChange={(e) => setMargins((prev) => ({ ...prev, [k]: e.target.value }))}
                      />
                      <span>mm</span>
                    </div>
                  ))}
                </div>
                <label className="tk-check">
                  <input
                    type="checkbox"
                    checked={resetCrop}
                    onChange={(e) => setResetCrop(e.target.checked)}
                  />
                  恢复整页（清掉已有裁切）
                </label>
                <div className="tk-field">
                  <label>保存到</label>
                  <div className="tk-path">
                    <input value={cropDest} onChange={(e) => setCropDest(e.target.value)} />
                    <button className="btn btn-ghost" onClick={() => void chooseCropDest()} disabled={busy}>
                      选择…
                    </button>
                  </div>
                </div>
                {pageSize && !resetCrop && (
                  <div className={`tk-hint${tooMuch ? " bad" : ""}`}>
                    {tooMuch
                      ? "边距太大，成品会小于 18pt；请减小边距"
                      : `成品约 ${(pageSize.w - marginNums[1] - marginNums[3]).toFixed(1)} × ${(
                          pageSize.h - marginNums[0] - marginNums[2]
                        ).toFixed(1)} mm`}
                  </div>
                )}
              </div>
              <div className="tk-crop-right">
                <CropPreview
                  doc={doc}
                  page={previewPage}
                  margins={marginNums}
                  reset={resetCrop}
                  pageSize={pageSize}
                  onSize={setPageSize}
                />
                <div className="tk-hint">四边按当前预览方向计算；裁切只改 CropBox，页面内容不重采样。</div>
              </div>
            </div>
          )}
        </div>

        <footer className="pm-foot tk-foot">
          <span className="pm-hint">
            {result ? result : "所有操作都在本机完成，不联网、不上传。"}
          </span>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            关闭
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (tab === "merge") void doMerge();
              else if (tab === "split") void doSplit();
              else void doCrop();
            }}
            disabled={
              busy ||
              (tab === "merge" && mergeItems.length < 2) ||
              (tab === "split" && splitMode === "ranges" && !ranges.trim()) ||
              (tab === "crop" && (tooMuch || (!resetCrop && marginNums.every((m) => m <= 0))))
            }
          >
            {busy ? "正在处理…" : tab === "merge" ? "开始合并" : tab === "split" ? "开始拆分" : resetCrop ? "恢复整页" : "开始裁切"}
          </button>
        </footer>
      </section>
    </div>
  );
}
