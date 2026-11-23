import React, { useMemo, useState } from "react";
import { IconClose, IconPrint } from "./Icons";
import {
  PRINT_LAYOUT_LABEL,
  parsePageRange,
  type PrintLayout,
} from "../lib/print";

type Props = {
  total: number;
  current: number;
  busy: boolean;
  busyText: string;
  onClose: () => void;
  onPrint: (pages: number[], layout: PrintLayout) => Promise<void>;
};

type RangeMode = "all" | "current" | "custom";

const LAYOUTS: PrintLayout[] = ["fit", "actual", "two", "four"];

export default function PrintPanel({
  total,
  current,
  busy,
  busyText,
  onClose,
  onPrint,
}: Props) {
  const [mode, setMode] = useState<RangeMode>("all");
  const [custom, setCustom] = useState("");
  const [layout, setLayout] = useState<PrintLayout>("fit");

  const parsed = useMemo(() => {
    if (mode === "all") return { pages: Array.from({ length: total }, (_, i) => i + 1), error: null };
    if (mode === "current") return { pages: [Math.min(Math.max(1, current), total)], error: null };
    return parsePageRange(custom, total, current);
  }, [mode, custom, total, current]);

  const count = parsed.pages.length;
  const sheets =
    layout === "two" ? Math.ceil(count / 2) : layout === "four" ? Math.ceil(count / 4) : count;

  return (
    <div
      className="form-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <section
        className="form-panel glass print-panel"
        role="dialog"
        aria-modal="true"
        aria-label="打印"
      >
        <header className="form-head">
          <div>
            <h2>
              <IconPrint className="form-title-icon" /> 打印
            </h2>
            <div className="form-sub">
              共 {total} 页 · 将打开系统打印对话框
            </div>
          </div>
          <button className="iconbtn" onClick={onClose} disabled={busy} aria-label="关闭打印面板">
            <IconClose />
          </button>
        </header>

        <div className="print-body">
          <div className="print-block">
            <div className="print-label">页码范围</div>
            <div className="print-seg" role="radiogroup" aria-label="页码范围">
              <button
                className={mode === "all" ? "on" : ""}
                onClick={() => setMode("all")}
                role="radio"
                aria-checked={mode === "all"}
              >
                全部
              </button>
              <button
                className={mode === "current" ? "on" : ""}
                onClick={() => setMode("current")}
                role="radio"
                aria-checked={mode === "current"}
              >
                当前页
              </button>
              <button
                className={mode === "custom" ? "on" : ""}
                onClick={() => setMode("custom")}
                role="radio"
                aria-checked={mode === "custom"}
              >
                自定义
              </button>
            </div>
            {mode === "custom" && (
              <input
                className="print-range"
                value={custom}
                autoFocus
                spellCheck={false}
                placeholder={`例如 1-3,${Math.min(current, total)}，留空为当前页`}
                onChange={(e) => setCustom(e.target.value)}
              />
            )}
            <div className={parsed.error ? "print-note warn" : "print-note"}>
              {parsed.error ? parsed.error : `将打印 ${count} 页`}
            </div>
          </div>

          <div className="print-block">
            <div className="print-label">缩放与版式</div>
            <div className="print-grid">
              {LAYOUTS.map((key) => (
                <button
                  key={key}
                  className={`print-layout${layout === key ? " on" : ""}`}
                  onClick={() => setLayout(key)}
                  aria-pressed={layout === key}
                >
                  <span className={`print-swatch ${key}`} aria-hidden="true">
                    {(key === "two" || key === "four") && (
                      <span className="print-swatch-cells">
                        {Array.from({ length: key === "two" ? 2 : 4 }, (_, i) => (
                          <i key={i} />
                        ))}
                      </span>
                    )}
                  </span>
                  <span>{PRINT_LAYOUT_LABEL[key]}</span>
                </button>
              ))}
            </div>
            <div className="print-note">
              {layout === "two" || layout === "four"
                ? `约 ${sheets} 张纸 · 纸张与双面在系统对话框里选`
                : "纸张、方向、双面与份数在系统对话框里选"}
            </div>
          </div>

          <div className="print-tip">
            打印使用页面当前外观：已有注释（高亮、便签等）与表单填写值会一并输出。
          </div>
        </div>

        <footer className="form-foot">
          <span className="form-hint">
            {busy ? busyText : layout === "actual" ? "按 PDF 原始尺寸输出，可能跨纸" : "按纸张大小缩放输出"}
          </span>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void onPrint(parsed.pages, layout)}
            disabled={busy || !!parsed.error || count === 0}
          >
            <IconPrint /> 打印
          </button>
        </footer>
      </section>
    </div>
  );
}
