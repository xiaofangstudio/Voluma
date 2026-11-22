import { pdfjs, type PDFDocumentProxy } from "./pdf";
import type { FormValue } from "./tauri";

export type FormWidget = {
  id: string;
  page: number;
  name: string;
  fieldType: string;
  type: FormValue["kind"];
  value: string | string[] | boolean | null;
  exportValue?: string;
  buttonValue?: string;
  options: string[];
  checkBox: boolean;
  radioButton: boolean;
  readOnly: boolean;
};

type RawAnnotation = {
  id?: string;
  subtype?: string;
  fieldName?: string;
  fieldType?: string;
  fieldValue?: string | string[] | boolean | null;
  exportValue?: string;
  buttonValue?: string;
  checkBox?: boolean;
  radioButton?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  options?: { exportValue?: string; displayValue?: string }[];
};

function kindOf(a: RawAnnotation): FormValue["kind"] | null {
  if (a.fieldType === "Tx") return "text";
  if (a.fieldType === "Ch") return "choice";
  if (a.fieldType === "Btn") return a.radioButton ? "radio" : "checkbox";
  return null;
}

export async function scanForms(doc: PDFDocumentProxy, total: number): Promise<FormWidget[]> {
  const out: FormWidget[] = [];
  for (let n = 1; n <= total; n++) {
    let annotations: RawAnnotation[] = [];
    try {
      const page = await doc.getPage(n);
      annotations = (await page.getAnnotations()) as RawAnnotation[];
      page.cleanup();
    } catch {
      continue;
    }
    for (const a of annotations) {
      if (a.subtype !== "Widget" || !a.id || !a.fieldName) continue;
      const kind = kindOf(a);
      if (!kind || a.hidden) continue;
      out.push({
        id: a.id,
        page: n,
        name: a.fieldName,
        fieldType: a.fieldType ?? "",
        type: kind,
        value: a.fieldValue ?? null,
        exportValue: a.exportValue,
        buttonValue: a.buttonValue,
        options: (a.options ?? []).map((o) => o.exportValue ?? o.displayValue ?? ""),
        checkBox: !!a.checkBox,
        radioButton: !!a.radioButton,
        readOnly: !!a.readOnly,
      });
    }
  }
  return out;
}

export async function renderWidgetLayer(
  doc: PDFDocumentProxy,
  n: number,
  wrap: HTMLElement,
  viewport: unknown
): Promise<number> {
  wrap.querySelector(".widgetLayer")?.remove();
  const page = await doc.getPage(n);
  let annotations: RawAnnotation[] = [];
  try {
    annotations = (await page.getAnnotations()) as RawAnnotation[];
  } finally {
    page.cleanup();
  }
  const widgets = annotations.filter(
    (a) => a.subtype === "Widget" && a.fieldName && a.id && !a.hidden && kindOf(a)
  );
  if (!widgets.length) return 0;

  const outer = document.createElement("div");
  outer.className = "widgetLayer";
  outer.style.setProperty("--scale-factor", String((viewport as { scale?: number }).scale ?? 1));
  const div = document.createElement("div");
  div.className = "annotationLayer";
  outer.appendChild(div);
  wrap.appendChild(outer);
  const layer = new (pdfjs.AnnotationLayer as any)({
    div,
    page,
    viewport,
    annotationStorage: doc.annotationStorage,
  });
  await layer.render({
    annotations: widgets,
    annotationStorage: doc.annotationStorage,
    renderForms: true,
  });
  return widgets.length;
}

function checked(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value !== "" && value !== "Off";
  return false;
}

export function collectFormValues(doc: PDFDocumentProxy, widgets: FormWidget[]): FormValue[] {
  const map = new Map<string, FormValue>();
  const buttons = new Map<string, { kind: "checkbox" | "radio"; value: string | null }>();
  for (const w of widgets) {
    if (w.type !== "text" && w.type !== "choice" && w.type !== "checkbox" && w.type !== "radio") {
      continue;
    }
    const raw = doc.annotationStorage.getRawValue(w.id) as { value?: unknown } | undefined;
    const current = raw && "value" in raw ? raw.value : w.value;

    if (w.type === "checkbox" || w.type === "radio") {
      const hit = checked(current);
      const prev = buttons.get(w.name);
      if (hit) {
        buttons.set(w.name, {
          kind: w.type,
          value: w.buttonValue ?? w.exportValue ?? (typeof current === "string" ? current : "Yes"),
        });
      } else if (!prev) {
        buttons.set(w.name, { kind: w.type, value: null });
      }
      continue;
    }

    if (w.type === "choice" && Array.isArray(current)) {
      map.set(w.name, { name: w.name, kind: "choice", value: current.map(String) });
      continue;
    }
    const value =
      current === null || current === undefined
        ? ""
        : typeof current === "string"
          ? current
          : String(current);
    map.set(w.name, { name: w.name, kind: w.type, value });
  }
  for (const [name, state] of buttons) {
    map.set(name, { name, kind: state.kind, value: state.value ?? "Off" });
  }
  return [...map.values()];
}

export function formValueText(w: FormWidget, doc?: PDFDocumentProxy): string {
    const raw = doc?.annotationStorage.getRawValue(w.id) as { value?: unknown } | undefined;
    const v = raw && "value" in raw ? raw.value : w.value;
    if (w.type === "checkbox") {
        return checked(v) ? "已勾选" : "未选";
    }
    if (w.type === "radio") {
        return checked(v) ? "已选" : "未选";
    }
    if (Array.isArray(v)) return v.join("、");
    if (v === null || v === undefined || v === "") return "未填写";
    return String(v);
}
