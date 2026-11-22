export type RecentItem = {
  path: string;
  name: string;
  size: number;
  pages: number;
  lastPage: number;
  zoom: number | "fit";
  cover?: string;
  updatedAt: number;
};

const KEY = "voluma.recents.v1";
const MAX = 8;

export function loadRecents(): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentItem[];
    if (!Array.isArray(arr)) return [];
    return arr.filter((r) => r && typeof r.path === "string").slice(0, MAX);
  } catch {
    return [];
  }
}

export function persistRecents(items: RecentItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    /* localStorage 满时静默失败，最近列表不是关键数据 */
  }
}

export function upsertRecent(items: RecentItem[], next: RecentItem): RecentItem[] {
  const rest = items.filter((r) => r.path !== next.path);
  return [next, ...rest].slice(0, MAX);
}

export function patchRecent(
  items: RecentItem[],
  path: string,
  patch: Partial<RecentItem>
): RecentItem[] {
  return items.map((r) =>
    r.path === path ? { ...r, ...patch, updatedAt: Date.now() } : r
  );
}

export function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "刚刚";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)} 天前`;
  const date = new Date(ts);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
