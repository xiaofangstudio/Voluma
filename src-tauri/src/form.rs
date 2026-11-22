use lopdf::{Dictionary, Document, Object, ObjectId, Stream, StringFormat};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use ttf_parser::{Face, OutlineBuilder};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldValue {
    name: String,
    kind: String,
    #[serde(default)]
    value: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormPayload {
    #[serde(default)]
    fields: Vec<FieldValue>,
}

#[derive(Debug, Serialize)]
pub struct FormResult {
    pub fields: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone)]
struct NamedField {
    id: ObjectId,
    name: String,
    ft: String,
    widgets: Vec<ObjectId>,
    multiline: bool,
}

#[tauri::command]
pub fn save_form_values(path: String, payload: String, backup: bool) -> Result<FormResult, String> {
    let parsed = parse_payload(&payload)?;
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("原文件不存在，无法保存".into());
    }
    let bytes = std::fs::read(&src).map_err(|e| format!("读取原文件失败：{e}"))?;
    let mut doc = Document::load_mem(&bytes).map_err(|e| format!("解析 PDF 失败：{e}"))?;
    let count = apply_values(&mut doc, &parsed.fields)?;
    let written = save_doc(&mut doc, &src, backup)?;
    Ok(FormResult {
        fields: count,
        bytes: written,
    })
}

#[tauri::command]
pub fn flatten_form(path: String, dest: String, payload: String) -> Result<FormResult, String> {
    let parsed = parse_payload(&payload)?;
    let src = PathBuf::from(&path);
    let out = PathBuf::from(&dest);
    if !src.is_file() {
        return Err("原文件不存在".into());
    }
    if same_path(&src, &out) {
        return Err("展平不能覆盖原文件，请另存一份".into());
    }
    let bytes = std::fs::read(&src).map_err(|e| format!("读取原文件失败：{e}"))?;
    let mut doc = Document::load_mem(&bytes).map_err(|e| format!("解析 PDF 失败：{e}"))?;
    let count = apply_values(&mut doc, &parsed.fields)?;
    flatten_doc(&mut doc)?;
    let written = save_to(&mut doc, &out)?;
    Ok(FormResult {
        fields: count,
        bytes: written,
    })
}

fn parse_payload(payload: &str) -> Result<FormPayload, String> {
    serde_json::from_str(payload).map_err(|e| format!("表单数据不合法：{e}"))
}

fn apply_values(doc: &mut Document, fields: &[FieldValue]) -> Result<usize, String> {
    let acro = acroform_id(doc)?;
    let named = collect_fields(doc, acro)?;
    if named.is_empty() {
        return Err("这个 PDF 没有可填写的表单字段".into());
    }
    let by_name: BTreeMap<&str, &NamedField> = named.iter().map(|f| (f.name.as_str(), f)).collect();
    let mut cjk = false;
    for fv in fields {
        let Some(field) = by_name.get(fv.name.as_str()) else {
            continue;
        };
        if field.ft == "Sig" {
            continue;
        }
        apply_field(doc, field, fv)?;
        if !value_text(&fv.value).is_ascii() && fv.kind != "checkbox" && fv.kind != "radio" {
            cjk = true;
        }
    }
    set_need_appearances(doc, acro, cjk)?;
    Ok(named.len())
}

fn apply_field(doc: &mut Document, field: &NamedField, fv: &FieldValue) -> Result<(), String> {
    let value_obj = match field.ft.as_str() {
        "Tx" | "Ch" => {
            if let Value::Array(items) = &fv.value {
                let list = items
                    .iter()
                    .filter_map(|v| v.as_str())
                    .map(pdf_text_string)
                    .collect();
                Object::Array(list)
            } else {
                pdf_text_string(&value_text(&fv.value))
            }
        }
        _ => {
            let on = value_on(&fv.value);
            match on {
                Some(v) => Object::Name(v.into_bytes()),
                None => Object::Name(b"Off".to_vec()),
            }
        }
    };

    let mut field_dict = doc
        .get_object(field.id)
        .map_err(|_| format!("表单字段 {} 缺失", field.name))?
        .as_dict()
        .map_err(|_| "表单字段不是字典".to_string())?
        .clone();
    field_dict.set("V", value_obj.clone());

    if field.ft == "Tx" || field.ft == "Ch" {
        let text = value_text(&fv.value);
        let ascii = is_drawable_ascii(&text);
        for wid in &field.widgets {
            let widget = widget_dict(doc, *wid)?;
            let [x1, y1, x2, y2] = rect_of(&widget)?;
            let w = (x2 - x1).abs().max(1.0);
            let h = (y2 - y1).abs().max(1.0);
            let font = font_resource(doc, acroform_id(doc)?)?;
            let ap = if ascii {
                text_appearance(&text, w, h, field.multiline, &font)
            } else {
                blank_appearance(w, h)
            };
            let stream_id = doc.add_object(Object::Stream(ap));
            let mut ap_dict = Dictionary::new();
            ap_dict.set("N", Object::Reference(stream_id));
            let mut wd = widget;
            wd.set("AP", Object::Dictionary(ap_dict));
            doc.set_object(*wid, Object::Dictionary(wd));
        }
    } else {
        let on = value_on(&fv.value);
        for wid in &field.widgets {
            let mut wd = widget_dict(doc, *wid)?;
            let states = ap_states(&wd);
            let as_name = match &on {
                None => "Off".to_string(),
                Some(v) => {
                    if states.iter().any(|s| s == v) {
                        v.clone()
                    } else if fv.kind == "checkbox" && states.iter().any(|s| s != "Off") {
                        states
                            .iter()
                            .find(|s| s.as_str() != "Off")
                            .cloned()
                            .unwrap_or_else(|| v.clone())
                    } else if fv.kind == "radio" {
                        "Off".to_string()
                    } else {
                        v.clone()
                    }
                }
            };
            let want_on = on.as_deref() == Some(as_name.as_str());
            if states.is_empty() || (want_on && !states.iter().any(|s| s == &as_name)) {
                ensure_button_ap(doc, &mut wd, &as_name, want_on, fv.kind == "checkbox")?;
            }
            wd.set("AS", Object::Name(as_name.into_bytes()));
            doc.set_object(*wid, Object::Dictionary(wd));
        }
    }
    if field.widgets.iter().any(|w| *w == field.id) {
        if let Ok(current) = widget_dict(doc, field.id) {
            for (k, v) in current.iter() {
                field_dict.set(k.as_slice(), v.clone());
            }
            field_dict.set("V", value_obj);
        }
    }
    doc.set_object(field.id, Object::Dictionary(field_dict));
    Ok(())
}

fn collect_fields(doc: &Document, acro: ObjectId) -> Result<Vec<NamedField>, String> {
    let form = doc
        .get_object(acro)
        .map_err(|_| "找不到表单定义".to_string())?
        .as_dict()
        .map_err(|_| "表单定义不是字典".to_string())?
        .clone();
    let mut out = Vec::new();
    if let Ok(items) = form.get(b"Fields").and_then(|o| o.as_array()) {
        for item in items {
            if let Ok(id) = item.as_reference() {
                walk_field(doc, id, "", "", &mut out);
            }
        }
    }
    Ok(out)
}

fn walk_field(
    doc: &Document,
    id: ObjectId,
    prefix: &str,
    inherited_ft: &str,
    out: &mut Vec<NamedField>,
) {
    let Ok(obj) = doc.get_object(id) else { return };
    let Ok(d) = obj.as_dict() else { return };
    let t = d.get(b"T").ok().map(decode_string).unwrap_or_default();
    let name = if prefix.is_empty() {
        t
    } else if t.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}.{t}")
    };
    let ft = d
        .get(b"FT")
        .ok()
        .and_then(|o| o.as_name().ok())
        .map(|b| String::from_utf8_lossy(b).to_string())
        .unwrap_or_else(|| inherited_ft.to_string());
    let subtype = d
        .get(b"Subtype")
        .ok()
        .and_then(|o| o.as_name().ok())
        .map(|b| String::from_utf8_lossy(b).to_string());
    let is_widget = subtype.as_deref() == Some("Widget");
    let ff = d
        .get(b"Ff")
        .ok()
        .and_then(|o| o.as_i64().ok())
        .unwrap_or(0);
    let multiline = ff & 4096 != 0;
    let kids: Vec<ObjectId> = d
        .get(b"Kids")
        .ok()
        .and_then(|o| o.as_array().ok())
        .map(|a| a.iter().filter_map(|x| x.as_reference().ok()).collect())
        .unwrap_or_default();
    let child_fields: Vec<ObjectId> = kids
        .iter()
        .copied()
        .filter(|kid| !is_widget_object(doc, *kid))
        .collect();
    let widget_kids: Vec<ObjectId> = kids
        .iter()
        .copied()
        .filter(|kid| is_widget_object(doc, *kid))
        .collect();

    if !child_fields.is_empty() {
        for kid in child_fields {
            walk_field(doc, kid, &name, &ft, out);
        }
        return;
    }
    let widgets = if is_widget {
        vec![id]
    } else {
        widget_kids
    };
    if !name.is_empty() && (ft == "Tx" || ft == "Btn" || ft == "Ch") {
        out.push(NamedField {
            id,
            name,
            ft,
            widgets,
            multiline,
        });
    }
}

fn is_widget_object(doc: &Document, id: ObjectId) -> bool {
    doc.get_object(id)
        .ok()
        .and_then(|o| o.as_dict().ok())
        .and_then(|d| d.get(b"Subtype").ok())
        .and_then(|o| o.as_name().ok())
        .map(|b| b == b"Widget")
        .unwrap_or(false)
}

fn acroform_id(doc: &Document) -> Result<ObjectId, String> {
    let catalog = catalog(doc)?;
    match catalog.get(b"AcroForm") {
        Ok(Object::Reference(id)) => Ok(*id),
        Ok(Object::Dictionary(d)) => {
            // 直接内联的表单极少见，展平时需要间接对象；先保留错误提示
            let _ = d;
            Err("表单定义是内联对象，暂不支持写入".into())
        }
        _ => Err("这个 PDF 没有可填写的表单".into()),
    }
}

fn catalog(doc: &Document) -> Result<&Dictionary, String> {
    let id = doc
        .trailer
        .get(b"Root")
        .ok()
        .and_then(|o| o.as_reference().ok())
        .ok_or_else(|| "找不到 PDF 目录对象".to_string())?;
    doc.get_object(id)
        .map_err(|_| "找不到 PDF 目录对象".to_string())?
        .as_dict()
        .map_err(|_| "PDF 目录不是字典".to_string())
}

fn set_need_appearances(doc: &mut Document, acro: ObjectId, need: bool) -> Result<(), String> {
    let mut d = doc
        .get_object(acro)
        .map_err(|_| "找不到表单定义".to_string())?
        .as_dict()
        .map_err(|_| "表单定义不是字典".to_string())?
        .clone();
    d.set("NeedAppearances", Object::Boolean(need));
    doc.set_object(acro, Object::Dictionary(d));
    Ok(())
}

fn font_resource(doc: &mut Document, acro: ObjectId) -> Result<(String, ObjectId), String> {
    let form = doc
        .get_object(acro)
        .map_err(|_| "找不到表单定义".to_string())?
        .as_dict()
        .map_err(|_| "表单定义不是字典".to_string())?
        .clone();
    if let Ok(dr_obj) = form.get(b"DR") {
        if let Some(dr) = dict_clone(doc, dr_obj) {
            if let Ok(font_obj) = dr.get(b"Font") {
                if let Some(fonts) = dict_clone(doc, font_obj) {
                    for (name, obj) in fonts.iter() {
                        if let Ok(id) = obj.as_reference() {
                            return Ok((String::from_utf8_lossy(name).to_string(), id));
                        }
                    }
                }
            }
        }
    }

    let mut font = Dictionary::new();
    font.set("Type", "Font");
    font.set("Subtype", "Type1");
    font.set("BaseFont", "Helvetica");
    font.set("Encoding", "WinAnsiEncoding");
    let font_id = doc.add_object(Object::Dictionary(font));

    let mut form = form;
    let mut dr = form
        .get(b"DR")
        .ok()
        .and_then(|o| dict_clone(doc, o))
        .unwrap_or_default();
    let mut fonts = dr
        .get(b"Font")
        .ok()
        .and_then(|o| dict_clone(doc, o))
        .unwrap_or_default();
    fonts.set("VolumaHelv", Object::Reference(font_id));
    dr.set("Font", Object::Dictionary(fonts));
    form.set("DR", Object::Dictionary(dr));
    doc.set_object(acro, Object::Dictionary(form));
    Ok(("VolumaHelv".to_string(), font_id))
}

fn text_appearance(
    text: &str,
    w: f64,
    h: f64,
    multiline: bool,
    font: &(String, ObjectId),
) -> Stream {
    let size = if multiline {
        9.0
    } else {
        let approx = text.chars().count() as f64 * 0.52;
        (w / approx.max(1.0)).min(10.0).max(5.5)
    };
    let leading = (size * 1.18).max(9.0);
    let mut lines: Vec<String> = Vec::new();
    let max_chars = ((w - 4.0) / (size * 0.52)).max(1.0) as usize;
    for raw in text.split('\n') {
        if raw.is_empty() {
            lines.push(String::new());
            continue;
        }
        let mut line = String::new();
        for ch in raw.chars() {
            if line.chars().count() >= max_chars {
                lines.push(std::mem::take(&mut line));
            }
            line.push(ch);
        }
        lines.push(line);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    let start_y = if multiline {
        (h - size - 2.0).max(2.0)
    } else {
        ((h - size) / 2.0 + size * 0.22).max(2.0)
    };
    let mut content = format!("q 0 0 {w:.2} {h:.2} re W n BT /{} {size:.2} Tf 2 {start_y:.2} Td {leading:.2} TL\n", font.0);
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            content.push_str("T*\n");
        }
        content.push('(');
        content.push_str(&escape_text(line));
        content.push_str(") Tj\n");
    }
    content.push_str("ET Q");
    form_stream(content, w, h, &font.0, font.1)
}

fn blank_appearance(w: f64, h: f64) -> Stream {
    form_stream(format!("q 0 0 {w:.2} {h:.2} re W n Q"), w, h, "Helvetica", (0u32, 0u16))
}

fn form_stream(content: String, w: f64, h: f64, font_name: &str, font_id: ObjectId) -> Stream {
    let mut d = Dictionary::new();
    d.set("Type", "XObject");
    d.set("Subtype", "Form");
    d.set("FormType", Object::Integer(1));
    d.set(
        "BBox",
        Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(w as f32),
            Object::Real(h as f32),
        ]),
    );
    if !font_name.is_empty() && font_id != (0u32, 0u16) {
        let mut fonts = Dictionary::new();
        fonts.set(font_name, Object::Reference(font_id));
        let mut res = Dictionary::new();
        res.set("Font", Object::Dictionary(fonts));
        d.set("Resources", Object::Dictionary(res));
    }
    Stream::new(d, content.into_bytes())
}

fn ensure_button_ap(
    doc: &mut Document,
    widget: &mut Dictionary,
    on_name: &str,
    checked: bool,
    checkbox: bool,
) -> Result<(), String> {
    let diffs = widget.get(b"Rect").ok().and_then(rect_from_obj).unwrap_or([0.0; 4]);
    let w = (diffs[2] - diffs[0]).abs().max(1.0);
    let h = (diffs[3] - diffs[1]).abs().max(1.0);
    let off = doc.add_object(Object::Stream(blank_appearance(w, h)));
    let mut on_content = String::from("q 0.55 G 0.8 w 0 0 ");
    on_content.push_str(&format!("{w:.2} {h:.2} re S Q\nq 0 G 1.4 w\n"));
    if checkbox {
        on_content.push_str(&format!(
            "1.2 1.2 m {:.2} {:.2} l S\n{:.2} 1.2 m 1.2 {:.2} l S\nQ",
            (w - 1.2).max(1.5),
            (h - 1.2).max(1.5),
            (w - 1.2).max(1.5),
            (h - 1.2).max(1.5)
        ));
    } else {
        on_content.push_str(&format!(
            "{:.2} {:.2} m {:.2} {:.2} l {:.2} {:.2} l {:.2} {:.2} l h f\nQ",
            w / 4.0,
            h / 2.0,
            w / 2.0,
            h * 0.32,
            w * 0.75,
            h / 2.0,
            w / 2.0,
            h * 0.68
        ));
    }
    let on = doc.add_object(Object::Stream(form_stream(
        on_content,
        w,
        h,
        "Helvetica",
        (0u32, 0u16),
    )));
    let mut states = Dictionary::new();
    states.set("Off", Object::Reference(off));
    states.set(on_name, Object::Reference(on));
    let mut ap = Dictionary::new();
    ap.set("N", Object::Dictionary(states));
    widget.set("AP", Object::Dictionary(ap));
    if checked {
        widget.set("AS", Object::Name(on_name.as_bytes().to_vec()));
    }
    Ok(())
}

fn flatten_doc(doc: &mut Document) -> Result<(), String> {
    let acro = acroform_id(doc)?;
    let fields = collect_fields(doc, acro)?;
    let mut cjk_fields = Vec::new();
    let mut remove_ids: Vec<ObjectId> = Vec::new();
    for f in &fields {
        if (f.ft == "Tx" || f.ft == "Ch") && f.widgets.is_empty() {
            continue;
        }
        remove_ids.push(f.id);
        remove_ids.extend(f.widgets.iter().copied());
        if f.ft == "Tx" || f.ft == "Ch" {
            let field = doc.get_object(f.id).ok().and_then(|o| o.as_dict().ok());
            if let Some(d) = field {
                if let Ok(v) = d.get(b"V") {
                    if let Some(text) = string_value(v) {
                        if !is_drawable_ascii(&text) && !text.is_empty() {
                            cjk_fields.push(f.name.clone());
                        }
                    }
                }
            }
        }
    }
    let font_data = if cjk_fields.is_empty() {
        None
    } else {
        Some(load_cjk_font().ok_or_else(|| {
            format!(
                "表单里有中文内容，但没有找到可用的中文字体，暂时无法展平：{}。请安装微软雅黑 / 思源黑体，或先把内容改成英文。",
                cjk_fields.join("、")
            )
        })?)
    };
    let face = match &font_data {
        Some(data) => Some(
            Face::parse(&data.bytes, data.index)
                .map_err(|e| format!("读取中文字体失败：{e}"))?,
        ),
        None => None,
    };

    let pages: Vec<ObjectId> = doc.get_pages().values().copied().collect();
    for page_id in pages {
        flatten_page(doc, page_id, face.as_ref())?;
    }

    let mut catalog = catalog(doc)?.clone();
    catalog.remove(b"AcroForm");
    let root = doc
        .trailer
        .get(b"Root")
        .ok()
        .and_then(|o| o.as_reference().ok())
        .ok_or_else(|| "找不到 PDF 目录对象".to_string())?;
    doc.set_object(root, Object::Dictionary(catalog));
    for id in remove_ids {
        let _ = doc.delete_object(id);
    }
    Ok(())
}

fn flatten_page(
    doc: &mut Document,
    page_id: ObjectId,
    font: Option<&Face<'_>>,
) -> Result<(), String> {
    let page = doc
        .get_object(page_id)
        .map_err(|_| "找不到页面对象".to_string())?
        .as_dict()
        .map_err(|_| "页面对象不是字典".to_string())?
        .clone();
    let annots: Vec<ObjectId> = page
        .get(b"Annots")
        .ok()
        .and_then(|o| resolve_array(doc, o))
        .unwrap_or_default();
    if annots.is_empty() {
        return Ok(());
    }

    let mut kept: Vec<Object> = Vec::new();
    let mut xobjects = Dictionary::new();
    let mut new_contents: Vec<ObjectId> = Vec::new();
    for (i, wid) in annots.iter().enumerate() {
        let Ok(wobj) = doc.get_object(*wid) else { continue };
        let Ok(wd) = wobj.as_dict() else { continue };
        let is_widget = wd
            .get(b"Subtype")
            .ok()
            .and_then(|o| o.as_name().ok())
            .map(|b| b == b"Widget")
            .unwrap_or(false);
        if !is_widget {
            kept.push(Object::Reference(*wid));
            continue;
        }
        if let Some(face) = font {
            if let Some(text) = cjk_widget_text(doc, wd) {
                let [x1, y1, x2, y2] = rect_of(wd)?;
                if let Some(content) = cjk_content(&text.0, [x1, y1, x2, y2], text.1, text.2, face) {
                    let stream_id = doc.add_object(Object::Stream(Stream::new(
                        {
                            let mut d = Dictionary::new();
                            d.set("Length", Object::Integer(content.len() as i64));
                            d
                        },
                        content.into_bytes(),
                    )));
                    new_contents.push(stream_id);
                }
                continue;
            }
        }
        let Some(ap_id) = appearance_stream(doc, wd) else { continue };
        let [x1, y1, x2, y2] = rect_of(wd)?;
        let (bx1, by1, bx2, by2) = doc
            .get_object(ap_id)
            .ok()
            .and_then(|o| o.as_stream().ok())
            .and_then(|s| bbox_of(&s.dict))
            .unwrap_or((0.0, 0.0, (x2 - x1).abs(), (y2 - y1).abs()));
        let bw = (bx2 - bx1).abs().max(1.0);
        let bh = (by2 - by1).abs().max(1.0);
        let sx = (x2 - x1).abs() / bw;
        let sy = (y2 - y1).abs() / bh;
        let tx = x1.min(x2) - bx1 * sx;
        let ty = y1.min(y2) - by1 * sy;
        let name = format!("VolumaFm{i}");
        xobjects.set(name.as_str(), Object::Reference(ap_id));
        let content =
            format!("q {sx:.4} 0 0 {sy:.4} {tx:.4} {ty:.4} cm /{name} Do Q");
        let stream_id = doc.add_object(Object::Stream(Stream::new(
            {
                let mut d = Dictionary::new();
                d.set("Length", Object::Integer(content.len() as i64));
                d
            },
            content.into_bytes(),
        )));
        new_contents.push(stream_id);
    }

    let mut page = page;
    if !new_contents.is_empty() {
        let mut list = content_list(doc, &page);
        list.extend(new_contents.into_iter().map(Object::Reference));
        page.set("Contents", Object::Array(list));
    }
    if kept.is_empty() {
        page.remove(b"Annots");
    } else {
        page.set("Annots", Object::Array(kept));
    }
    if !xobjects.is_empty() {
        let mut res = page
            .get(b"Resources")
            .ok()
            .and_then(|o| dict_clone(doc, o))
            .unwrap_or_default();
        let mut xo = res
            .get(b"XObject")
            .ok()
            .and_then(|o| dict_clone(doc, o))
            .unwrap_or_default();
        for (k, v) in xobjects.iter() {
            xo.set(k.as_slice(), v.clone());
        }
        res.set("XObject", Object::Dictionary(xo));
        page.set("Resources", Object::Dictionary(res));
    }
    doc.set_object(page_id, Object::Dictionary(page));
    Ok(())
}

fn content_list(doc: &Document, page: &Dictionary) -> Vec<Object> {
    let mut list: Vec<Object> = Vec::new();
    if let Ok(obj) = page.get(b"Contents") {
        match obj {
            Object::Reference(id) => {
                if let Ok(target) = doc.get_object(*id) {
                    if let Ok(arr) = target.as_array() {
                        list.extend(arr.iter().cloned());
                    } else {
                        list.push(Object::Reference(*id));
                    }
                } else {
                    list.push(Object::Reference(*id));
                }
            }
            Object::Array(items) => list.extend(items.iter().cloned()),
            _ => {}
        }
    }
    list
}

fn appearance_stream(doc: &Document, widget: &Dictionary) -> Option<ObjectId> {
    let ap = widget.get(b"AP").ok()?;
    let ap = dict_clone_ref(doc, ap)?;
    let n = ap.get(b"N").ok()?;
    if let Ok(id) = n.as_reference() {
        return Some(id);
    }
    let states = dict_clone_ref(doc, n)?;
    let as_name = widget
        .get(b"AS")
        .ok()
        .and_then(|o| o.as_name().ok())
        .map(|b| b.to_vec());
    if let Some(name) = as_name {
        if let Ok(Object::Reference(id)) = states.get(name.as_slice()) {
            return Some(*id);
        }
    }
    for (_, v) in states.iter() {
        if let Ok(id) = v.as_reference() {
            return Some(id);
        }
    }
    None
}

fn rect_of(d: &Dictionary) -> Result<[f64; 4], String> {
    d.get(b"Rect")
        .ok()
        .and_then(rect_from_obj)
        .ok_or_else(|| "表单字段没有位置".to_string())
}

fn rect_from_obj(o: &Object) -> Option<[f64; 4]> {
    let a = o.as_array().ok()?;
    if a.len() < 4 {
        return None;
    }
    let mut r = [0.0; 4];
    for (i, item) in a.iter().take(4).enumerate() {
        r[i] = item.as_float().ok()? as f64;
    }
    Some(r)
}

fn bbox_of(d: &Dictionary) -> Option<(f64, f64, f64, f64)> {
    let r = rect_from_obj(d.get(b"BBox").ok()?)?;
    Some((r[0], r[1], r[2], r[3]))
}

fn ap_states(widget: &Dictionary) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(ap) = widget.get(b"AP") {
        if let Ok(ap) = ap.as_dict() {
            if let Ok(n) = ap.get(b"N") {
                if let Ok(states) = n.as_dict() {
                    for (name, _) in states.iter() {
                        out.push(String::from_utf8_lossy(name).to_string());
                    }
                }
            }
        }
    }
    out
}

fn widget_dict(doc: &Document, id: ObjectId) -> Result<Dictionary, String> {
    doc.get_object(id)
        .map_err(|_| "表单控件缺失".to_string())?
        .as_dict()
        .map_err(|_| "表单控件不是字典".to_string())
        .cloned()
}

fn dict_clone(doc: &Document, obj: &Object) -> Option<Dictionary> {
    match obj {
        Object::Dictionary(d) => Some(d.clone()),
        Object::Reference(id) => doc.get_object(*id).ok()?.as_dict().ok().cloned(),
        _ => None,
    }
}

fn dict_clone_ref(doc: &Document, obj: &Object) -> Option<Dictionary> {
    dict_clone(doc, obj)
}

fn resolve_array(doc: &Document, obj: &Object) -> Option<Vec<ObjectId>> {
    let arr = match obj {
        Object::Reference(id) => doc.get_object(*id).ok()?.as_array().ok()?,
        Object::Array(a) => a,
        _ => return None,
    };
    Some(arr.iter().filter_map(|o| o.as_reference().ok()).collect())
}

fn value_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => {
            if *b {
                "Yes".into()
            } else {
                "Off".into()
            }
        }
        Value::Array(a) => a
            .iter()
            .filter_map(|x| x.as_str())
            .collect::<Vec<_>>()
            .join(", "),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn value_on(v: &Value) -> Option<String> {
    match v {
        Value::Bool(true) => Some("Yes".into()),
        Value::Bool(false) | Value::Null => None,
        Value::String(s) if s == "Off" || s.is_empty() => None,
        Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

fn pdf_text_string(s: &str) -> Object {
    if s.is_ascii() && !s.chars().any(|c| c.is_control()) {
        Object::string_literal(s)
    } else {
        let mut bytes = vec![0xFE, 0xFF];
        for ch in s.chars() {
            let u = ch as u32;
            if u <= 0xFFFF {
                bytes.push((u >> 8) as u8);
                bytes.push(u as u8);
            } else {
                let v = u - 0x10000;
                let hi = 0xD800 + (v >> 10);
                let lo = 0xDC00 + (v & 0x3FF);
                for unit in [hi, lo] {
                    bytes.push((unit >> 8) as u8);
                    bytes.push(unit as u8);
                }
            }
        }
        Object::String(bytes, StringFormat::Hexadecimal)
    }
}

fn decode_string(obj: &Object) -> String {
    let Ok(bytes) = obj.as_str() else { return String::new() };
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let mut out = String::new();
        let mut i = 2;
        while i + 1 < bytes.len() {
            let u = u16::from_be_bytes([bytes[i], bytes[i + 1]]);
            if (0xD800..0xDC00).contains(&u) && i + 3 < bytes.len() {
                let lo = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]);
                let c = 0x10000 + ((u as u32 - 0xD800) << 10) + (lo as u32 - 0xDC00);
                if let Some(ch) = char::from_u32(c) {
                    out.push(ch);
                }
                i += 4;
            } else if let Some(ch) = char::from_u32(u as u32) {
                out.push(ch);
                i += 2;
            }
        }
        out
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

fn string_value(obj: &Object) -> Option<String> {
    match obj {
        Object::String(_, _) => Some(decode_string(obj)),
        Object::Name(n) => Some(String::from_utf8_lossy(n).to_string()),
        _ => None,
    }
}

fn escape_text(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
        .replace('\r', " ")
        .replace('\n', " ")
}

fn is_drawable_ascii(s: &str) -> bool {
    s.chars().all(|c| c.is_ascii() && (c == '\n' || c == '\r' || !c.is_control()))
}

struct CjkFontData {
    bytes: Vec<u8>,
    index: u32,
}

fn cjk_font_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(windir) = std::env::var("WINDIR") {
        let fonts = PathBuf::from(windir).join("Fonts");
        for name in ["msyh.ttc", "msyhbd.ttc", "msyhl.ttc", "simhei.ttf", "simsun.ttc", "Deng.ttf"] {
            out.push(fonts.join(name));
        }
    }
    for p in [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    ] {
        out.push(PathBuf::from(p));
    }
    out
}

fn load_cjk_font() -> Option<CjkFontData> {
    for path in cjk_font_candidates() {
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let count = ttf_parser::fonts_in_collection(&bytes).unwrap_or(1).max(1);
        for index in 0..count {
            if let Ok(face) = Face::parse(&bytes, index) {
                if face.glyph_index('中').is_some() {
                    return Some(CjkFontData { bytes, index });
                }
            }
        }
    }
    None
}

fn dict_font_size(d: &Dictionary) -> Option<f64> {
    let da = d.get(b"DA").ok()?;
    let text = match da {
        Object::String(_, _) => decode_string(da),
        Object::Name(n) => String::from_utf8_lossy(n).to_string(),
        _ => return None,
    };
    let parts: Vec<&str> = text.split_whitespace().collect();
    for i in 1..parts.len() {
        if parts[i] == "Tf" {
            if let Ok(v) = parts[i - 1].parse::<f64>() {
                if v > 0.0 {
                    return Some(v);
                }
            }
        }
    }
    None
}

fn dict_multiline(d: &Dictionary) -> bool {
    d.get(b"Ff")
        .ok()
        .and_then(|o| o.as_i64().ok())
        .map(|v| (v & 4096) != 0)
        .unwrap_or(false)
}

fn cjk_widget_text(doc: &Document, widget: &Dictionary) -> Option<(String, f64, bool)> {
    let mut node = widget;
    loop {
        if let Ok(v) = node.get(b"V") {
            if let Some(text) = string_value(v) {
                if !text.is_empty() && !is_drawable_ascii(&text) {
                    let size = dict_font_size(node).unwrap_or(12.0);
                    let multiline = dict_multiline(node);
                    return Some((text, size, multiline));
                }
            }
        }
        let parent = node.get(b"Parent").ok()?.as_reference().ok()?;
        node = doc.get_object(parent).ok()?.as_dict().ok()?;
    }
}

struct PdfPath {
    d: String,
    ox: f32,
    oy: f32,
    s: f32,
    cx: f32,
    cy: f32,
}

impl PdfPath {
    fn new(ox: f32, oy: f32, s: f32) -> Self {
        Self {
            d: String::new(),
            ox,
            oy,
            s,
            cx: 0.0,
            cy: 0.0,
        }
    }
    fn px(&self, x: f32) -> f32 {
        self.ox + x * self.s
    }
    fn py(&self, y: f32) -> f32 {
        self.oy + y * self.s
    }
}

impl OutlineBuilder for PdfPath {
    fn move_to(&mut self, x: f32, y: f32) {
        let (px, py) = (self.px(x), self.py(y));
        self.d.push_str(&format!("{px:.2} {py:.2} m\n"));
        self.cx = x;
        self.cy = y;
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let (px, py) = (self.px(x), self.py(y));
        self.d.push_str(&format!("{px:.2} {py:.2} l\n"));
        self.cx = x;
        self.cy = y;
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let c1x = self.cx + (x1 - self.cx) * 2.0 / 3.0;
        let c1y = self.cy + (y1 - self.cy) * 2.0 / 3.0;
        let c2x = x + (x1 - x) * 2.0 / 3.0;
        let c2y = y + (y1 - y) * 2.0 / 3.0;
        let (a, b) = (self.px(c1x), self.py(c1y));
        let (c, d) = (self.px(c2x), self.py(c2y));
        let (e, f) = (self.px(x), self.py(y));
        self.d
            .push_str(&format!("{a:.2} {b:.2} {c:.2} {d:.2} {e:.2} {f:.2} c\n"));
        self.cx = x;
        self.cy = y;
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (a, b) = (self.px(x1), self.py(y1));
        let (c, d) = (self.px(x2), self.py(y2));
        let (e, f) = (self.px(x), self.py(y));
        self.d
            .push_str(&format!("{a:.2} {b:.2} {c:.2} {d:.2} {e:.2} {f:.2} c\n"));
        self.cx = x;
        self.cy = y;
    }
    fn close(&mut self) {
        self.d.push_str("h\n");
    }
}

fn glyph_advance(face: &Face, ch: char, size: f64) -> f64 {
    let upem = face.units_per_em() as f64;
    let Some(gid) = face.glyph_index(ch) else { return size * 0.5 };
    face.glyph_hor_advance(gid).unwrap_or(0) as f64 * size / upem
}

fn layout_lines(face: &Face, text: &str, size: f64, max_w: f64) -> Vec<String> {
    let mut lines = Vec::new();
    for para in text.replace('\r', "").split('\n') {
        let mut line = String::new();
        let mut width = 0.0;
        for ch in para.chars() {
            let adv = glyph_advance(face, ch, size);
            if width + adv > max_w && !line.is_empty() {
                lines.push(line.trim_end().to_string());
                line.clear();
                width = 0.0;
                if ch == ' ' {
                    continue;
                }
            }
            line.push(ch);
            width += adv;
        }
        lines.push(line.trim_end().to_string());
    }
    lines
}

fn cjk_content(
    text: &str,
    rect: [f64; 4],
    size: f64,
    multiline: bool,
    face: &Face,
) -> Option<String> {
    let [x1, y1, x2, y2] = rect;
    let (x1, y1, x2, y2) = (x1.min(x2), y1.min(y2), x1.max(x2), y1.max(y2));
    let w = x2 - x1;
    let h = y2 - y1;
    if w <= 2.0 || h <= 2.0 {
        return None;
    }
    let size = size.clamp(5.0, 72.0);
    let upem = face.units_per_em() as f32;
    if upem <= 0.0 {
        return None;
    }
    let s = (size as f32) / upem;
    let asc = face.ascender() as f32 * s;
    let desc = face.descender() as f32 * s;
    let asc64 = asc as f64;
    let desc64 = desc as f64;
    let max_w = w - 6.0;
    let lines = layout_lines(face, text, size, max_w);
    let line_h = size * 1.28;
    let max_lines = if multiline {
        (((h - 6.0) / line_h).floor() as usize).max(1)
    } else {
        1
    };
    let mut baseline = if multiline {
        y2 - 3.0 - asc64
    } else {
        y1 + (h - (asc64 - desc64)) / 2.0 - desc64
    };
    let mut out = format!("q 0 0 0 rg {x1:.2} {y1:.2} {w:.2} {h:.2} re W n\n");
    for line in lines.iter().take(max_lines) {
        let mut pen = x1 + 3.0;
        for ch in line.chars() {
            if ch == ' ' {
                pen += glyph_advance(face, ch, size);
                continue;
            }
            let Some(gid) = face.glyph_index(ch) else { continue };
            let mut path = PdfPath::new(pen as f32, baseline as f32, s);
            if face.outline_glyph(gid, &mut path).is_some() && !path.d.is_empty() {
                out.push_str(&path.d);
                out.push_str("f\n");
            }
            pen += glyph_advance(face, ch, size);
        }
        baseline -= line_h;
    }
    out.push_str("% VolumaCjk\nQ\n");
    Some(out)
}

fn save_doc(doc: &mut Document, src: &Path, backup: bool) -> Result<u64, String> {
    let tmp = temp_path(src);
    doc.save(&tmp)
        .map_err(|e| format!("写入临时文件失败：{e}"))?;
    let written = std::fs::metadata(&tmp).map_err(|e| e.to_string())?.len();
    if backup {
        let bak = with_suffix(src, ".bak");
        if !bak.exists() {
            std::fs::copy(src, &bak).map_err(|e| format!("备份原文件失败：{e}"))?;
        }
    }
    std::fs::rename(&tmp, src).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("替换原文件失败：{e}")
    })?;
    Ok(written)
}

fn save_to(doc: &mut Document, dest: &Path) -> Result<u64, String> {
    let tmp = temp_path(dest);
    doc.save(&tmp)
        .map_err(|e| format!("写入临时文件失败：{e}"))?;
    let written = std::fs::metadata(&tmp).map_err(|e| e.to_string())?.len();
    std::fs::rename(&tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("保存展平文件失败：{e}")
    })?;
    Ok(written)
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

fn same_path(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn form_sample() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("assets")
            .join("M3-表单样本.pdf")
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("voluma-form-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_fields() -> Vec<FieldValue> {
        vec![
            FieldValue {
                name: "name".into(),
                kind: "text".into(),
                value: Value::String("Alice Chen".into()),
            },
            FieldValue {
                name: "agree".into(),
                kind: "checkbox".into(),
                value: Value::Bool(true),
            },
            FieldValue {
                name: "plan".into(),
                kind: "radio".into(),
                value: Value::String("Pro".into()),
            },
            FieldValue {
                name: "city".into(),
                kind: "choice".into(),
                value: Value::String("Shanghai".into()),
            },
        ]
    }

    #[test]
    fn writes_form_values_and_appearance() {
        let dir = temp_dir("values");
        let target = dir.join("form.pdf");
        std::fs::copy(form_sample(), &target).unwrap();
        let mut doc = Document::load(&target).unwrap();
        apply_values(&mut doc, &sample_fields()).unwrap();
        doc.save(&target).unwrap();
        let doc = Document::load(&target).unwrap();
        let acro = acroform_id(&doc).unwrap();
        let fields = collect_fields(&doc, acro).unwrap();
        let name = fields.iter().find(|f| f.name == "name").unwrap();
        let d = doc.get_object(name.id).unwrap().as_dict().unwrap();
        assert_eq!(string_value(d.get(b"V").unwrap()).unwrap(), "Alice Chen");
        let wd = doc
            .get_object(*name.widgets.first().unwrap())
            .unwrap()
            .as_dict()
            .unwrap();
        assert!(wd.get(b"AP").is_ok());
        let agree = fields.iter().find(|f| f.name == "agree").unwrap();
        let ad = doc.get_object(agree.id).unwrap().as_dict().unwrap();
        assert_eq!(
            ad.get(b"V").unwrap().as_name().unwrap(),
            b"Yes".as_ref()
        );
    }

    #[test]
    fn flatten_removes_form_and_keeps_values() {
        let dir = temp_dir("flatten");
        let target = dir.join("form.pdf");
        let out = dir.join("flat.pdf");
        std::fs::copy(form_sample(), &target).unwrap();
        let bytes = std::fs::read(&target).unwrap();
        let mut doc = Document::load_mem(&bytes).unwrap();
        apply_values(&mut doc, &sample_fields()).unwrap();
        flatten_doc(&mut doc).unwrap();
        doc.save(&out).unwrap();
        let doc = Document::load(&out).unwrap();
        assert!(doc.catalog().unwrap().get(b"AcroForm").is_err());
        for page_id in doc.get_pages().values() {
            let page = doc.get_object(*page_id).unwrap().as_dict().unwrap();
            if let Ok(annots) = page.get(b"Annots").and_then(|o| o.as_array()) {
                assert!(!annots.iter().any(|a| {
                    a.as_reference()
                        .ok()
                        .and_then(|id| doc.get_object(id).ok())
                        .and_then(|o| o.as_dict().ok())
                        .and_then(|d| d.get(b"Subtype").ok())
                        .and_then(|o| o.as_name().ok())
                        .map(|n| n == b"Widget")
                        .unwrap_or(false)
                }));
            }
        }
    }

    #[test]
    fn flatten_chinese_values_as_vector_text() {
        if load_cjk_font().is_none() {
            return;
        }
        let dir = temp_dir("flatten-cjk");
        let target = dir.join("form.pdf");
        let out = dir.join("flat.pdf");
        std::fs::copy(form_sample(), &target).unwrap();
        let bytes = std::fs::read(&target).unwrap();
        let mut doc = Document::load_mem(&bytes).unwrap();
        apply_values(
            &mut doc,
            &[
                FieldValue {
                    name: "name".into(),
                    kind: "text".into(),
                    value: Value::String("方小明".into()),
                },
                FieldValue {
                    name: "notes".into(),
                    kind: "text".into(),
                    value: Value::String("第一行备注\n第二行备注".into()),
                },
            ],
        )
        .unwrap();
        flatten_doc(&mut doc).unwrap();
        doc.save(&out).unwrap();
        let doc = Document::load(&out).unwrap();
        assert!(doc.catalog().unwrap().get(b"AcroForm").is_err());
        let mut vector = false;
        for page_id in doc.get_pages().values() {
            let page = doc.get_object(*page_id).unwrap().as_dict().unwrap();
            for id in content_list(&doc, page)
                .iter()
                .filter_map(|o| o.as_reference().ok())
            {
                if let Ok(o) = doc.get_object(id) {
                    if let Ok(s) = o.as_stream() {
                        if String::from_utf8_lossy(&s.content).contains("% VolumaCjk") {
                            vector = true;
                        }
                    }
                }
            }
        }
        assert!(vector, "中文展平应写入矢量字形");
    }

    #[test]
    fn rejects_pdf_without_form() {
        let dir = temp_dir("empty");
        let target = dir.join("sample.pdf");
        std::fs::copy(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("assets")
                .join("M0-阅读样本.pdf"),
            &target,
        )
        .unwrap();
        let bytes = std::fs::read(&target).unwrap();
        let mut doc = Document::load_mem(&bytes).unwrap();
        let err = apply_values(&mut doc, &sample_fields()).unwrap_err();
        assert!(err.contains("没有"));
    }
}

