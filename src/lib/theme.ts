export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "voluma.theme.v1";

function readMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* localStorage 不可用时跟随系统 */
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let mode: ThemeMode = readMode();
let snapshot: { mode: ThemeMode; resolved: ResolvedTheme } = {
  mode,
  resolved: mode === "system" ? systemTheme() : mode,
};

const listeners = new Set<() => void>();
let media: MediaQueryList | null = null;
let started = false;

function apply() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = snapshot.resolved;
  document.documentElement.style.colorScheme = snapshot.resolved;
  document.documentElement.dataset.themeMode = snapshot.mode;
}

function emit() {
  for (const fn of listeners) fn();
}

function refresh() {
  snapshot = {
    mode,
    resolved: mode === "system" ? systemTheme() : mode,
  };
  apply();
  emit();
}

export function initTheme(): void {
  if (typeof window === "undefined") return;
  apply();
  if (started) return;
  started = true;
  media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (mode === "system") refresh();
  };
  if (media.addEventListener) media.addEventListener("change", onSystemChange);
  else media.addListener(onSystemChange);
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getThemeSnapshot() {
  return snapshot;
}

export function setThemeMode(next: ThemeMode): void {
  mode = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* 写在内存里也能用，只是下次不记得 */
  }
  refresh();
}

export function themeLabel(modeValue: ThemeMode): string {
  if (modeValue === "light") return "浅色";
  if (modeValue === "dark") return "深色";
  return "跟随系统";
}

export const THEME_OPTIONS: { mode: ThemeMode; label: string; hint: string }[] = [
  { mode: "system", label: "跟随系统", hint: "随 Windows 深浅色自动切换" },
  { mode: "light", label: "浅色", hint: "暖白纸感，白天更清爽" },
  { mode: "dark", label: "深色", hint: "暗色界面，PDF 纸面不变" },
];
