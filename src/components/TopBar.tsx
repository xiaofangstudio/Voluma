import React from "react";
import {
  BrandMark,
  IconAnnotList,
  IconClose,
  IconContinuous,
  IconDouble,
  IconEllipse,
  IconExport,
  IconFitWidth,
  IconForm,
  IconHighlight,
  IconMoon,
  IconNote,
  IconOpen,
  IconOutline,
  IconPages,
  IconPen,
  IconPin,
  IconPrint,
  IconRect,
  IconSearch,
  IconSingle,
  IconSpeaker,
  IconStrike,
  IconThumbs,
  IconToolkit,
  IconUnderline,
  IconZoomIn,
  IconZoomOut,
} from "./Icons";
import type { AnnotKind } from "../lib/annots";
import ThemeMenu from "./ThemeMenu";

export type ViewMode = "continuous" | "single" | "double";
export type PanelKind = "outline" | "thumbs" | "search" | "annots" | null;
export type AnnotTool = AnnotKind | "none";
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "preview";

type Props = {
  name: string;
  zoomPct: number;
  mode: ViewMode;
  night: boolean;
  panel: PanelKind;
  tool: AnnotTool;
  saveState: SaveState;
  pagesOpen: boolean;
  toolsOpen: boolean;
  ttsOpen: boolean;
  formsOpen: boolean;
  printOpen: boolean;
  formCount: number;
  exportBusy: boolean;
  onOpen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onMode: (m: ViewMode) => void;
  onNight: () => void;
  onPanel: (p: PanelKind) => void;
  onTool: (t: AnnotTool) => void;
  onPages: () => void;
  onTools: () => void;
  onTts: () => void;
  onForms: () => void;
  onPrint: () => void;
  onExport: () => void;
  onClose: () => void;
};

const TOOLS: { kind: AnnotKind; label: string; keyHint: string; icon: React.ReactNode }[] = [
  { kind: "highlight", label: "高亮", keyHint: "H", icon: <IconHighlight /> },
  { kind: "underline", label: "下划线", keyHint: "U", icon: <IconUnderline /> },
  { kind: "strike", label: "删除线", keyHint: "S", icon: <IconStrike /> },
  { kind: "square", label: "矩形", keyHint: "R", icon: <IconRect /> },
  { kind: "circle", label: "椭圆", keyHint: "O", icon: <IconEllipse /> },
  { kind: "ink", label: "画笔", keyHint: "P", icon: <IconPen /> },
  { kind: "note", label: "便签", keyHint: "N", icon: <IconNote /> },
  { kind: "pin", label: "图钉", keyHint: "I", icon: <IconPin /> },
];

const SAVE_TEXT: Record<SaveState, string> = {
  idle: "",
  dirty: "未保存",
  saving: "保存中…",
  saved: "已保存",
  error: "保存失败",
  preview: "预览模式",
};

function Tip({ text, keyHint }: { text: string; keyHint?: string }) {
  return (
    <span className="tip">
      {text}
      {keyHint ? <kbd>{keyHint}</kbd> : null}
    </span>
  );
}

export default function TopBar({
  name,
  zoomPct,
  mode,
  night,
  panel,
  tool,
  saveState,
  pagesOpen,
  toolsOpen,
  ttsOpen,
  formsOpen,
  printOpen,
  formCount,
  exportBusy,
  onOpen,
  onZoomIn,
  onZoomOut,
  onFit,
  onMode,
  onNight,
  onPanel,
  onTool,
  onPages,
  onTools,
  onTts,
  onForms,
  onPrint,
  onExport,
  onClose,
}: Props) {
  return (
    <header className="iconbar">
      <BrandMark size={20} className="brand" />
      <div className="docname" title={name}>
        {name}
      </div>
      {saveState !== "idle" && (
        <span className={`save-chip ${saveState}`} title="注释会直接写入 PDF">
          {SAVE_TEXT[saveState]}
        </span>
      )}

      <div className="group" role="group" aria-label="文件">
        <button className="iconbtn" onClick={onOpen} aria-label="打开">
          <IconOpen />
          <Tip text="打开" keyHint="Ctrl+O" />
        </button>
      </div>
      <span className="sep" />

      <div className="group" role="group" aria-label="视图">
        <button className="iconbtn" onClick={onZoomOut} aria-label="缩小">
          <IconZoomOut />
          <Tip text={`缩小 · ${zoomPct}%`} keyHint="Ctrl+-" />
        </button>
        <button className="iconbtn" onClick={onZoomIn} aria-label="放大">
          <IconZoomIn />
          <Tip text={`放大 · ${zoomPct}%`} keyHint="Ctrl+=" />
        </button>
        <button className="iconbtn" onClick={onFit} aria-label="适应宽度">
          <IconFitWidth />
          <Tip text="适应宽度" keyHint="Ctrl+1" />
        </button>
        <span className="sep" />
        <button
          className="iconbtn"
          onClick={() => onMode("continuous")}
          aria-pressed={mode === "continuous"}
          aria-label="连续"
        >
          <IconContinuous />
          <Tip text="连续滚动" keyHint="Ctrl+3" />
        </button>
        <button
          className="iconbtn"
          onClick={() => onMode("single")}
          aria-pressed={mode === "single"}
          aria-label="单页"
        >
          <IconSingle />
          <Tip text="单页" keyHint="Ctrl+2" />
        </button>
        <button
          className="iconbtn"
          onClick={() => onMode("double")}
          aria-pressed={mode === "double"}
          aria-label="双页对开"
        >
          <IconDouble />
          <Tip text="双页对开" keyHint="Ctrl+2" />
        </button>
        <button className="iconbtn" onClick={onNight} aria-pressed={night} aria-label="夜间反转">
          <IconMoon />
          <Tip text="夜间反转" keyHint="Ctrl+D" />
        </button>
      </div>

      <span className="sep" />

      <div className="group" role="group" aria-label="注释">
        {TOOLS.map((t) => (
          <button
            key={t.kind}
            className={`iconbtn${tool === t.kind ? " tool-active" : ""}`}
            onClick={() => onTool(tool === t.kind ? "none" : t.kind)}
            aria-label={t.label}
            aria-pressed={tool === t.kind}
          >
            {t.icon}
            <Tip text={t.label} keyHint={t.keyHint} />
          </button>
        ))}
      </div>

      <span className="sep" />

      <div className="group" role="group" aria-label="导航">
        <button
          className="iconbtn"
          onClick={() => onPanel(panel === "outline" ? null : "outline")}
          aria-pressed={panel === "outline"}
          aria-label="目录"
        >
          <IconOutline />
          <Tip text="目录" keyHint="F6" />
        </button>
        <button
          className="iconbtn"
          onClick={() => onPanel(panel === "thumbs" ? null : "thumbs")}
          aria-pressed={panel === "thumbs"}
          aria-label="缩略图"
        >
          <IconThumbs />
          <Tip text="缩略图" keyHint="F7" />
        </button>
        <button
          className="iconbtn"
          onClick={() => onPanel(panel === "search" ? null : "search")}
          aria-pressed={panel === "search"}
          aria-label="搜索"
        >
          <IconSearch />
          <Tip text="搜索" keyHint="Ctrl+F" />
        </button>
        <button
          className="iconbtn"
          onClick={() => onPanel(panel === "annots" ? null : "annots")}
          aria-pressed={panel === "annots"}
          aria-label="注释列表"
        >
          <IconAnnotList />
          <Tip text="注释列表" keyHint="F8" />
        </button>
      </div>

      <span className="sep" />

      <div className="group" role="group" aria-label="表单">
        <button
          className="iconbtn"
          onClick={onForms}
          aria-pressed={formsOpen}
          aria-label="表单"
          disabled={!formCount}
        >
          <IconForm />
          {formCount > 0 && <span className="form-count">{formCount}</span>}
          <Tip text={formCount ? `表单 · ${formCount} 个字段` : "没有表单字段"} keyHint="F10" />
        </button>
      </div>

      <span className="sep" />

      <div className="group" role="group" aria-label="页面与工具">
        <button
          className="iconbtn"
          onClick={onPages}
          aria-pressed={pagesOpen}
          aria-label="页面管理"
        >
          <IconPages />
          <Tip text="页面管理" keyHint="F9" />
        </button>
        <button
          className="iconbtn"
          onClick={onTools}
          aria-pressed={toolsOpen}
          aria-label="PDF 工具"
        >
          <IconToolkit />
          <Tip text="合并 / 拆分 / 裁切" keyHint="F11" />
        </button>
        <button
          className="iconbtn"
          onClick={onTts}
          aria-pressed={ttsOpen}
          aria-label="朗读"
        >
          <IconSpeaker />
          <Tip text="朗读 · 逐段" keyHint="Alt+R" />
        </button>
      </div>

      <span className="sep" />

      <div className="group" role="group" aria-label="输出">
        <button
          className="iconbtn"
          onClick={onPrint}
          aria-pressed={printOpen}
          aria-label="打印"
        >
          <IconPrint />
          <Tip text="打印" keyHint="Ctrl+P" />
        </button>
        <button
          className="iconbtn"
          onClick={onExport}
          disabled={exportBusy}
          aria-label="导出无注释版"
        >
          <IconExport />
          <Tip text="导出无注释版" keyHint="Ctrl+E" />
        </button>
      </div>

      <span className="sep" />

      <div className="group" role="group" aria-label="主题与关闭">
        <ThemeMenu />
        <button className="iconbtn" onClick={onClose} aria-label="关闭文档">
          <IconClose />
          <Tip text="关闭文档" keyHint="Esc" />
        </button>
      </div>
    </header>
  );
}
