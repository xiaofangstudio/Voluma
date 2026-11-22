import { invoke } from "@tauri-apps/api/core";
import type { Annot } from "./annots";

export const IS_TAURI: boolean = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function pickPdf(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    directory: false,
    title: "打开 PDF",
    filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
  });
  return typeof picked === "string" ? picked : null;
}

export async function readDocument(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_document", { path });
}

export async function documentExists(path: string): Promise<boolean> {
  try {
    return invoke<boolean>("file_exists", { path });
  } catch {
    return false;
  }
}

export async function readAnnotations(path: string): Promise<Annot[]> {
  return invoke<Annot[]>("read_annotations", { path });
}

export type SaveResult = { annotations: number; bytes: number };

export async function saveAnnotations(
  path: string,
  payload: string,
  backup = true
): Promise<SaveResult> {
  return invoke<SaveResult>("save_annotations", { path, payload, backup });
}

export function baseName(path: string): string {
  const seg = path.split(/[\\/]/).pop() ?? path;
  return seg.replace(/\.pdf$/i, "") || "未命名文档";
}

export type PageResult = { pages: number; bytes: number };
export type FormResult = { fields: number; bytes: number };

export async function documentPageCount(path: string): Promise<number> {
  return invoke<number>("document_page_count", { path });
}

export async function applyPagePlan(
  path: string,
  plan: string,
  backup = true
): Promise<PageResult> {
  return invoke<PageResult>("apply_page_plan", { path, plan, backup });
}

export async function extractPages(
  path: string,
  pages: number[],
  dest: string
): Promise<PageResult> {
  return invoke<PageResult>("extract_pages", { path, pages, dest });
}

export type FormValue = {
  name: string;
  kind: "text" | "checkbox" | "radio" | "choice";
  value: string | boolean | string[];
  multiline?: boolean;
};

export async function saveFormValues(
  path: string,
  payload: string,
  backup = true
): Promise<FormResult> {
  return invoke<FormResult>("save_form_values", { path, payload, backup });
}

export async function flattenForm(
  path: string,
  dest: string,
  payload: string
): Promise<FormResult> {
  return invoke<FormResult>("flatten_form", { path, dest, payload });
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
