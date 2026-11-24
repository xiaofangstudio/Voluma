import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopBar, { type AnnotTool, type PanelKind, type SaveState, type ViewMode } from "./TopBar";
import Sidebar from "./Sidebar";
import Continuous, { type ContinuousHandle } from "./Continuous";
import PageManager, { type PagePlan } from "./PageManager";
import ToolkitPanel from "./ToolkitPanel";
import FormPanel from "./FormPanel";
import PrintPanel from "./PrintPanel";
import TtsBar from "./TtsBar";
import { IconChevronLeft, IconChevronRight } from "./Icons";
import {
  loadBaseSizes,
  loadOutline,
  openPdf,
  paintHighlights,
  PDF_TO_CSS,
  renderCover,
  renderPageInto,
  searchDocument,
  type BaseSize,
  type OutlineNode,
  type PDFDocumentProxy,
  type SearchHit,
} from "../lib/pdf";
import { extractPageSegments, readTtsPrefs, saveTtsPrefs, type TtsSegment, type TtsStatus } from "../lib/tts";
import {
  collectFormValues,
  renderWidgetLayer,
  scanForms,
  type FormWidget,
} from "../lib/forms";
import {
  ANNOT_COLORS,
  ANNOT_LABEL,
  annotSnippet,
  cssRect,
  nextAnnotId,
  pageMeta,
  paintAnnotationsForWrap,
  rectFromPoints,
  registerPageMeta,
  repaintAnnotations,
  selectionDraft,
  toPayload,
  type Annot,
  type AnnotKind,
} from "../lib/annots";
import {
  buildPrintDocument,
  clearPrintDocument,
  printNow,
  schedulePrintCleanup,
  type PrintLayout,
} from "../lib/print";
import {
  IS_TAURI,
  applyPagePlan,
  exportWithoutAnnotations,
  extractPages,
  flattenForm,
  readAnnotations,
  saveAnnotations,
  saveFormValues,
} from "../lib/tauri";

export type DocHandle = {
  path: string;
  name: string;
  data: ArrayBuffer;
  startPage: number;
  startZoom: number | "fit";
};

type Props = {
  doc: DocHandle;
  onClose: () => void;
  onProgress: (page: number, zoom: number | "fit", pages: number) => void;
  onMeta: (pages: number, cover: string) => void;
  onNotice: (msg: string) => void;
  onOpenAnother: () => void;
  onReload: () => Promise<void>;
};

const MIN_ZOOM = 8;
const MAX_ZOOM = 6400;
const FALLBACK: BaseSize = { w: 612, h: 792 };

export default function Viewer({ doc, onClose, onProgress, onMeta, onNotice, onOpenAnother, onReload }: Props) {
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const continuousRef = useRef<ContinuousHandle>(null);
  const renderToken = useRef(0);
  const anchorRef = useRef<{ rx: number; ry: number; x: number; y: number } | null>(null);
  const searchToken = useRef<{ cancel: boolean } | null>(null);
  const textCache = useRef(new Map<number, string>());
  const searchInput = useRef<HTMLInputElement>(null);

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(Math.max(1, doc.startPage));
  const [pageText, setPageText] = useState(String(Math.max(1, doc.startPage)));
  const [zoom, setZoom] = useState<number | "fit">(doc.startZoom);
  const [mode, setMode] = useState<ViewMode>("single");
  const [night, setNight] = useState(false);
  const [scalePct, setScalePct] = useState(100);
  const [avail, setAvail] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sizes, setSizes] = useState<Map<number, BaseSize>>(new Map());
  const [sizesReady, setSizesReady] = useState(false);
  const [sizesDone, setSizesDone] = useState(0);

  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);

  const [panel, setPanel] = useState<PanelKind>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitIndex, setHitIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(0);

  /* ---------- M2 注释 ---------- */
  const [tool, setTool] = useState<AnnotTool>("none");
  const [color, setColor] = useState(ANNOT_COLORS[0]);
  const [annots, setAnnots] = useState<Annot[]>([]);
  const [annotsLoading, setAnnotsLoading] = useState(false);
  const [selectedAnnot, setSelectedAnnot] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saving");
  const [composer, setComposer] = useState<{
    kind: "note" | "pin";
    page: number;
    rect: [number, number, number, number];
    x: number;
    y: number;
  } | null>(null);
  const [draftText, setDraftText] = useState("");
  const [pmOpen, setPmOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);

  /* ---------- M8 朗读 ---------- */
  const [ttsOpen, setTtsOpen] = useState(false);
  const [ttsStatus, setTtsStatus] = useState<TtsStatus>("idle");
  const [ttsPage, setTtsPage] = useState(1);
  const [ttsSegments, setTtsSegments] = useState<TtsSegment[]>([]);
  const [ttsIndex, setTtsIndex] = useState(0);
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsVoiceName, setTtsVoiceName] = useState(() => readTtsPrefs().voiceName);
  const [ttsRate, setTtsRate] = useState(() => readTtsPrefs().rate);
  const [ttsMessage, setTtsMessage] = useState("");

  /* ---------- M3 表单 ---------- */
  const [formWidgets, setFormWidgets] = useState<FormWidget[]>([]);
  const [formsOpen, setFormsOpen] = useState(false);
  const [formBusy, setFormBusy] = useState(false);

  /* ---------- M4 打印与导出 ---------- */
  const [printOpen, setPrintOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [printText, setPrintText] = useState("");
  const [exportBusy, setExportBusy] = useState(false);

  const toolRef = useRef<AnnotTool>(tool);
  const colorRef = useRef(color);
  const annotsRef = useRef<Annot[]>(annots);
  const selectedRef = useRef<string | null>(selectedAnnot);
  const ttsToggleRef = useRef<() => void>(() => {});
  const loadedRef = useRef(false);
  const savedPayloadRef = useRef("");
  const savedFormRef = useRef("");
  const formWidgetsRef = useRef<FormWidget[]>([]);
  const ttsCacheRef = useRef(new Map<number, TtsSegment[]>());
  const ttsRunRef = useRef(0);
  const ttsPageRef = useRef(1);
  const ttsIndexRef = useRef(0);
  const ttsStatusRef = useRef<TtsStatus>("idle");
  const ttsVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const ttsVoiceRef = useRef("");
  const ttsRateRef = useRef(1);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const saveTimer = useRef(0);
  toolRef.current = tool;
  colorRef.current = color;
  annotsRef.current = annots;
  selectedRef.current = selectedAnnot;
  ttsVoiceRef.current = ttsVoiceName;
  ttsRateRef.current = ttsRate;
  ttsStatusRef.current = ttsStatus;

  const payload = useMemo(() => JSON.stringify(toPayload(annots)), [annots]);

  const hitPage = hitIndex >= 0 && hits[hitIndex] ? hits[hitIndex].page : null;
  const queryRef = useRef(query);
  const hitRef = useRef(hitPage);
  queryRef.current = query;
  hitRef.current = hitPage;

  const baseOf = useCallback(
    (n: number) => sizes.get(n) ?? sizes.get(1) ?? FALLBACK,
    [sizes]
  );

  const computeScale = useCallback(() => {
    const availW = Math.max(120, (avail || 900) - 48);
    let cssScale: number;
    if (zoom === "fit") {
      if (mode === "continuous") {
        let maxW = FALLBACK.w;
        if (sizes.size) for (const s of sizes.values()) maxW = Math.max(maxW, s.w);
        cssScale = availW / maxW;
      } else if (mode === "double") {
        let sum = baseOf(page).w;
        if (page + 1 <= numPages) sum += baseOf(page + 1).w;
        cssScale = (availW - 12) / Math.max(1, sum);
      } else {
        cssScale = availW / Math.max(1, baseOf(page).w);
      }
    } else {
      cssScale = (zoom / 100) * PDF_TO_CSS;
    }
    return Math.min((MAX_ZOOM / 100) * PDF_TO_CSS, Math.max((MIN_ZOOM / 100) * PDF_TO_CSS, cssScale));
  }, [avail, zoom, mode, sizes, page, numPages, baseOf]);

  /* ---------- 载入 ---------- */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loadedRef.current = false;
    savedPayloadRef.current = "";
    setAnnots([]);
    annotsRef.current = [];
    setSelectedAnnot(null);
    setAnnotsLoading(false);
    setSaveState("saving");
    setFormWidgets([]);
    formWidgetsRef.current = [];
    savedFormRef.current = "";
    setFormsOpen(false);
    setPrintOpen(false);
    setPrintBusy(false);
    setToolsOpen(false);
    clearPrintDocument();

    openPdf(doc.data)
      .then(async (d) => {
        if (!alive) {
          d.destroy();
          return;
        }
        docRef.current = d;
        setNumPages(d.numPages);
        setPage((p) => Math.min(Math.max(1, p), d.numPages));
        setLoading(false);
        try {
          const cover = await renderCover(d);
          if (alive) onMeta(d.numPages, cover);
        } catch {
          if (alive) onMeta(d.numPages, "");
        }

        scanForms(d, d.numPages)
          .then((list) => {
            if (!alive) return;
            setFormWidgets(list);
            formWidgetsRef.current = list;
            savedFormRef.current = JSON.stringify({
              fields: collectFormValues(d, list),
            });
          })
          .catch(() => {
            if (!alive) return;
            setFormWidgets([]);
            formWidgetsRef.current = [];
            savedFormRef.current = "[]";
          });

        if (IS_TAURI && doc.path) {
          setAnnotsLoading(true);
          readAnnotations(doc.path)
            .then((rows) => {
              if (!alive) return;
              const base = Date.now();
              const list = (rows as Omit<Annot, "createdAt">[]).map((r, i) => ({
                ...r,
                createdAt: base + i,
              }));
              setAnnots(list);
              annotsRef.current = list;
              savedPayloadRef.current = JSON.stringify(toPayload(list));
              loadedRef.current = true;
              setSaveState("saved");
            })
            .catch((e: unknown) => {
              if (!alive) return;
              loadedRef.current = true;
              setSaveState("error");
              onNotice(`注释读取失败：${String((e as Error)?.message ?? e)}`);
            })
            .finally(() => {
              if (alive) setAnnotsLoading(false);
            });
        } else {
          loadedRef.current = true;
          setSaveState("preview");
        }
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(String((e as Error)?.message ?? e));
        setLoading(false);
        setSaveState("error");
      });

    return () => {
      alive = false;
      searchToken.current && (searchToken.current.cancel = true);
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [doc.path, doc.data, onMeta]);

  /* ---------- 注释自动保存 ---------- */
  const flushSave = useCallback(
    async function flush() {
      if (!IS_TAURI || !loadedRef.current) return;
      const nextAnnot = JSON.stringify(toPayload(annotsRef.current));
      const d = docRef.current;
      const nextForm = d
        ? JSON.stringify({ fields: collectFormValues(d, formWidgetsRef.current) })
        : JSON.stringify({ fields: [] });
      const annotChanged = nextAnnot !== savedPayloadRef.current;
      const formChanged = nextForm !== savedFormRef.current;
      if (!annotChanged && !formChanged) {
        setSaveState("saved");
        return;
      }
      if (savingRef.current) {
        pendingRef.current = true;
        return;
      }
      savingRef.current = true;
      setSaveState("saving");
      try {
        if (annotChanged) await saveAnnotations(doc.path, nextAnnot, true);
        savedPayloadRef.current = nextAnnot;
        if (formChanged) await saveFormValues(doc.path, nextForm, true);
        savedFormRef.current = nextForm;
        const latestAnnot = JSON.stringify(toPayload(annotsRef.current));
        const latestForm = d
          ? JSON.stringify({ fields: collectFormValues(d, formWidgetsRef.current) })
          : JSON.stringify({ fields: [] });
        setSaveState(
          latestAnnot === nextAnnot && latestForm === nextForm ? "saved" : "dirty"
        );
      } catch (e: unknown) {
        setSaveState("error");
        onNotice(`保存到 PDF 失败：${String((e as Error)?.message ?? e)}`);
      } finally {
        savingRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          window.setTimeout(() => void flush(), 0);
        }
      }
    },
    [doc.path, onNotice]
  );

  useEffect(() => {
    if (!loadedRef.current) return;
    if (!IS_TAURI) return;
    if (payload === savedPayloadRef.current) {
      setSaveState((s) => (s === "saving" ? s : "saved"));
      return;
    }
    setSaveState("dirty");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flushSave(), 1200);
    return () => window.clearTimeout(saveTimer.current);
  }, [payload, flushSave]);

  useEffect(() => {
    const host = contentRef.current;
    if (!host || !formWidgets.length) return;
    const onChange = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest(".widgetLayer")) return;
      if (!loadedRef.current) return;
      setSaveState("dirty");
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flushSave(), 1200);
    };
    host.addEventListener("input", onChange, true);
    host.addEventListener("change", onChange, true);
    return () => {
      host.removeEventListener("input", onChange, true);
      host.removeEventListener("change", onChange, true);
    };
  }, [formWidgets.length, flushSave]);

  useEffect(() => {
    return () => window.clearTimeout(saveTimer.current);
  }, [doc.path]);

  const requestClose = useCallback(() => {
    void flushSave();
    onClose();
  }, [flushSave, onClose]);

  const requestOpen = useCallback(() => {
    void flushSave();
    onOpenAnother();
  }, [flushSave, onOpenAnother]);

  /* ---------- 页面管理 ---------- */
  const togglePages = useCallback(() => {
    if (pmOpen) {
      setPmOpen(false);
      return;
    }
    if (!IS_TAURI || doc.path.startsWith("browser:")) {
      onNotice("页面管理只在桌面版可用");
      return;
    }
    if (loading || !numPages) {
      onNotice("PDF 还在解析，稍等一下");
      return;
    }
    setPmOpen(true);
  }, [pmOpen, doc.path, loading, numPages, onNotice]);

  /* ---------- M6 PDF 工具 ---------- */
  const toggleTools = useCallback(() => {
    if (toolsOpen) {
      setToolsOpen(false);
      return;
    }
    if (!IS_TAURI || doc.path.startsWith("browser:")) {
      onNotice("合并 / 拆分 / 裁切只在桌面版可用");
      return;
    }
    if (loading || !numPages) {
      onNotice("PDF 还在解析，稍等一下");
      return;
    }
    setPmOpen(false);
    setFormsOpen(false);
    setToolsOpen(true);
  }, [toolsOpen, doc.path, loading, numPages, onNotice]);

  const applyPages = useCallback(
    async (plan: PagePlan) => {
      if (!IS_TAURI || doc.path.startsWith("browser:")) {
        onNotice("页面管理只在桌面版可用");
        return;
      }
      setPageBusy(true);
      try {
        await flushSave();
        const res = await applyPagePlan(doc.path, JSON.stringify(plan), true);
        onNotice(`页面已更新：现在共 ${res.pages} 页`);
        await onReload();
        setPmOpen(false);
      } catch (e) {
        onNotice(`页面操作失败：${String(e)}`);
      } finally {
        setPageBusy(false);
      }
    },
    [doc.path, flushSave, onNotice, onReload]
  );

  const extractSelected = useCallback(
    async (pages: number[], dest: string) => {
      if (!IS_TAURI || doc.path.startsWith("browser:")) {
        onNotice("提取只在桌面版可用");
        return;
      }
      setPageBusy(true);
      try {
        await flushSave();
        const res = await extractPages(doc.path, pages, dest);
        const name = dest.split(/[\\/]/).pop() ?? dest;
        onNotice(`已提取 ${res.pages} 页：${name}`);
      } catch (e) {
        onNotice(`提取失败：${String(e)}`);
      } finally {
        setPageBusy(false);
      }
    },
    [doc.path, flushSave, onNotice]
  );

  /* ---------- 表单 ---------- */
  const formFieldCount = useMemo(
    () => new Set(formWidgets.map((f) => f.name)).size,
    [formWidgets]
  );

  const toggleForms = useCallback(() => {
    if (formsOpen) {
      setFormsOpen(false);
      return;
    }
    if (!formFieldCount) {
      onNotice("这个 PDF 没有可填写的表单字段");
      return;
    }
    setFormsOpen(true);
  }, [formsOpen, formFieldCount, onNotice]);

  const saveFormsNow = useCallback(async () => {
    await flushSave();
  }, [flushSave]);

  const flattenForms = useCallback(async () => {
    if (!IS_TAURI || doc.path.startsWith("browser:")) {
      onNotice("表单展平只在桌面版可用");
      return;
    }
    setFormBusy(true);
    try {
      await flushSave();
      const d = docRef.current;
      if (!d) return;
      const sep = doc.path.includes("\\") ? "\\" : "/";
      const cut = doc.path.lastIndexOf(sep);
      const dir = cut >= 0 ? doc.path.slice(0, cut + 1) : "";
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = await save({
        title: "导出展平 PDF",
        defaultPath: `${dir}${doc.name}-展平.pdf`,
        filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
      });
      if (typeof dest !== "string") return;
      const formData = JSON.stringify({
        fields: collectFormValues(d, formWidgetsRef.current),
      });
      const res = await flattenForm(doc.path, dest, formData);
      const name = dest.split(/[\\/]/).pop() ?? dest;
      onNotice(`已展平 ${res.fields} 个字段：${name}`);
      setFormsOpen(false);
    } catch (e) {
      onNotice(`展平失败：${String(e)}`);
    } finally {
      setFormBusy(false);
    }
  }, [doc.path, doc.name, flushSave, onNotice]);

  /* ---------- M4 打印与导出 ---------- */
  const togglePrint = useCallback(() => {
    if (printOpen) {
      if (!printBusy) setPrintOpen(false);
      return;
    }
    if (loading) {
      onNotice("文档还在载入，稍后再试");
      return;
    }
    if (!numPages) {
      onNotice("没有可打印的页面");
      return;
    }
    setPrintOpen(true);
  }, [printOpen, printBusy, loading, numPages, onNotice]);

  const runPrint = useCallback(
    async (pages: number[], layout: PrintLayout) => {
      const d = docRef.current;
      if (!d) {
        onNotice("文档尚未就绪");
        return;
      }
      if (!pages.length) {
        onNotice("没有选中要打印的页面");
        return;
      }
      setPrintBusy(true);
      setPrintText("正在保存当前修改…");
      try {
        await flushSave();
        await buildPrintDocument({
          doc: d,
          pages,
          layout,
          onProgress: (done, total) => setPrintText(`正在生成第 ${done}/${total} 页…`),
        });
        setPrintText("正在打开系统打印对话框…");
        await new Promise((r) => window.setTimeout(r, 80));
        setPrintOpen(false);
        await new Promise((r) => window.setTimeout(r, 120));
        schedulePrintCleanup();
        printNow();
      } catch (e) {
        clearPrintDocument();
        onNotice(`打印准备失败：${String(e)}`);
        setPrintOpen(false);
      } finally {
        setPrintBusy(false);
        setPrintText("");
      }
    },
    [flushSave, onNotice]
  );

  const exportClean = useCallback(async () => {
    if (!IS_TAURI || doc.path.startsWith("browser:")) {
      onNotice("导出无注释版只在桌面版可用");
      return;
    }
    if (exportBusy) return;
    setExportBusy(true);
    try {
      await flushSave();
      const sep = doc.path.includes("\\") ? "\\" : "/";
      const cut = doc.path.lastIndexOf(sep);
      const dir = cut >= 0 ? doc.path.slice(0, cut + 1) : "";
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = await save({
        title: "导出无注释版 PDF",
        defaultPath: `${dir}${doc.name}-无注释.pdf`,
        filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
      });
      if (typeof dest !== "string") return;
      const res = await exportWithoutAnnotations(doc.path, dest);
      const name = dest.split(/[\\/]/).pop() ?? dest;
      onNotice(
        res.removed > 0
          ? `已导出无注释版：${name}（移除 ${res.removed} 处注释）`
          : `已导出无注释版：${name}（原件没有可移除的注释）`
      );
    } catch (e) {
      onNotice(`导出失败：${String(e)}`);
    } finally {
      setExportBusy(false);
    }
  }, [doc.path, doc.name, exportBusy, flushSave, onNotice]);

  /* ---------- 全页尺寸 ---------- */
  useEffect(() => {
    const d = docRef.current;
    if (!d || numPages === 0) return;
    let alive = true;
    setSizesReady(false);
    setSizesDone(0);
    loadBaseSizes(d, numPages, (done) => {
      if (alive) setSizesDone(done);
    })
      .then((m) => {
        if (!alive) return;
        setSizes(m);
        setSizesReady(true);
      })
      .catch(() => {
        if (alive) setSizesReady(true);
      });
    return () => {
      alive = false;
    };
  }, [numPages]);

  /* ---------- 目录 ---------- */
  useEffect(() => {
    const d = docRef.current;
    if (!d || numPages === 0) return;
    let alive = true;
    setOutlineLoading(true);
    loadOutline(d)
      .then((o) => alive && setOutline(o))
      .catch(() => alive && setOutline([]))
      .finally(() => alive && setOutlineLoading(false));
    return () => {
      alive = false;
    };
  }, [numPages]);

  /* ---------- 内容区宽度 ---------- */
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  /* ---------- 注释交互 ---------- */
  useEffect(() => {
    const host = contentRef.current;
    if (!host) return;

    type Drag = {
      kind: AnnotKind;
      wrap: HTMLElement;
      page: number;
      startPdf: [number, number];
      startCss: [number, number];
      pdfPoints: [number, number][];
      cssPoints: [number, number][];
      preview: SVGSVGElement;
      moved: boolean;
    };
    let drag: Drag | null = null;

    const findWrap = (target: EventTarget | null) => {
      const node = target instanceof Element ? target : null;
      return node?.closest<HTMLElement>(".page-wrap") ?? null;
    };

    const previewFor = (wrap: HTMLElement) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "draw-preview");
      svg.setAttribute("width", String(wrap.clientWidth));
      svg.setAttribute("height", String(wrap.clientHeight));
      svg.setAttribute(
        "viewBox",
        `0 0 ${wrap.clientWidth} ${wrap.clientHeight}`
      );
      wrap.appendChild(svg);
      return svg;
    };

    const drawPreview = (d: Drag, cx: number, cy: number) => {
      const svg = d.preview;
      svg.replaceChildren();
      const mk = (tag: string, attrs: Record<string, string | number>) => {
        const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
        svg.appendChild(node);
        return node;
      };
      if (d.kind === "ink") {
        const pts = [...d.cssPoints, [cx, cy] as [number, number]];
        mk("path", {
          d: pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" "),
          fill: "none",
          stroke: colorRef.current,
          "stroke-width": 2.4,
          "stroke-linecap": "round",
          "stroke-dasharray": "4 3",
          opacity: 0.8,
        });
      } else {
        const x = Math.min(d.startCss[0], cx);
        const y = Math.min(d.startCss[1], cy);
        const w = Math.abs(cx - d.startCss[0]);
        const h = Math.abs(cy - d.startCss[1]);
        if (d.kind === "circle") {
          mk("ellipse", {
            cx: x + w / 2,
            cy: y + h / 2,
            rx: w / 2,
            ry: h / 2,
            fill: "none",
            stroke: colorRef.current,
            "stroke-width": 2,
            "stroke-dasharray": "4 3",
            opacity: 0.85,
          });
        } else {
          mk("rect", {
            x,
            y,
            width: w,
            height: h,
            rx: 2,
            fill: "none",
            stroke: colorRef.current,
            "stroke-width": 2,
            "stroke-dasharray": "4 3",
            opacity: 0.85,
          });
        }
      }
    };

    const localPoint = (wrap: HTMLElement, e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as [number, number];
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const wrap = findWrap(e.target);
      const meta = wrap ? pageMeta(wrap) : undefined;
      if (!wrap || !meta) return;
      const kind = toolRef.current;
      if (kind === "none") return;

      if (kind === "highlight" || kind === "underline" || kind === "strike") {
        return;
      }

      if (kind === "note" || kind === "pin") {
        e.preventDefault();
        const [lx, ly] = localPoint(wrap, e);
        const p = meta.viewport.convertToPdfPoint(lx, ly);
        const rect: [number, number, number, number] = [
          p[0],
          p[1] - 18,
          p[0] + 18,
          p[1],
        ];
        const hr = host.getBoundingClientRect();
        const x = Math.min(Math.max(8, e.clientX - hr.left), Math.max(8, host.clientWidth - 280));
        const y = Math.min(Math.max(8, e.clientY - hr.top - 8), Math.max(8, host.clientHeight - 168));
        setComposer({ kind, page: meta.page, rect, x, y });
        setDraftText("");
        return;
      }

      e.preventDefault();
      const [lx, ly] = localPoint(wrap, e);
      const p = meta.viewport.convertToPdfPoint(lx, ly);
      try {
        host.setPointerCapture(e.pointerId);
      } catch {
        /* 某些指针类型不支持捕获 */
      }
      drag = {
        kind,
        wrap,
        page: meta.page,
        startPdf: [p[0], p[1]],
        startCss: [lx, ly],
        pdfPoints: [[p[0], p[1]]],
        cssPoints: [[lx, ly]],
        preview: previewFor(wrap),
        moved: false,
      };
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const meta = pageMeta(drag.wrap);
      if (!meta) return;
      e.preventDefault();
      const [cx, cy] = localPoint(drag.wrap, e);
      if (Math.hypot(cx - drag.startCss[0], cy - drag.startCss[1]) > 3) drag.moved = true;
      if (drag.kind === "ink") {
        const last = drag.cssPoints[drag.cssPoints.length - 1];
        if (Math.hypot(cx - last[0], cy - last[1]) >= 2) {
          const p = meta.viewport.convertToPdfPoint(cx, cy);
          drag.pdfPoints.push([p[0], p[1]]);
          drag.cssPoints.push([cx, cy]);
        }
      }
      drawPreview(drag, cx, cy);
    };

    const finish = (e: PointerEvent) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      d.preview.remove();
      try {
        host.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!d.moved) return;
      const meta = pageMeta(d.wrap);
      if (!meta) return;
      const [cx, cy] = localPoint(d.wrap, e);
      const end = meta.viewport.convertToPdfPoint(cx, cy);
      const now = Date.now();
      let next: Annot | null = null;
      if (d.kind === "ink") {
        if (d.pdfPoints.length < 2) return;
        const xs = d.pdfPoints.map((p) => p[0]);
        const ys = d.pdfPoints.map((p) => p[1]);
        next = {
          id: nextAnnotId(),
          page: d.page,
          type: "ink",
          color: colorRef.current,
          rect: [
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs),
            Math.max(...ys),
          ],
          path: d.pdfPoints,
          createdAt: now,
        };
      } else if (d.kind === "square" || d.kind === "circle") {
        const w = Math.abs(cx - d.startCss[0]);
        const h = Math.abs(cy - d.startCss[1]);
        if (w < 4 || h < 4) return;
        next = {
          id: nextAnnotId(),
          page: d.page,
          type: d.kind,
          color: colorRef.current,
          rect: rectFromPoints(d.startPdf, [end[0], end[1]]),
          createdAt: now,
        };
      }
      if (next) {
        setAnnots((prev) => [...prev, next!]);
        setSelectedAnnot(next.id);
      }
    };

    const onUpMarkup = (e: PointerEvent) => {
      const kind = toolRef.current;
      if (kind !== "highlight" && kind !== "underline" && kind !== "strike") return;
      const wrap = findWrap(e.target);
      if (!wrap) return;
      window.setTimeout(() => {
        const meta = pageMeta(wrap);
        const draft = selectionDraft(wrap);
        if (!meta || !draft) return;
        const annot: Annot = {
          id: nextAnnotId(),
          page: meta.page,
          type: kind,
          color: colorRef.current,
          rect: draft.rect,
          quads: draft.quads,
          text: draft.text?.slice(0, 200),
          createdAt: Date.now(),
        };
        setAnnots((prev) => [...prev, annot]);
        setSelectedAnnot(annot.id);
        window.getSelection()?.removeAllRanges();
      }, 0);
    };

    const onUp = (e: PointerEvent) => {
      if (drag) finish(e);
      else onUpMarkup(e);
    };

    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      if (drag) drag.preview.remove();
      drag = null;
    };
  }, []);

  /* ---------- 单页 / 双页渲染 ---------- */
  useEffect(() => {
    if (mode === "continuous") return;
    const d = docRef.current;
    const host = pagesRef.current;
    if (!d || !host || numPages === 0) return;

    const token = ++renderToken.current;
    let cancelled = false;
    const cssScale = computeScale();
    const nums =
      mode === "double" ? [page, page + 1].filter((n) => n <= numPages) : [page];

    const run = async () => {
      host.replaceChildren();
      for (const n of nums) {
        const wrap = document.createElement("div");
        wrap.className = `page-wrap${night ? " night" : ""}`;
        wrap.dataset.page = String(n);
        host.appendChild(wrap);
        const { viewport } = await renderPageInto(d, n, cssScale, wrap, {
          text: true,
          query: queryRef.current,
          current: hitRef.current === n,
        });
        await renderWidgetLayer(d, n, wrap, viewport);
        if (cancelled || token !== renderToken.current) return;
        paintAnnotationsForWrap(wrap, annotsRef.current, selectedRef.current);
      }
      setScalePct(Math.round((cssScale / PDF_TO_CSS) * 100));

      const anchor = anchorRef.current;
      anchorRef.current = null;
      if (anchor) {
        requestAnimationFrame(() => {
          const sc = scrollerRef.current;
          if (!sc) return;
          sc.scrollLeft = anchor.rx * sc.scrollWidth - anchor.x;
          sc.scrollTop = anchor.ry * sc.scrollHeight - anchor.y;
        });
      }
    };

    run().catch((e: unknown) => {
      if (!cancelled) setError(String((e as Error)?.message ?? e));
    });

    return () => {
      cancelled = true;
    };
  }, [mode, page, zoom, avail, sizes, numPages, night, computeScale]);

  /* ---------- 连续模式比例 ---------- */
  useEffect(() => {
    if (mode !== "continuous" || numPages === 0) return;
    setScalePct(Math.round((computeScale() / PDF_TO_CSS) * 100));
  }, [mode, zoom, avail, sizes, numPages, page, computeScale]);

  /* ---------- 高亮重绘（单页/双页） ---------- */
  useEffect(() => {
    if (mode === "continuous") return;
    const host = pagesRef.current;
    if (!host) return;
    host.querySelectorAll<HTMLElement>(".page-wrap").forEach((el) => {
      paintHighlights(el, query, Number(el.dataset.page) === hitPage);
    });
  }, [query, hitPage, mode, page]);

  /* ---------- 朗读句高亮 ---------- */
  useEffect(() => {
    const host = contentRef.current;
    const clear = () => {
      host?.querySelectorAll(".tts-focus").forEach((el) => el.remove());
    };
    clear();
    if (!ttsOpen || ttsStatus === "idle" || ttsStatus === "done" || ttsStatus === "error" || !ttsSegments.length) return;
    const seg = ttsSegments[ttsIndex];
    if (!seg) return;
    let cancelled = false;
    let timer = 0;
    const paint = (tries = 0) => {
      if (cancelled) return;
      const wrap = host?.querySelector<HTMLElement>(`.page-wrap[data-page="${ttsPage}"]`);
      const meta = wrap ? pageMeta(wrap) : undefined;
      if (!wrap || !meta) {
        if (tries < 8) timer = window.setTimeout(() => paint(tries + 1), 180);
        return;
      }
      clear();
      const layer = document.createElement("div");
      layer.className = "tts-focus";
      for (const rect of seg.rects) {
        const r = cssRect(meta.viewport, rect);
        if (r.w < 0.5 || r.h < 0.5) continue;
        const line = document.createElement("span");
        line.className = "tts-line";
        line.style.left = `${r.x}px`;
        line.style.top = `${r.y}px`;
        line.style.width = `${r.w}px`;
        line.style.height = `${r.h}px`;
        layer.appendChild(line);
      }
      if (layer.childElementCount) wrap.appendChild(layer);
    };
    paint();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      clear();
    };
  }, [ttsOpen, ttsStatus, ttsPage, ttsIndex, ttsSegments, mode, page]);

  /* 注释覆盖层随页面/缩放/选中重绘 */
  useEffect(() => {
    repaintAnnotations(contentRef.current, annots, selectedAnnot);
  }, [annots, selectedAnnot, mode, page, zoom, avail, night]);

  /* ---------- 搜索 ---------- */
  useEffect(() => {
    if (numPages === 0) return;
    searchToken.current && (searchToken.current.cancel = true);
    const token = { cancel: false };
    searchToken.current = token;

    const q = query.trim();
    if (!q) {
      setHits([]);
      setHitIndex(-1);
      setSearching(false);
      setSearched(0);
      return;
    }

    setSearching(true);
    setSearched(0);
    const timer = window.setTimeout(() => {
      const d = docRef.current;
      if (!d) return;
      searchDocument(d, numPages, q, token, textCache.current, (done) => {
        if (!token.cancel) setSearched(done);
      })
        .then((h) => {
          if (token.cancel) return;
          setHits(h);
          setHitIndex(h.length ? 0 : -1);
          setSearching(false);
        })
        .catch(() => {
          if (!token.cancel) setSearching(false);
        });
    }, 320);

    return () => {
      window.clearTimeout(timer);
      token.cancel = true;
    };
  }, [query, numPages]);

  useEffect(() => {
    setPageText(String(page));
  }, [page]);

  /* ---------- 进度 ---------- */
  useEffect(() => {
    if (numPages > 0) onProgress(page, zoom, numPages);
  }, [page, zoom, numPages, onProgress]);

  /* ---------- 导航 ---------- */
  const clampPage = useCallback(
    (n: number) => Math.min(Math.max(1, n), Math.max(1, numPages)),
    [numPages]
  );

  const goTo = useCallback(
    (n: number) => {
      const p = clampPage(n);
      setPage(p);
      if (mode === "continuous") continuousRef.current?.goToPage(p);
    },
    [clampPage, mode]
  );

  const navStep = mode === "double" ? 2 : 1;
  const goPrev = useCallback(() => goTo(page - navStep), [goTo, page, navStep]);
  const goNext = useCallback(() => goTo(page + navStep), [goTo, page, navStep]);

  /* ---------- M8 朗读 ---------- */
  const updateTtsStatus = (s: TtsStatus) => {
    ttsStatusRef.current = s;
    setTtsStatus(s);
  };

  const ensureVoices = async (): Promise<SpeechSynthesisVoice[]> => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
    let list = window.speechSynthesis.getVoices();
    if (!list.length) {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          window.speechSynthesis.removeEventListener("voiceschanged", finish);
          resolve();
        };
        window.speechSynthesis.addEventListener("voiceschanged", finish);
        window.setTimeout(finish, 1200);
      });
      list = window.speechSynthesis.getVoices();
    }
    const all = list;
    const local = all.filter((v) => v.localService);
    list = local.length ? local : all;
    ttsVoicesRef.current = list;
    setTtsVoices(list);
    if (list.length) {
      const picked =
        list.find((v) => v.name === ttsVoiceRef.current) ||
        list.find((v) => v.lang.toLowerCase().startsWith("zh")) ||
        list[0];
      if (picked && picked.name !== ttsVoiceRef.current) {
        ttsVoiceRef.current = picked.name;
        setTtsVoiceName(picked.name);
      }
    }
    return list;
  };

  const loadTtsPage = async (p: number): Promise<TtsSegment[]> => {
    const cached = ttsCacheRef.current.get(p);
    if (cached) return cached;
    const d = docRef.current;
    if (!d) return [];
    const segs = await extractPageSegments(d, p);
    ttsCacheRef.current.set(p, segs);
    return segs;
  };

  const finishTts = (message: string) => {
    ttsRunRef.current++;
    window.speechSynthesis.cancel();
    updateTtsStatus("done");
    setTtsMessage(message);
    ttsIndexRef.current = 0;
    setTtsIndex(0);
    setTtsSegments([]);
  };

  const advanceTts = async (p: number, i: number, run: number) => {
    if (run !== ttsRunRef.current) return;
    const segs = ttsCacheRef.current.get(p) ?? [];
    const total = docRef.current?.numPages ?? numPages;
    if (i + 1 < segs.length) {
      await speakTts(p, i + 1, run);
    } else if (p < total) {
      await speakTts(p + 1, 0, run);
    } else {
      finishTts("已读完最后一页。");
    }
  };

  const speakTts = async (p: number, i: number, run: number) => {
    if (run !== ttsRunRef.current) return;
    const total = docRef.current?.numPages ?? numPages;
    if (p < 1 || p > total) {
      finishTts("没有更多可朗读的内容。");
      return;
    }
    if (!ttsCacheRef.current.has(p)) updateTtsStatus("loading");
    let segs: TtsSegment[];
    try {
      segs = await loadTtsPage(p);
    } catch {
      if (run !== ttsRunRef.current) return;
      updateTtsStatus("error");
      setTtsMessage("这一页的文字提取失败，换一页试试。");
      return;
    }
    if (run !== ttsRunRef.current) return;
    if (!segs.length) {
      if (p < total) {
        await speakTts(p + 1, 0, run);
      } else {
        finishTts("这一页及之后没有可朗读的文字。");
      }
      return;
    }
    if (i < 0) i = segs.length - 1;
    if (i >= segs.length) i = 0;
    const seg = segs[i];
    ttsPageRef.current = p;
    ttsIndexRef.current = i;
    setTtsPage(p);
    setTtsIndex(i);
    setTtsSegments(segs);
    setTtsMessage("");
    goTo(p);

    const voices = ttsVoicesRef.current;
    const voice =
      voices.find((v) => v.name === ttsVoiceRef.current) ||
      voices.find((v) => v.lang.toLowerCase().startsWith("zh")) ||
      voices[0];
    if (!voice) {
      updateTtsStatus("error");
      setTtsMessage("系统没有可用语音，请先在 Windows 设置里安装中文语音包。");
      return;
    }
    const utter = new SpeechSynthesisUtterance(seg.text);
    utter.voice = voice;
    utter.lang = voice.lang || "zh-CN";
    utter.rate = ttsRateRef.current;
    utter.pitch = 1;
    utter.volume = 1;
    utter.onstart = () => {
      if (run === ttsRunRef.current) updateTtsStatus("speaking");
    };
    utter.onend = () => {
      if (run !== ttsRunRef.current) return;
      void advanceTts(p, i, run);
    };
    utter.onerror = (ev) => {
      if (run !== ttsRunRef.current) return;
      const err = String(ev.error || "");
      if (err === "interrupted" || err === "canceled") return;
      updateTtsStatus("error");
      setTtsMessage(err === "not-allowed" ? "系统拒绝朗读，请检查声音设置。" : "朗读中断，点播放可重试。");
    };
    updateTtsStatus("speaking");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  };

  const startTts = async (p = ttsPageRef.current || clampPage(page), i = 0) => {
    setTtsOpen(true);
    setTtsMessage("");
    const run = ++ttsRunRef.current;
    updateTtsStatus("loading");
    const voices = await ensureVoices();
    if (run !== ttsRunRef.current) return;
    if (!voices.length) {
      updateTtsStatus("error");
      setTtsMessage("系统没有可用语音，请先在 Windows 设置里安装中文语音包。");
      return;
    }
    ttsPageRef.current = p;
    ttsIndexRef.current = i;
    setTtsPage(p);
    setTtsIndex(i);
    await speakTts(p, i, run);
  };

  const stopTts = (close = false) => {
    ttsRunRef.current++;
    window.speechSynthesis.cancel();
    updateTtsStatus("idle");
    setTtsMessage(close ? "" : "已停止。");
    ttsIndexRef.current = 0;
    setTtsIndex(0);
    setTtsSegments([]);
    const p = clampPage(page);
    ttsPageRef.current = p;
    setTtsPage(p);
    if (close) setTtsOpen(false);
  };

  const toggleTts = () => {
    if (ttsOpen) {
      stopTts(true);
      return;
    }
    setTtsOpen(true);
    setTtsMessage("");
    updateTtsStatus("idle");
    setTtsSegments([]);
    const p = clampPage(page);
    ttsPageRef.current = p;
    ttsIndexRef.current = 0;
    setTtsPage(p);
    setTtsIndex(0);
    void ensureVoices();
  };
  ttsToggleRef.current = toggleTts;

  const ttsPlayPause = () => {
    if (ttsStatusRef.current === "speaking") {
      window.speechSynthesis.pause();
      updateTtsStatus("paused");
      return;
    }
    if (ttsStatusRef.current === "paused") {
      window.speechSynthesis.resume();
      updateTtsStatus("speaking");
      return;
    }
    void startTts(clampPage(page), 0);
  };

  const ttsStep = async (dir: 1 | -1) => {
    if (ttsStatusRef.current === "idle" || ttsStatusRef.current === "error" || ttsStatusRef.current === "done") {
      await startTts(clampPage(page), 0);
      return;
    }
    if (ttsStatusRef.current === "loading") return;
    const run = ++ttsRunRef.current;
    window.speechSynthesis.cancel();
    updateTtsStatus("loading");
    let p = ttsPageRef.current;
    let i = ttsIndexRef.current + dir;
    let segs = ttsCacheRef.current.get(p) ?? [];
    if (i < 0) {
      if (p > 1) {
        p -= 1;
        try {
          segs = await loadTtsPage(p);
        } catch {
          updateTtsStatus("error");
          setTtsMessage("上一页文字提取失败。");
          return;
        }
        i = segs.length - 1;
      } else {
        i = 0;
      }
    }
    if (i >= segs.length) {
      if (p < (docRef.current?.numPages ?? numPages)) {
        p += 1;
        i = 0;
      } else {
        finishTts("已读完最后一页。");
        return;
      }
    }
    await speakTts(p, i, run);
  };

  const setTtsVoice = (name: string) => {
    ttsVoiceRef.current = name;
    setTtsVoiceName(name);
    saveTtsPrefs({ voiceName: name, rate: ttsRateRef.current });
    if (ttsStatusRef.current === "speaking" || ttsStatusRef.current === "paused") {
      const run = ++ttsRunRef.current;
      window.speechSynthesis.cancel();
      void speakTts(ttsPageRef.current, ttsIndexRef.current, run);
    }
  };

  const changeTtsRate = (rate: number) => {
    const v = Math.min(1.6, Math.max(0.7, rate));
    ttsRateRef.current = v;
    setTtsRate(v);
    saveTtsPrefs({ voiceName: ttsVoiceRef.current, rate: v });
  };


  const focusAnnot = useCallback(
    (a: Annot, tries = 0) => {
      const host = contentRef.current;
      const wrap = host?.querySelector<HTMLElement>(`.page-wrap[data-page="${a.page}"]`);
      const meta = wrap ? pageMeta(wrap) : undefined;
      if (!wrap || !meta) {
        if (tries < 6) window.setTimeout(() => focusAnnot(a, tries + 1), 240);
        return;
      }
      const box = cssRect(meta.viewport, a.rect);
      const sc = wrap.closest(".scroller") as HTMLElement | null;
      if (!sc) return;
      const wr = wrap.getBoundingClientRect();
      const sr = sc.getBoundingClientRect();
      const targetY = wr.top - sr.top + box.y + box.h / 2;
      sc.scrollTop += targetY - sc.clientHeight / 2;
      if (box.x < 12 || box.x + box.w > sc.clientWidth - 12) {
        const targetX = wr.left - sr.left + box.x + box.w / 2;
        sc.scrollLeft += targetX - sc.clientWidth / 2;
      }
    },
    []
  );

  const pickAnnot = useCallback(
    (a: Annot) => {
      setSelectedAnnot(a.id);
      goTo(a.page);
      window.setTimeout(() => focusAnnot(a), 260);
    },
    [goTo, focusAnnot]
  );

  const deleteAnnot = useCallback((id: string) => {
    setAnnots((prev) => prev.filter((a) => a.id !== id));
    setSelectedAnnot((cur) => (cur === id ? null : cur));
  }, []);

  const recolorAnnot = useCallback((id: string, next: string) => {
    setAnnots((prev) => prev.map((a) => (a.id === id ? { ...a, color: next } : a)));
  }, []);

  const addNoteFromComposer = useCallback(() => {
    if (!composer) return;
    const text = draftText.trim();
    if (!text) {
      setComposer(null);
      return;
    }
    const annot: Annot = {
      id: nextAnnotId(),
      page: composer.page,
      type: composer.kind,
      color: colorRef.current,
      rect: composer.rect,
      text,
      createdAt: Date.now(),
    };
    setAnnots((prev) => [...prev, annot]);
    setSelectedAnnot(annot.id);
    setComposer(null);
    setDraftText("");
  }, [composer, draftText]);

  const autoJumpedQuery = useRef("");
  useEffect(() => {
    if (!query.trim() || hits.length === 0) return;
    if (autoJumpedQuery.current === query) return;
    autoJumpedQuery.current = query;
    goTo(hits[0].page);
  }, [hits, query, goTo]);

  /* ---------- 缩放 ---------- */
  const captureAnchor = useCallback((localX: number, localY: number) => {
    const sc = scrollerRef.current;
    if (!sc) return;
    anchorRef.current = {
      rx: (sc.scrollLeft + localX) / Math.max(1, sc.scrollWidth),
      ry: (sc.scrollTop + localY) / Math.max(1, sc.scrollHeight),
      x: localX,
      y: localY,
    };
  }, []);

  const zoomTo = useCallback(
    (next: number, localX?: number, localY?: number) => {
      if (mode !== "continuous") {
        const sc = scrollerRef.current;
        captureAnchor(localX ?? (sc?.clientWidth ?? 0) / 2, localY ?? (sc?.clientHeight ?? 0) / 2);
      }
      setZoom(Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))));
    },
    [captureAnchor, mode]
  );

  const zoomIn = useCallback(() => {
    zoomTo((zoom === "fit" ? scalePct : zoom) * 1.25);
  }, [zoom, scalePct, zoomTo]);

  const zoomOut = useCallback(() => {
    zoomTo((zoom === "fit" ? scalePct : zoom) * 0.8);
  }, [zoom, scalePct, zoomTo]);

  const fit = useCallback(() => {
    if (mode !== "continuous") {
      const sc = scrollerRef.current;
      const atTop = (sc?.scrollTop ?? 0) < 24;
      captureAnchor((sc?.clientWidth ?? 0) / 2, atTop ? 0 : (sc?.clientHeight ?? 0) / 2);
    }
    setZoom("fit");
  }, [captureAnchor, mode]);

  const actual = useCallback(() => zoomTo(100), [zoomTo]);

  /* ---------- 光标锚点缩放 ---------- */
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const base = zoom === "fit" ? scalePct : zoom;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomTo(base * factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, scalePct, zoomTo]);

  /* ---------- 快捷键 ---------- */
  const togglePanel = useCallback((k: PanelKind) => {
    setPanel((p) => (p === k ? null : k));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

      if (printOpen) {
        if (e.key === "Escape" && !printBusy) {
          e.preventDefault();
          setPrintOpen(false);
        }
        return;
      }
      if (e.key === "F9") {
        e.preventDefault();
        togglePages();
        return;
      }
      if (e.key === "F10") {
        e.preventDefault();
        toggleForms();
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        toggleTools();
        return;
      }
      if (toolsOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setToolsOpen(false);
        }
        return;
      }
      if (pmOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setPmOpen(false);
        }
        return;
      }
      if (formsOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setFormsOpen(false);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flushSave();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setPanel("search");
        window.setTimeout(() => searchInput.current?.focus(), 30);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        togglePrint();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        void exportClean();
        return;
      }
      if (typing) return;

      const key = e.key;
      if (e.altKey && !e.ctrlKey && !e.metaKey && key.toLowerCase() === "r") {
        e.preventDefault();
        ttsToggleRef.current();
        return;
      }
      const toolKey: Record<string, AnnotKind> = {
        h: "highlight",
        u: "underline",
        s: "strike",
        k: "strike",
        r: "square",
        o: "circle",
        p: "ink",
        n: "note",
        i: "pin",
      };
      if (!e.ctrlKey && !e.metaKey && !e.altKey && toolKey[key.toLowerCase()]) {
        e.preventDefault();
        const next = toolKey[key.toLowerCase()];
        setTool((cur) => (cur === next ? "none" : next));
        return;
      }
      if (key === "F6") {
        e.preventDefault();
        togglePanel("outline");
      } else if (key === "F7") {
        e.preventDefault();
        togglePanel("thumbs");
      } else if (key === "F8") {
        e.preventDefault();
        togglePanel("annots");
      } else if (key === "ArrowRight" || key === "PageDown") {
        e.preventDefault();
        goNext();
      } else if (key === "ArrowLeft" || key === "PageUp") {
        e.preventDefault();
        goPrev();
      } else if (key === "Home") {
        e.preventDefault();
        goTo(1);
      } else if (key === "End") {
        e.preventDefault();
        goTo(numPages);
      } else if ((e.ctrlKey || e.metaKey) && key === "1") {
        e.preventDefault();
        fit();
      } else if ((e.ctrlKey || e.metaKey) && key === "2") {
        e.preventDefault();
        setMode((m) => (m === "single" ? "double" : "single"));
      } else if ((e.ctrlKey || e.metaKey) && key === "3") {
        e.preventDefault();
        setMode("continuous");
      } else if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "d") {
        e.preventDefault();
        setNight((n) => !n);
      } else if ((e.ctrlKey || e.metaKey) && (key === "=" || key === "+")) {
        e.preventDefault();
        zoomIn();
      } else if ((e.ctrlKey || e.metaKey) && key === "-") {
        e.preventDefault();
        zoomOut();
      } else if ((e.ctrlKey || e.metaKey) && key === "0") {
        e.preventDefault();
        actual();
      } else if (key === "Escape" && ttsOpen) {
        e.preventDefault();
        ttsToggleRef.current();
      } else if (key === "Escape") {
        e.preventDefault();
        if (composer) setComposer(null);
        else if (tool !== "none") setTool("none");
        else if (panel) setPanel(null);
        else requestClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev, goTo, numPages, fit, zoomIn, zoomOut, actual, requestClose, panel, togglePanel, composer, tool, flushSave, pmOpen, togglePages, formsOpen, toggleForms, printOpen, printBusy, togglePrint, exportClean, toolsOpen, toggleTools, ttsOpen]);

  useEffect(() => {
    return () => clearPrintDocument();
  }, []);

  useEffect(() => {
    return () => {
      ttsRunRef.current++;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (panel === "search") window.setTimeout(() => searchInput.current?.focus(), 30);
  }, [panel]);

  const commitPageText = () => {
    const n = parseInt(pageText, 10);
    if (Number.isFinite(n)) goTo(n);
    else setPageText(String(page));
  };

  const revealHit = useCallback(
    (hit: SearchHit) => {
      const q = query.trim().toLowerCase();
      if (!q) return;
      let tries = 0;
      const attempt = () => {
        const host = contentRef.current;
        if (!host) return;
        const wrap = host.querySelector<HTMLElement>(`.page-wrap[data-page="${hit.page}"]`);
        if (!wrap) {
          if (tries++ < 5) window.setTimeout(attempt, 260);
          return;
        }
        const spans = Array.from(wrap.querySelectorAll<HTMLElement>(".textLayer span")).filter((s) =>
          (s.textContent ?? "").toLowerCase().includes(q)
        );
        if (!spans.length) {
          if (tries++ < 5) window.setTimeout(attempt, 260);
          return;
        }
        const span = spans[Math.min(hit.order, spans.length - 1)];
        const sc = wrap.closest(".scroller") as HTMLElement | null;
        if (sc) {
          const r = span.getBoundingClientRect();
          const sr = sc.getBoundingClientRect();
          sc.scrollTop += r.top - sr.top - sc.clientHeight / 2 + r.height / 2;
          sc.scrollLeft += r.left - sr.left - sc.clientWidth / 2 + r.width / 2;
        } else {
          span.scrollIntoView({ block: "center" });
        }
        span.classList.add("hl-focus");
        window.setTimeout(() => span.classList.remove("hl-focus"), 1800);
      };
      window.setTimeout(attempt, 160);
    },
    [query]
  );

  const nextHit = () => {
    if (!hits.length) return;
    const next = (hitIndex + 1) % hits.length;
    setHitIndex(next);
    goTo(hits[next].page);
    revealHit(hits[next]);
  };

  const pickHit = (i: number) => {
    setHitIndex(i);
    goTo(hits[i].page);
    revealHit(hits[i]);
  };

  const contentWidth = Math.max(120, (avail || 900) - 48);
  void contentWidth;

  const annotMode =
    tool === "square" || tool === "circle" || tool === "ink"
      ? " annot-shape"
      : tool === "note" || tool === "pin"
        ? " annot-note"
        : tool !== "none"
          ? " annot-select"
          : "";

  return (
    <div className="viewer">
      <TopBar
        name={doc.name}
        zoomPct={scalePct}
        mode={mode}
        night={night}
        panel={panel}
        tool={tool}
        saveState={saveState}
        pagesOpen={pmOpen}
        toolsOpen={toolsOpen}
        formsOpen={formsOpen}
        printOpen={printOpen}
        formCount={formFieldCount}
        ttsOpen={ttsOpen}
        exportBusy={exportBusy}
        onOpen={requestOpen}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={fit}
        onMode={setMode}
        onNight={() => setNight((n) => !n)}
        onPanel={togglePanel}
        onTool={setTool}
        onPages={togglePages}
        onTools={toggleTools}
        onForms={toggleForms}
        onPrint={togglePrint}
        onExport={() => void exportClean()}
        onTts={toggleTts}
        onClose={requestClose}
      />

      <div className="viewer-body">
        {panel && docRef.current && (
          <Sidebar
            kind={panel}
            doc={docRef.current}
            numPages={numPages}
            currentPage={page}
            outline={outline}
            outlineLoading={outlineLoading}
            query={query}
            onQuery={setQuery}
            hits={hits}
            hitIndex={hitIndex}
            searching={searching}
            searched={searched}
            annots={annots}
            annotsLoading={annotsLoading}
            selectedAnnot={selectedAnnot}
            onPickHit={pickHit}
            onJump={goTo}
            onPickAnnot={pickAnnot}
            onDeleteAnnot={deleteAnnot}
            onRecolorAnnot={recolorAnnot}
            onClose={() => setPanel(null)}
            inputRef={searchInput}
            onEnter={nextHit}
            onOpenThumbs={() => setPanel("thumbs")}
          />
        )}

        <div className={`content${annotMode}`} ref={contentRef}>
          {error ? (
            <div className="viewer-error">
              这份 PDF 打不开：{error}
              <br />
              文件可能已损坏，或使用了暂不支持的加密方式。
            </div>
          ) : mode === "continuous" && docRef.current ? (
            <Continuous
              ref={continuousRef}
              doc={docRef.current}
              numPages={numPages}
              scale={computeScale()}
              sizes={sizes}
              initialPage={page}
              night={night}
              query={query}
              currentHitPage={hitPage}
              annots={annots}
              selectedAnnot={selectedAnnot}
              onVisiblePage={(n) => setPage(n)}
            />
          ) : (
            <div className="scroller" ref={scrollerRef}>
              <div className="pages" ref={pagesRef} />
            </div>
          )}

          {loading && (
            <div className="page-loading">
              <div className="loading-inner">
                <div className="spinner" />
                <span>正在解析 PDF…</span>
              </div>
            </div>
          )}

          {!loading && !error && mode === "continuous" && !sizesReady && numPages > 0 && (
            <div className="layout-hint">
              排版中 {sizesDone}/{numPages} 页
            </div>
          )}

          {!loading && !error && (
            <div className="pagebar glass">
              <button className="iconbtn" onClick={goPrev} disabled={page <= 1} aria-label="上一页">
                <IconChevronLeft />
              </button>
              <div className="pageno">
                <input
                  value={pageText}
                  onChange={(e) => setPageText(e.target.value.replace(/[^\d]/g, ""))}
                  onBlur={commitPageText}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitPageText();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  aria-label="页码"
                />
                <span>/ {numPages}</span>
              </div>
              <button
                className="iconbtn"
                onClick={goNext}
                disabled={page >= numPages}
                aria-label="下一页"
              >
                <IconChevronRight />
              </button>
              <button
                className="zoomchip"
                onClick={actual}
                title="点击回到 100%（Ctrl+0）"
                style={{ border: 0, cursor: "pointer" }}
              >
                {scalePct}%
              </button>
            </div>
          )}

          {tool !== "none" && (
            <div className="annot-bar glass">
              <span className="annot-bar-label">{ANNOT_LABEL[tool]}</span>
              {ANNOT_COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-dot${color === c ? " on" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`颜色 ${c}`}
                />
              ))}
              <button className="annot-done" onClick={() => setTool("none")}>
                完成
              </button>
            </div>
          )}

          {composer && (
            <div
              className="note-composer"
              style={{ left: composer.x, top: composer.y }}
              role="dialog"
              aria-label="填写便签"
            >
              <textarea
                autoFocus
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder="写下备注，保存后会写进 PDF…"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setComposer(null);
                  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    addNoteFromComposer();
                  }
                }}
              />
              <div className="note-actions">
                <button className="btn btn-ghost" onClick={() => setComposer(null)}>
                  取消
                </button>
                <button className="btn btn-primary" onClick={addNoteFromComposer}>
                  保存
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {pmOpen && docRef.current && (
        <PageManager
          doc={docRef.current}
          numPages={numPages}
          currentPage={page}
          docName={doc.name}
          path={doc.path}
          busy={pageBusy}
          onClose={() => setPmOpen(false)}
          onNotice={onNotice}
          onApply={applyPages}
          onExtract={extractSelected}
        />
      )}

      {toolsOpen && docRef.current && (
        <ToolkitPanel
          doc={docRef.current}
          numPages={numPages}
          currentPage={page}
          docName={doc.name}
          docPath={doc.path}
          onClose={() => setToolsOpen(false)}
          onNotice={onNotice}
          beforeRun={flushSave}
        />
      )}

      {formsOpen && docRef.current && (
        <FormPanel
          doc={docRef.current}
          fields={formWidgets}
          busy={formBusy}
          onClose={() => setFormsOpen(false)}
          onGoPage={goTo}
          onSave={saveFormsNow}
          onFlatten={flattenForms}
        />
      )}

      {printOpen && (
        <PrintPanel
          total={numPages}
          current={page}
          busy={printBusy}
          busyText={printText || "正在准备打印…"}
          onClose={() => setPrintOpen(false)}
          onPrint={runPrint}
        />
      )}

      <TtsBar
        open={ttsOpen}
        status={ttsStatus}
        page={ttsPage}
        totalPages={numPages}
        segment={ttsIndex}
        segmentCount={ttsSegments.length}
        text={ttsSegments[ttsIndex]?.text ?? ""}
        message={ttsMessage}
        voices={ttsVoices}
        voiceName={ttsVoiceName}
        rate={ttsRate}
        onPlayPause={ttsPlayPause}
        onStop={() => stopTts(false)}
        onPrev={() => void ttsStep(-1)}
        onNext={() => void ttsStep(1)}
        onVoice={setTtsVoice}
        onRate={changeTtsRate}
        onClose={() => stopTts(true)}
      />
    </div>
  );
}
