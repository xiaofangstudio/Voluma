import React, { useCallback, useEffect, useRef, useState } from "react";
import Splash from "./components/Splash";
import Welcome from "./components/Welcome";
import Viewer, { type DocHandle } from "./components/Viewer";
import { loadRecents, persistRecents, upsertRecent, patchRecent, type RecentItem } from "./lib/recents";
import { IS_TAURI, baseName, pickPdf, readDocument } from "./lib/tauri";

type Phase = "splash" | "welcome" | "viewer";

export default function App() {
  const [phase, setPhase] = useState<Phase>("splash");
  const [splashFading, setSplashFading] = useState(false);
  const [splashMounted, setSplashMounted] = useState(true);
  const [recents, setRecents] = useState<RecentItem[]>(() => (IS_TAURI ? loadRecents() : []));
  const [doc, setDoc] = useState<DocHandle | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recentsRef = useRef(recents);
  recentsRef.current = recents;

  useEffect(() => {
    const t1 = window.setTimeout(() => setSplashFading(true), 650);
    const t2 = window.setTimeout(() => {
      setPhase("welcome");
      setSplashMounted(false);
    }, 980);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    document.title = phase === "viewer" && doc ? `${doc.name} — Voluma` : "Voluma";
  }, [phase, doc]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  const updateRecents = useCallback((fn: (prev: RecentItem[]) => RecentItem[]) => {
    setRecents((prev) => {
      const next = fn(prev);
      if (IS_TAURI) persistRecents(next);
      return next;
    });
  }, []);

  const openByPath = useCallback(
    async (path: string, seed?: RecentItem) => {
      setBusy(true);
      try {
        const data = await readDocument(path);
        setDoc({
          path,
          name: baseName(path),
          data,
          startPage: seed?.lastPage ?? 1,
          startZoom: seed?.zoom ?? 100,
        });
        setPhase("viewer");
      } catch (e) {
        showToast(`打不开这个文件：${String(e)}`);
        updateRecents((prev) => prev.filter((r) => r.path !== path));
      } finally {
        setBusy(false);
      }
    },
    [showToast, updateRecents]
  );

  const openPicker = useCallback(async () => {
    if (IS_TAURI) {
      try {
        const path = await pickPdf();
        if (path) await openByPath(path);
      } catch (e) {
        showToast(`打开对话框出错：${String(e)}`);
      }
    } else {
      fileInputRef.current?.click();
    }
  }, [openByPath, showToast]);

  const onBrowserFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      setDoc({
        path: `browser:${file.name}`,
        name: baseName(file.name),
        data,
        startPage: 1,
        startZoom: 100,
      });
      setPhase("viewer");
    } catch (err) {
      showToast(`读取文件失败：${String(err)}`);
    }
  };

  const onMeta = useCallback(
    (pages: number, cover: string) => {
      const d = doc;
      if (!d || !IS_TAURI) return;
      updateRecents((prev) => {
        const existing = prev.find((r) => r.path === d.path);
        if (existing) {
          return patchRecent(prev, d.path, { pages, cover: cover || existing.cover, size: d.data.byteLength });
        }
        return upsertRecent(prev, {
          path: d.path,
          name: d.name,
          size: d.data.byteLength,
          pages,
          lastPage: d.startPage,
          zoom: d.startZoom,
          cover: cover || undefined,
          updatedAt: Date.now(),
        });
      });
    },
    [doc, updateRecents]
  );

  const onProgress = useCallback(
    (page: number, zoom: number | "fit", pages: number) => {
      if (!doc || !IS_TAURI || doc.path.startsWith("browser:")) return;
      setRecents((prev) => {
        const target = prev.find((r) => r.path === doc.path);
        if (!target || (target.lastPage === page && target.zoom === zoom && target.pages === pages)) {
          return prev;
        }
        const next = patchRecent(prev, doc.path, { lastPage: page, zoom, pages });
        persistRecents(next);
        return next;
      });
    },
    [doc]
  );

  const closeDoc = useCallback(() => {
    setDoc(null);
    setPhase("welcome");
  }, []);

  const reloadDoc = useCallback(async () => {
    if (!doc) return;
    try {
      const data = await readDocument(doc.path);
      setDoc((prev) => (prev ? { ...prev, data } : prev));
    } catch (e) {
      showToast(`重新读取文件失败：${String(e)}`);
      throw e;
    }
  }, [doc, showToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        if (!busy) openPicker();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPicker, busy]);

  return (
    <>
      {splashMounted && <Splash fading={splashFading} />}

      {phase === "welcome" && (
        <Welcome
          recents={recents}
          onOpenPicker={openPicker}
          onOpenRecent={(item) => openByPath(item.path, item)}
          busy={busy}
        />
      )}

      {phase === "viewer" && doc && (
        <Viewer
          key={doc.path}
          doc={doc}
          onClose={closeDoc}
          onProgress={onProgress}
          onMeta={onMeta}
          onNotice={showToast}
          onOpenAnother={openPicker}
          onReload={reloadDoc}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={onBrowserFile}
      />

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
