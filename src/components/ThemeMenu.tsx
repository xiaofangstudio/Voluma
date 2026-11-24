import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getThemeSnapshot, setThemeMode, subscribeTheme, themeLabel, THEME_OPTIONS } from "../lib/theme";
import { IconCheck, IconTheme } from "./Icons";

type Props = {
  variant?: "icon" | "chip";
  placement?: "down" | "up";
};

export default function ThemeMenu({ variant = "icon", placement = "down" }: Props) {
  const snap = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeSnapshot);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const current = themeLabel(snap.mode);

  return (
    <div ref={rootRef} className={`theme-menu ${variant} ${placement}`}>
      <button
        className={variant === "chip" ? "theme-chip" : "iconbtn"}
        aria-label={`界面主题：${current}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <IconTheme />
        {variant === "chip" && <span>{current}</span>}
        {variant === "icon" && (
          <span className="tip">
            {`界面主题 · ${current}`}
          </span>
        )}
      </button>

      {open && (
        <div className="theme-pop" role="menu" aria-label="界面主题">
          <div className="theme-pop-head">
            <strong>界面主题</strong>
            <small>只改界面；PDF 页面仍按原色显示</small>
          </div>
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              className={`theme-opt${snap.mode === opt.mode ? " active" : ""}`}
              role="menuitemradio"
              aria-checked={snap.mode === opt.mode}
              onClick={() => {
                setThemeMode(opt.mode);
                setOpen(false);
              }}
            >
              <span className="theme-opt-ico">{snap.mode === opt.mode && <IconCheck />}</span>
              <span>
                <strong>{opt.label}</strong>
                <small>{opt.hint}</small>
              </span>
            </button>
          ))}
          <div className="theme-pop-foot">当前：{current}</div>
        </div>
      )}
    </div>
  );
}
