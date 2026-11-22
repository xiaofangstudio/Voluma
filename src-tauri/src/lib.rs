use std::path::PathBuf;
use tauri::ipc::Response;

/// 一次性把整份 PDF 以二进制返回给前端 PDF.js，避免 JSON 数组序列化的开销。
#[tauri::command]
fn read_document(path: String) -> Result<Response, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err("文件不存在或不是文件".into());
    }
    std::fs::read(&p)
        .map(Response::new)
        .map_err(|e| format!("读取失败：{e}"))
}

/// 仅探测文件是否存在，用来给最近文件列表做失效标记。
#[tauri::command]
fn file_exists(path: String) -> bool {
    PathBuf::from(path).is_file()
}

/// 返回文件大小，供打开前做大小提示。
#[tauri::command]
fn file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| format!("无法读取文件信息：{e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_document,
            file_exists,
            file_size,
            annotations::save_annotations,
            annotations::read_annotations,
            pages::apply_page_plan,
            pages::extract_pages,
            pages::document_page_count,
            form::save_form_values,
            form::flatten_form
        ])
        .run(tauri::generate_context!())
        .expect("运行 Voluma 时出错");
}

/* ------------------------------------------------------------------ */
/* 页面管理：旋转 / 删除 / 重排 / 提取 / 插入                              */
/* ------------------------------------------------------------------ */

mod pages;
mod form;

/* ------------------------------------------------------------------ */
/* 注释直接写成 PDF 标准注释对象（不再使用 sidecar）                       */
/* ------------------------------------------------------------------ */

mod annotations {
    use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
    use serde::{Deserialize, Serialize};
    use std::path::{Path, PathBuf};

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AnnotIn {
        pub id: String,
        pub page: u32,
        #[serde(rename = "type")]
        pub kind: String,
        pub color: String,
        pub rect: [f64; 4],
        pub quads: Option<Vec<f64>>,
        pub path: Option<Vec<[f64; 2]>>,
        pub text: Option<String>,
    }

    #[derive(Debug, Serialize)]
    pub struct SaveResult {
        pub annotations: usize,
        pub bytes: u64,
    }

    #[derive(Debug, Serialize)]
    pub struct AnnotRow {
        pub id: String,
        pub page: u32,
        #[serde(rename = "type")]
        pub kind: String,
        pub color: String,
        pub rect: Vec<f64>,
        pub quads: Option<Vec<f64>>,
        pub path: Option<Vec<[f64; 2]>>,
        pub text: Option<String>,
    }

    #[tauri::command]
    pub fn read_annotations(path: String) -> Result<Vec<AnnotRow>, String> {
        let bytes = std::fs::read(&path).map_err(|e| format!("读取原文件失败：{e}"))?;
        let doc = Document::load_mem(&bytes).map_err(|e| format!("解析 PDF 失败：{e}"))?;
        Ok(collect_annotations(&doc))
    }

    fn collect_annotations(doc: &Document) -> Vec<AnnotRow> {
        let mut rows = Vec::new();
        for (page_no, page_id) in doc.get_pages() {
            let Some(items) = read_annots(doc, page_id) else {
                continue;
            };
            for item in items {
                let Some(dict) = resolved(doc, &item) else {
                    continue;
                };
                let Some(nm) = annot_nm(doc, &item) else {
                    continue;
                };
                if !nm.starts_with(OUR_PREFIX) {
                    continue;
                }
                let subtype = dict
                    .get(b"Subtype")
                    .ok()
                    .and_then(|o| o.as_name().ok())
                    .map(|s| String::from_utf8_lossy(s).to_string())
                    .unwrap_or_default();
                let kind = match subtype.as_str() {
                    "Highlight" => "highlight",
                    "Underline" => "underline",
                    "StrikeOut" => "strike",
                    "Square" => "square",
                    "Circle" => "circle",
                    "Ink" => "ink",
                    "Text" => {
                        let name = dict
                            .get(b"Name")
                            .ok()
                            .and_then(|o| o.as_name().ok())
                            .map(|s| String::from_utf8_lossy(s).to_string());
                        if name.as_deref() == Some("PushPin") {
                            "pin"
                        } else {
                            "note"
                        }
                    }
                    _ => continue,
                };
                let rect = dict
                    .get(b"Rect")
                    .ok()
                    .and_then(array_numbers)
                    .unwrap_or_default();
                if rect.len() < 4 {
                    continue;
                }
                let color = dict
                    .get(b"C")
                    .ok()
                    .and_then(array_numbers)
                    .filter(|c| c.len() >= 3)
                    .map(|c| {
                        format!(
                            "#{:02x}{:02x}{:02x}",
                            (c[0] * 255.0).round().clamp(0.0, 255.0) as u8,
                            (c[1] * 255.0).round().clamp(0.0, 255.0) as u8,
                            (c[2] * 255.0).round().clamp(0.0, 255.0) as u8
                        )
                    })
                    .unwrap_or_else(|| "#b02a37".into());
                let quads = dict.get(b"QuadPoints").ok().and_then(array_numbers);
                let path = dict.get(b"InkList").ok().and_then(|o| {
                    o.as_array().ok().and_then(|pts| {
                        pts.first()
                            .and_then(|first| first.as_array().ok())
                            .map(|values| flatten_points(values))
                    })
                });
                let text = dict
                    .get(b"Contents")
                    .ok()
                    .and_then(pdf_string)
                    .filter(|s| !s.is_empty());
                rows.push(AnnotRow {
                    id: nm,
                    page: page_no,
                    kind: kind.into(),
                    color,
                    rect: rect[0..4].to_vec(),
                    quads,
                    path,
                    text,
                });
            }
        }
        rows
    }

    fn array_numbers(obj: &Object) -> Option<Vec<f64>> {
        let arr = obj.as_array().ok()?;
        let mut out = Vec::with_capacity(arr.len());
        for v in arr {
            match v {
                Object::Real(f) => out.push(*f as f64),
                Object::Integer(i) => out.push(*i as f64),
                _ => return None,
            }
        }
        Some(out)
    }

    fn flatten_points(values: &[Object]) -> Vec<[f64; 2]> {
        values
            .chunks_exact(2)
            .filter_map(|pair| {
                let x = match &pair[0] {
                    Object::Real(f) => *f as f64,
                    Object::Integer(i) => *i as f64,
                    _ => return None,
                };
                let y = match &pair[1] {
                    Object::Real(f) => *f as f64,
                    Object::Integer(i) => *i as f64,
                    _ => return None,
                };
                Some([x, y])
            })
            .collect()
    }

    fn pdf_string(obj: &Object) -> Option<String> {
        match obj {
            Object::String(bytes, format) => {
                if matches!(format, lopdf::StringFormat::Hexadecimal)
                    && bytes.starts_with(&[0xfe, 0xff])
                {
                    let mut units = Vec::with_capacity((bytes.len() - 2) / 2);
                    let mut i = 2;
                    while i + 1 < bytes.len() {
                        units.push(u16::from_be_bytes([bytes[i], bytes[i + 1]]));
                        i += 2;
                    }
                    Some(String::from_utf16_lossy(&units))
                } else {
                    Some(String::from_utf8_lossy(bytes).to_string())
                }
            }
            _ => None,
        }
    }

    #[tauri::command]
    pub async fn save_annotations(
        path: String,
        payload: String,
        backup: Option<bool>,
    ) -> Result<SaveResult, String> {
        let annots: Vec<AnnotIn> =
            serde_json::from_str(&payload).map_err(|e| format!("注释数据格式错误：{e}"))?;
        tauri::async_runtime::spawn_blocking(move || {
            write_back(&path, annots, backup.unwrap_or(true))
        })
        .await
        .map_err(|e| format!("保存线程异常：{e}"))?
    }

    fn write_back(path: &str, annots: Vec<AnnotIn>, backup: bool) -> Result<SaveResult, String> {
        let src = PathBuf::from(path);
        if !src.is_file() {
            return Err("原文件不存在，无法保存".into());
        }
        let bytes = std::fs::read(&src).map_err(|e| format!("读取原文件失败：{e}"))?;
        let mut doc = Document::load_mem(&bytes).map_err(|e| format!("解析 PDF 失败：{e}"))?;

        let count = apply_annotations(&mut doc, &annots)?;

        let tmp = temp_path(&src);
        doc.save(&tmp)
            .map_err(|e| format!("写入临时文件失败：{e}"))?;
        let written = std::fs::metadata(&tmp).map_err(|e| e.to_string())?.len();

        if backup {
            let bak = with_suffix(&src, ".bak");
            // 只在第一次保存时留底，避免连续自动保存把最初的原件覆盖掉
            if !bak.exists() {
                std::fs::copy(&src, &bak).map_err(|e| format!("备份原文件失败：{e}"))?;
            }
        }

        std::fs::rename(&tmp, &src).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("替换原文件失败：{e}")
        })?;

        Ok(SaveResult {
            annotations: count,
            bytes: written,
        })
    }

    fn temp_path(src: &Path) -> PathBuf {
        let mut name = src
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "document.pdf".into());
        name.push_str(".voluma-tmp");
        src.with_file_name(name)
    }

    fn with_suffix(src: &Path, suffix: &str) -> PathBuf {
        let mut name = src
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "document.pdf".into());
        name.push_str(suffix);
        src.with_file_name(name)
    }

    const OUR_PREFIX: &str = "voluma-";

    fn apply_annotations(doc: &mut Document, annots: &[AnnotIn]) -> Result<usize, String> {
        let pages = doc.get_pages();
        if pages.is_empty() {
            return Err("PDF 里找不到任何页面，无法写入注释".into());
        }
        for a in annots {
            if !a.id.starts_with(OUR_PREFIX) {
                return Err("注释 id 必须以 voluma- 开头".into());
            }
            if !pages.contains_key(&a.page) {
                return Err(format!(
                    "注释所在第 {} 页不存在（本文档共 {} 页）",
                    a.page,
                    pages.len()
                ));
            }
        }
        let pages: Vec<(u32, ObjectId)> = pages.into_iter().collect();
        let mut added = 0usize;

        for (page_no, page_id) in pages {
            let for_page: Vec<&AnnotIn> = annots.iter().filter(|a| a.page == page_no).collect();
            if for_page.is_empty() && !page_has_ours(doc, page_id) {
                continue;
            }

            let mut kept: Vec<Object> = Vec::new();
            if let Some(existing) = read_annots(doc, page_id) {
                for item in existing {
                    if is_ours(doc, &item) {
                        if let Object::Reference(id) = item {
                            doc.objects.remove(&id);
                        }
                    } else {
                        kept.push(item);
                    }
                }
            }

            let mut ours: Vec<Object> = Vec::new();
            for a in for_page {
                let id = build_annotation(doc, a)?;
                ours.push(Object::Reference(id));
                added += 1;
            }
            kept.extend(ours);

            let page = doc
                .get_object_mut(page_id)
                .map_err(|_| "找不到页面对象".to_string())?;
            let dict = page
                .as_dict_mut()
                .map_err(|_| "页面不是字典对象".to_string())?;
            dict.set("Annots", Object::Array(kept));
        }
        Ok(added)
    }

    fn read_annots(doc: &Document, page_id: ObjectId) -> Option<Vec<Object>> {
        let page = doc.get_object(page_id).ok()?.as_dict().ok()?;
        let obj = page.get(b"Annots").ok()?.clone();
        match obj {
            Object::Array(items) => Some(items),
            Object::Reference(id) => doc
                .get_object(id)
                .ok()
                .and_then(|o| o.as_array().ok())
                .map(|a| a.to_vec()),
            _ => None,
        }
    }

    fn resolved<'a>(doc: &'a Document, obj: &'a Object) -> Option<&'a Dictionary> {
        match obj {
            Object::Reference(id) => doc.get_object(*id).ok()?.as_dict().ok(),
            Object::Dictionary(d) => Some(d),
            _ => None,
        }
    }

    fn annot_nm(doc: &Document, obj: &Object) -> Option<String> {
        let dict = resolved(doc, obj)?;
        match dict.get(b"NM").ok()? {
            Object::String(bytes, _) => {
                let s = String::from_utf8_lossy(bytes).to_string();
                Some(s.trim_start_matches('\u{feff}').to_string())
            }
            _ => None,
        }
    }

    fn is_ours(doc: &Document, obj: &Object) -> bool {
        annot_nm(doc, obj)
            .map(|nm| nm.starts_with(OUR_PREFIX))
            .unwrap_or(false)
    }

    fn page_has_ours(doc: &Document, page_id: ObjectId) -> bool {
        read_annots(doc, page_id)
            .map(|items| items.iter().any(|o| is_ours(doc, o)))
            .unwrap_or(false)
    }

    fn hex_color(hex: &str) -> [f64; 3] {
        let s = hex.trim_start_matches('#');
        if s.len() < 6 {
            return [0.69, 0.16, 0.22];
        }
        let r = u8::from_str_radix(&s[0..2], 16).unwrap_or(176) as f64 / 255.0;
        let g = u8::from_str_radix(&s[2..4], 16).unwrap_or(42) as f64 / 255.0;
        let b = u8::from_str_radix(&s[4..6], 16).unwrap_or(55) as f64 / 255.0;
        [r, g, b]
    }

    fn n(v: f64) -> Object {
        Object::Real(v as f32)
    }

    fn nums(values: &[f64]) -> Object {
        Object::Array(values.iter().map(|v| n(*v)).collect())
    }

    fn pdf_text(text: &str) -> Object {
        if text.is_ascii() {
            Object::string_literal(text.as_bytes().to_vec())
        } else {
            let mut utf16 = Vec::with_capacity(text.len() * 2 + 2);
            utf16.extend_from_slice(&[0xfe, 0xff]);
            for unit in text.encode_utf16() {
                utf16.push((unit >> 8) as u8);
                utf16.push((unit & 0xff) as u8);
            }
            Object::String(utf16, lopdf::StringFormat::Hexadecimal)
        }
    }

    fn build_annotation(doc: &mut Document, a: &AnnotIn) -> Result<ObjectId, String> {
        let rgb = hex_color(&a.color);
        let mut rect = [
            a.rect[0].min(a.rect[2]),
            a.rect[1].min(a.rect[3]),
            a.rect[0].max(a.rect[2]),
            a.rect[1].max(a.rect[3]),
        ];
        if (rect[2] - rect[0]).abs() < 1.0 {
            rect[2] = rect[0] + 1.0;
        }
        if (rect[3] - rect[1]).abs() < 1.0 {
            rect[3] = rect[1] + 1.0;
        }

        let subtype = match a.kind.as_str() {
            "highlight" => "Highlight",
            "underline" => "Underline",
            "strike" => "StrikeOut",
            "square" => "Square",
            "circle" => "Circle",
            "ink" => "Ink",
            "note" => "Text",
            "pin" => "Text",
            other => return Err(format!("未知注释类型：{other}")),
        };

        let mut dict = Dictionary::new();
        dict.set("Type", "Annot");
        dict.set("Subtype", subtype);
        dict.set("Rect", nums(&rect));
        dict.set("C", nums(&rgb));
        dict.set("F", Object::Integer(4));
        dict.set("T", pdf_text("Voluma"));
        dict.set("NM", Object::string_literal(a.id.as_bytes().to_vec()));
        if let Some(text) = a.text.as_deref() {
            if !text.is_empty() {
                dict.set("Contents", pdf_text(text));
            }
        }
        match a.kind.as_str() {
            "highlight" => {
                dict.set("CA", n(0.4));
                let quads = a.quads.clone().filter(|q| q.len() >= 8).unwrap_or_else(|| {
                    vec![
                        rect[0], rect[3], rect[2], rect[3], rect[0], rect[1], rect[2], rect[1],
                    ]
                });
                dict.set("QuadPoints", nums(&quads));
            }
            "underline" | "strike" => {
                let quads = a.quads.clone().filter(|q| q.len() >= 8).unwrap_or_else(|| {
                    vec![
                        rect[0], rect[3], rect[2], rect[3], rect[0], rect[1], rect[2], rect[1],
                    ]
                });
                dict.set("QuadPoints", nums(&quads));
            }
            "square" | "circle" => {
                let mut bs = Dictionary::new();
                bs.set("W", n(2.0));
                bs.set("S", "S");
                dict.set("BS", Object::Dictionary(bs));
            }
            "ink" => {
                let mut bs = Dictionary::new();
                bs.set("W", n(2.0));
                bs.set("S", "S");
                dict.set("BS", Object::Dictionary(bs));
                if let Some(path) = a.path.clone() {
                    let stroke: Vec<Object> =
                        path.iter().flat_map(|p| vec![n(p[0]), n(p[1])]).collect();
                    dict.set("InkList", Object::Array(vec![Object::Array(stroke)]));
                }
            }
            "note" | "pin" => {
                dict.set(
                    "Name",
                    if a.kind == "pin" {
                        "PushPin"
                    } else {
                        "Comment"
                    },
                );
                dict.set("Open", Object::Boolean(false));
            }
            _ => {}
        }

        if let Some(ap) = build_appearance(doc, a, &rect, rgb) {
            let mut ap_dict = Dictionary::new();
            ap_dict.set("N", Object::Reference(ap));
            dict.set("AP", Object::Dictionary(ap_dict));
        }

        Ok(doc.add_object(Object::Dictionary(dict)))
    }

    fn build_appearance(
        doc: &mut Document,
        a: &AnnotIn,
        rect: &[f64; 4],
        rgb: [f64; 3],
    ) -> Option<ObjectId> {
        let w = (rect[2] - rect[0]).abs().max(1.0);
        let h = (rect[3] - rect[1]).abs().max(1.0);
        let x0 = rect[0];
        let y0 = rect[1];
        let mut content = String::new();
        let mut needs_alpha = false;

        match a.kind.as_str() {
            "highlight" => {
                needs_alpha = true;
                content.push_str("q\n/GS0 gs\n");
                content.push_str(&format!("{:.4} {:.4} {:.4} rg\n", rgb[0], rgb[1], rgb[2]));
                let quads = a.quads.clone().unwrap_or_default();
                if quads.len() >= 8 {
                    let mut idx = 0;
                    while idx + 7 < quads.len() {
                        let pts = [
                            (quads[idx] - x0, quads[idx + 1] - y0),
                            (quads[idx + 2] - x0, quads[idx + 3] - y0),
                            (quads[idx + 6] - x0, quads[idx + 7] - y0),
                            (quads[idx + 4] - x0, quads[idx + 5] - y0),
                        ];
                        content.push_str(&format!(
                            "{:.3} {:.3} m {:.3} {:.3} l {:.3} {:.3} l {:.3} {:.3} l h f\n",
                            pts[0].0,
                            pts[0].1,
                            pts[1].0,
                            pts[1].1,
                            pts[2].0,
                            pts[2].1,
                            pts[3].0,
                            pts[3].1
                        ));
                        idx += 8;
                    }
                } else {
                    content.push_str(&format!("0 0 {w:.3} {h:.3} re f\n"));
                }
                content.push_str("Q\n");
            }
            "underline" | "strike" => {
                content.push_str(&format!(
                    "q\n{:.4} {:.4} {:.4} RG\n1.4 w\n",
                    rgb[0], rgb[1], rgb[2]
                ));
                let quads = a.quads.clone().unwrap_or_default();
                if quads.len() >= 8 {
                    let mut idx = 0;
                    while idx + 7 < quads.len() {
                        let (lx, ly, rx, ry) = if a.kind == "underline" {
                            (
                                quads[idx + 4],
                                quads[idx + 5],
                                quads[idx + 6],
                                quads[idx + 7],
                            )
                        } else {
                            (
                                (quads[idx] + quads[idx + 4]) / 2.0,
                                (quads[idx + 1] + quads[idx + 5]) / 2.0,
                                (quads[idx + 2] + quads[idx + 6]) / 2.0,
                                (quads[idx + 3] + quads[idx + 7]) / 2.0,
                            )
                        };
                        content.push_str(&format!(
                            "{:.3} {:.3} m {:.3} {:.3} l S\n",
                            lx - x0,
                            ly - y0,
                            rx - x0,
                            ry - y0
                        ));
                        idx += 8;
                    }
                } else {
                    let y = if a.kind == "underline" { 1.0 } else { h / 2.0 };
                    content.push_str(&format!("0 {y:.3} m {w:.3} {y:.3} l S\n"));
                }
                content.push_str("Q\n");
            }
            "square" => {
                content.push_str(&format!(
                    "q\n{:.4} {:.4} {:.4} RG\n2 w\n0 0 {w:.3} {h:.3} re S\nQ\n",
                    rgb[0], rgb[1], rgb[2]
                ));
            }
            "circle" => {
                let cx = w / 2.0;
                let cy = h / 2.0;
                let rx = (w / 2.0) - 1.0;
                let ry = (h / 2.0) - 1.0;
                let kx = rx * 0.5523;
                let ky = ry * 0.5523;
                content.push_str(&format!(
                "q\n{:.4} {:.4} {:.4} RG\n2 w\n{:.3} {:.3} m {:.3} {:.3} {:.3} {:.3} {:.3} {:.3} c \
                 {:.3} {:.3} {:.3} {:.3} {:.3} {:.3} c {:.3} {:.3} {:.3} {:.3} {:.3} {:.3} c \
                 {:.3} {:.3} {:.3} {:.3} {:.3} {:.3} c S\nQ\n",
                rgb[0],
                rgb[1],
                rgb[2],
                cx + rx,
                cy,
                cx + rx,
                cy + ky,
                cx + kx,
                cy + ry,
                cx,
                cy + ry,
                cx - kx,
                cy + ry,
                cx - rx,
                cy + ky,
                cx - rx,
                cy,
                cx - rx,
                cy - ky,
                cx - kx,
                cy - ry,
                cx,
                cy - ry,
                cx + kx,
                cy - ry,
                cx + rx,
                cy - ky,
                cx + rx,
                cy
            ));
            }
            "ink" => {
                content.push_str(&format!(
                    "q\n{:.4} {:.4} {:.4} RG\n2 w\n",
                    rgb[0], rgb[1], rgb[2]
                ));
                if let Some(path) = a.path.as_ref() {
                    if path.len() > 1 {
                        for (i, p) in path.iter().enumerate() {
                            content.push_str(&format!(
                                "{:.3} {:.3} {}\n",
                                p[0] - x0,
                                p[1] - y0,
                                if i == 0 { "m" } else { "l" }
                            ));
                        }
                        content.push_str("S\n");
                    }
                }
                content.push_str("Q\n");
            }
            "note" | "pin" => {
                content.push_str(&format!(
                "q\n{:.4} {:.4} {:.4} rg\n0 0 {w:.3} {h:.3} re f\n1 1 1 rg\n1.6 1.6 {:.3} {:.3} re f\nQ\n",
                rgb[0],
                rgb[1],
                rgb[2],
                (w - 3.2).max(1.0),
                (h - 3.2).max(1.0)
            ));
            }
            _ => return None,
        }

        let mut stream_dict = Dictionary::new();
        stream_dict.set("Type", "XObject");
        stream_dict.set("Subtype", "Form");
        stream_dict.set("FormType", Object::Integer(1));
        stream_dict.set("BBox", nums(&[0.0, 0.0, w, h]));
        stream_dict.set("Length", Object::Integer(content.len() as i64));

        if needs_alpha {
            let mut gs = Dictionary::new();
            gs.set("ca", n(0.4));
            gs.set("CA", n(0.4));
            gs.set("BM", "Multiply");
            let gs_id = doc.add_object(Object::Dictionary(gs));
            let mut resources = Dictionary::new();
            let mut state = Dictionary::new();
            state.set("GS0", Object::Reference(gs_id));
            resources.set("ExtGState", Object::Dictionary(state));
            stream_dict.set("Resources", Object::Dictionary(resources));
        }

        Some(doc.add_object(Object::Stream(Stream::new(
            stream_dict,
            content.into_bytes(),
        ))))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn sample_path() -> PathBuf {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("assets")
                .join("M0-阅读样本.pdf")
        }

        fn annots() -> Vec<AnnotIn> {
            vec![
                AnnotIn {
                    id: "voluma-test-highlight".into(),
                    page: 1,
                    kind: "highlight".into(),
                    color: "#b02a37".into(),
                    rect: [72.0, 600.0, 300.0, 620.0],
                    quads: Some(vec![72.0, 620.0, 300.0, 620.0, 72.0, 600.0, 300.0, 600.0]),
                    path: None,
                    text: Some("测试高亮".into()),
                },
                AnnotIn {
                    id: "voluma-test-ink".into(),
                    page: 2,
                    kind: "ink".into(),
                    color: "#3b5bdb".into(),
                    rect: [100.0, 200.0, 300.0, 300.0],
                    quads: None,
                    path: Some(vec![[110.0, 210.0], [200.0, 280.0], [290.0, 215.0]]),
                    text: None,
                },
            ]
        }

        #[test]
        fn reads_back_own_annotations() {
            let bytes = std::fs::read(sample_path()).unwrap();
            let mut doc = Document::load_mem(&bytes).unwrap();
            apply_annotations(&mut doc, &annots()).unwrap();
            let rows = collect_annotations(&doc);
            assert_eq!(rows.len(), 2);
            let hl = rows.iter().find(|r| r.kind == "highlight").unwrap();
            assert_eq!(hl.id, "voluma-test-highlight");
            assert_eq!(hl.page, 1);
            assert_eq!(hl.color, "#b02a37");
            assert_eq!(hl.quads.as_ref().unwrap().len(), 8);
            assert_eq!(hl.text.as_deref(), Some("测试高亮"));
            let ink = rows.iter().find(|r| r.kind == "ink").unwrap();
            assert_eq!(ink.path.as_ref().unwrap().len(), 3);
            assert_eq!(ink.path.as_ref().unwrap()[1], [200.0, 280.0]);
        }

        #[test]
        fn write_back_replaces_file_atomically() {
            let dir = std::env::temp_dir().join(format!("voluma-writeback-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let target = dir.join("doc.pdf");
            std::fs::copy(sample_path(), &target).unwrap();

            let first = write_back(target.to_str().unwrap(), annots(), true).unwrap();
            assert_eq!(first.annotations, 2);
            assert!(target.is_file());
            let bak = dir.join("doc.pdf.bak");
            assert!(bak.is_file(), "缺少 .bak 备份");
            let original_len = std::fs::metadata(sample_path()).unwrap().len();
            assert_eq!(std::fs::metadata(&bak).unwrap().len(), original_len);
            assert!(!dir.join("doc.pdf.voluma-tmp").exists(), "临时文件应已替换");

            let doc = Document::load(&target).unwrap();
            assert_eq!(collect_annotations(&doc).len(), 2);

            // 删除一条后再次写回，应只剩一条且 .bak 更新
            let one = vec![annots()[0].clone()];
            let second = write_back(target.to_str().unwrap(), one, true).unwrap();
            assert_eq!(second.annotations, 1);
            let doc = Document::load(&target).unwrap();
            let rows = collect_annotations(&doc);
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].id, "voluma-test-highlight");
            // 第二次保存不应把 .bak 覆盖成“上一次保存后”的版本
            assert_eq!(std::fs::metadata(&bak).unwrap().len(), original_len);

            let _ = std::fs::remove_dir_all(&dir);
        }

        #[test]
        fn writes_note_and_pin_with_text() {
            let bytes = std::fs::read(sample_path()).unwrap();
            let mut doc = Document::load_mem(&bytes).unwrap();
            let extras = vec![
                AnnotIn {
                    id: "voluma-test-note".into(),
                    page: 3,
                    kind: "note".into(),
                    color: "#7048e8".into(),
                    rect: [80.0, 700.0, 98.0, 718.0],
                    quads: None,
                    path: None,
                    text: Some("这里的措辞再克制一点。".into()),
                },
                AnnotIn {
                    id: "voluma-test-pin".into(),
                    page: 4,
                    kind: "pin".into(),
                    color: "#e8590c".into(),
                    rect: [300.0, 500.0, 318.0, 518.0],
                    quads: None,
                    path: None,
                    text: Some("图 3 位置待补。".into()),
                },
            ];
            apply_annotations(&mut doc, &extras).unwrap();
            let rows = collect_annotations(&doc);
            assert_eq!(rows.len(), 2);
            let note = rows.iter().find(|r| r.kind == "note").unwrap();
            assert_eq!(note.text.as_deref(), Some("这里的措辞再克制一点。"));
            let pin = rows.iter().find(|r| r.kind == "pin").unwrap();
            assert_eq!(pin.text.as_deref(), Some("图 3 位置待补。"));
            assert_eq!(pin.color, "#e8590c");
        }

        #[test]
        fn rejects_annotations_on_missing_page() {
            let bytes = std::fs::read(sample_path()).unwrap();
            let mut doc = Document::load_mem(&bytes).unwrap();
            let mut only = annots();
            only.truncate(1);
            only[0].page = 99;
            let err = apply_annotations(&mut doc, &only).unwrap_err();
            assert!(err.contains("第 99 页"), "unexpected error: {err}");
        }

        #[test]
        fn writes_standard_annotations() {
            let bytes = std::fs::read(sample_path()).unwrap();
            let mut doc = Document::load_mem(&bytes).unwrap();
            let added = apply_annotations(&mut doc, &annots()).unwrap();
            assert_eq!(added, 2);

            let out = std::env::temp_dir().join("voluma-annot-test.pdf");
            doc.save(&out).unwrap();

            let reloaded = Document::load(&out).unwrap();
            let pages = reloaded.get_pages();
            let first = read_annots(&reloaded, pages[&1]).unwrap();
            let ours: Vec<_> = first.iter().filter(|o| is_ours(&reloaded, o)).collect();
            assert_eq!(ours.len(), 1);

            let dict = resolved(&reloaded, ours[0]).unwrap();
            assert_eq!(
                dict.get(b"Subtype").unwrap().as_name().unwrap(),
                b"Highlight"
            );
            assert!(dict.get(b"QuadPoints").is_ok());
            assert!(dict.get(b"AP").is_ok());

            let second = read_annots(&reloaded, pages[&2]).unwrap();
            let ink = second.iter().find(|o| is_ours(&reloaded, o)).unwrap();
            let ink_dict = resolved(&reloaded, ink).unwrap();
            assert_eq!(ink_dict.get(b"Subtype").unwrap().as_name().unwrap(), b"Ink");
            assert!(ink_dict.get(b"InkList").is_ok());
        }

        #[test]
        fn repeated_save_does_not_duplicate() {
            let bytes = std::fs::read(sample_path()).unwrap();
            let mut doc = Document::load_mem(&bytes).unwrap();
            apply_annotations(&mut doc, &annots()).unwrap();
            let again = apply_annotations(&mut doc, &annots()).unwrap();
            assert_eq!(again, 2);
            let pages = doc.get_pages();
            let first = read_annots(&doc, pages[&1]).unwrap();
            let ours = first.iter().filter(|o| is_ours(&doc, o)).count();
            assert_eq!(ours, 1);
        }

        #[test]
        fn removed_annotations_are_deleted() {
            let bytes = std::fs::read(sample_path()).unwrap();
            let mut doc = Document::load_mem(&bytes).unwrap();
            apply_annotations(&mut doc, &annots()).unwrap();
            apply_annotations(&mut doc, &[]).unwrap();
            let pages = doc.get_pages();
            let first = read_annots(&doc, pages[&1]).unwrap();
            assert_eq!(first.iter().filter(|o| is_ours(&doc, o)).count(), 0);
        }
    }
} // mod annotations
