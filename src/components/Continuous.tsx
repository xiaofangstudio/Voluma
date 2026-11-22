import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import {
  paintAnnotationsForWrap,
  type Annot,
} from "../lib/annots";
import {
  paintHighlights,
  renderPageInto,
  type BaseSize,
  type PDFDocumentProxy,
} from "../lib/pdf";
import { renderWidgetLayer } from "../lib/forms";

const PAD = 24;
const GAP = 16;

type Slot = { n: number; top: number; left: number; w: number; h: number };

type Props = {
  doc: PDFDocumentProxy;
  numPages: number;
  scale: number;
  sizes: Map<number, BaseSize>;
  initialPage: number;
  night: boolean;
  query: string;
  currentHitPage: number | null;
  annots: Annot[];
  selectedAnnot: string | null;
  onVisiblePage: (n: number) => void;
};

export type ContinuousHandle = {
  goToPage: (n: number) => void;
};

const Continuous = forwardRef<ContinuousHandle, Props>(function Continuous(
  {
    doc,
    numPages,
    scale,
    sizes,
    initialPage,
    night,
    query,
    currentHitPage,
    annots,
    selectedAnnot,
    onVisiblePage,
  },
  ref
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<HTMLDivElement>(null);
  const slotEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const rendered = useRef<Map<number, number>>(new Map());
  const anchor = useRef<{ page: number; ratio: number }>({ page: initialPage, ratio: 0 });
  const lastPage = useRef(initialPage);
  const raf = useRef(0);
  const firstLayout = useRef(true);
  const initialRef = useRef(initialPage);
  const nightRef = useRef(night);
  const queryRef = useRef(query);
  const hitRef = useRef(currentHitPage);
  const annotsRef = useRef(annots);
  const selectedRef = useRef(selectedAnnot);
  nightRef.current = night;
  queryRef.current = query;
  hitRef.current = currentHitPage;
  annotsRef.current = annots;
  selectedRef.current = selectedAnnot;

  const layout = useMemo(() => {
    const fallback = sizes.get(1) ?? { w: 612, h: 792 };
    const items: Slot[] = [];
    let y = PAD;
    let maxW = 0;
    for (let n = 1; n <= numPages; n++) {
      const s = sizes.get(n) ?? fallback;
      const w = Math.max(1, Math.floor(s.w * scale));
      const h = Math.max(1, Math.floor(s.h * scale));
      maxW = Math.max(maxW, w);
      items.push({ n, top: y, left: 0, w, h });
      y += h + GAP;
    }
    for (const it of items) it.left = Math.floor((maxW - it.w) / 2);
    return { items, total: y - GAP + PAD, maxW };
  }, [numPages, scale, sizes]);

  const offsetOf = useCallback(
    (n: number) => layout.items[Math.min(Math.max(0, n - 1), layout.items.length - 1)],
    [layout]
  );

  const visibleAt = useCallback(
    (scrollTop: number, viewH: number) => {
      const bottom = scrollTop + viewH;
      const first = layout.items.find((it) => it.top + it.h >= scrollTop)?.n ?? 1;
      let last = first;
      for (const it of layout.items) {
        if (it.top <= bottom) last = it.n;
      }
      return { first, last };
    },
    [layout]
  );

  const pageAt = useCallback(
    (centerY: number) => {
      let cur = layout.items[0];
      for (const it of layout.items) {
        if (centerY >= it.top) cur = it;
        else break;
      }
      return cur;
    },
    [layout]
  );

  const paintAll = useCallback(() => {
    for (const [n, el] of slotEls.current) {
      paintHighlights(el, queryRef.current, hitRef.current === n);
    }
  }, []);

  useEffect(() => {
    paintAll();
  }, [paintAll, query, currentHitPage]);

  const renderSlot = useCallback(
    (n: number) => {
      const el = slotEls.current.get(n);
      if (!el) return;
      if (rendered.current.get(n) === scale) return;
      rendered.current.set(n, scale);
      renderPageInto(doc, n, scale, el, {
        text: true,
        query: queryRef.current,
        current: hitRef.current === n,
      })
        .then(async ({ viewport }) => {
          await renderWidgetLayer(doc, n, el, viewport);
          paintAnnotationsForWrap(el, annotsRef.current, selectedRef.current);
        })
        .catch(() => {
          rendered.current.delete(n);
        });
    },
    [doc, scale]
  );

  const updateVisible = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    raf.current = 0;

    const { first, last } = visibleAt(sc.scrollTop, sc.clientHeight);
    for (let n = Math.max(1, first - 1); n <= Math.min(numPages, last + 1); n++) renderSlot(n);

    for (const [n, el] of slotEls.current) {
      if (n < first - 3 || n > last + 3) {
        if (rendered.current.has(n)) {
          rendered.current.delete(n);
          el.replaceChildren();
        }
      }
    }

    const center = sc.scrollTop + sc.clientHeight / 2;
    const cur = pageAt(center);
    anchor.current = {
      page: cur.n,
      ratio: Math.min(1, Math.max(0, (center - cur.top) / Math.max(1, cur.h))),
    };
    if (cur.n !== lastPage.current) {
      lastPage.current = cur.n;
      onVisiblePage(cur.n);
    }
  }, [visibleAt, pageAt, renderSlot, numPages, onVisiblePage]);

  const onScroll = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(updateVisible);
  }, [updateVisible]);

  /* 新布局：重建页位，保持阅读位置 */
  useEffect(() => {
    const sc = scrollRef.current;
    const host = slotsRef.current;
    if (!sc || !host) return;

    host.replaceChildren();
    slotEls.current.clear();
    rendered.current.clear();

    const frag = document.createDocumentFragment();
    for (const it of layout.items) {
      const el = document.createElement("div");
      el.className = `page-wrap slot${nightRef.current ? " night" : ""}`;
      el.dataset.page = String(it.n);
      el.style.position = "absolute";
      el.style.top = `${it.top}px`;
      el.style.left = `${it.left}px`;
      el.style.width = `${it.w}px`;
      el.style.height = `${it.h}px`;
      slotEls.current.set(it.n, el);
      frag.appendChild(el);
    }
    host.appendChild(frag);

    const useAnchor = firstLayout.current;
    const target = useAnchor ? initialRef.current : anchor.current.page;
    const ratio = useAnchor ? 0 : anchor.current.ratio;
    const it = offsetOf(target);
    sc.scrollTop = Math.max(0, it.top + ratio * it.h - sc.clientHeight / 2);
    firstLayout.current = false;
    updateVisible();

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [layout, offsetOf, updateVisible]);

  useEffect(() => {
    for (const [, el] of slotEls.current) el.classList.toggle("night", night);
  }, [night]);

  useImperativeHandle(
    ref,
    () => ({
      goToPage(n: number) {
        const sc = scrollRef.current;
        if (!sc) return;
        const it = offsetOf(n);
        sc.scrollTop = Math.max(0, it.top - 12);
        lastPage.current = n;
        onVisiblePage(n);
        updateVisible();
      },
    }),
    [offsetOf, onVisiblePage, updateVisible]
  );

  return (
    <div className="scroller continuous" ref={scrollRef} onScroll={onScroll}>
      <div className="slots" ref={slotsRef} style={{ height: layout.total, width: layout.maxW }} />
    </div>
  );
});

export default Continuous;
