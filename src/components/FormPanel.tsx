import React, { useMemo, useState } from "react";
import { IconClose, IconExtract, IconForm } from "./Icons";
import type { PDFDocumentProxy } from "../lib/pdf";
import { formValueText, type FormWidget } from "../lib/forms";

type Props = {
  doc: PDFDocumentProxy | null;
  fields: FormWidget[];
  busy: boolean;
  onClose: () => void;
  onGoPage: (page: number) => void;
  onSave: () => Promise<void>;
  onFlatten: () => Promise<void>;
};

const LABEL: Record<FormWidget["type"], string> = {
  text: "文本",
  checkbox: "勾选",
  radio: "单选",
  choice: "下拉",
};

export default function FormPanel({
  doc,
  fields,
  busy,
  onClose,
  onGoPage,
  onSave,
  onFlatten,
}: Props) {
  const [saving, setSaving] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, FormWidget[]>();
    for (const f of fields) {
      const list = map.get(f.name);
      if (list) list.push(f);
      else map.set(f.name, [f]);
    }
    return [...map.entries()].sort((a, b) => a[1][0].page - b[1][0].page);
  }, [fields]);

  const shown = (list: FormWidget[]) => {
    if (list[0].type === "checkbox" || list[0].type === "radio") {
      const hit = list.find((f) => formValueText(f, doc ?? undefined) !== "未选");
      return hit ? formValueText(hit, doc ?? undefined) : "未选";
    }
    return formValueText(list[0], doc ?? undefined);
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="form-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className="form-panel glass" role="dialog" aria-modal="true" aria-label="表单">
        <header className="form-head">
          <div>
            <h2>
              <IconForm className="form-title-icon" /> 表单
            </h2>
            <div className="form-sub">
              {groups.length} 个字段
              {fields.some((f) => formValueText(f, doc ?? undefined) !== "未填写" && formValueText(f, doc ?? undefined) !== "未选")
                ? " · 已填写"
                : ""}
            </div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="关闭表单">
            <IconClose />
          </button>
        </header>

        <div className="form-list">
          {groups.map(([name, list]) => (
            <button
              key={name}
              className="form-row"
              onClick={() => {
                onGoPage(list[0].page);
                onClose();
              }}
              title="跳到这个字段所在页"
            >
              <span className="form-page">第 {list[0].page} 页</span>
              <span className="form-name">{name}</span>
              <span className="form-kind">{LABEL[list[0].type]}</span>
              <span className="form-value">{shown(list)}</span>
            </button>
          ))}
        </div>

        <footer className="form-foot">
          <span className="form-hint">直接在页面上填写，停手 1.2 秒自动保存。</span>
          <button className="btn btn-ghost" onClick={() => void save()} disabled={busy || saving}>
            {saving ? "保存中…" : "立即保存"}
          </button>
          <button className="btn btn-primary" onClick={() => void onFlatten()} disabled={busy || saving}>
            <IconExtract /> 导出展平
          </button>
        </footer>
      </section>
    </div>
  );
}
