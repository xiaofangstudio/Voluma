use flate2::write::ZlibEncoder;
use flate2::Compression;
use image::GenericImageView;
use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertAt {
    /// 最终页序里的插入位置，0 表示插到最前
    pub index: usize,
    /// "pdf" 或 "image"
    pub kind: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagePlan {
    /// 保留页的原页号，按新顺序排列
    pub order: Vec<u32>,
    /// 原页号 -> 追加旋转角度（90 / -90 / 180）
    pub rotations: BTreeMap<u32, i32>,
    #[serde(default)]
    pub inserts: Vec<InsertAt>,
}

#[derive(Debug, Serialize)]
pub struct PageResult {
    pub pages: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitRequest {
    /// "chunk" 按每份页数拆，或 "ranges" 按用户给的区间拆
    #[serde(default)]
    pub mode: String,
    #[serde(default = "default_chunk")]
    pub chunk: usize,
    #[serde(default)]
    pub ranges: Vec<String>,
    #[serde(default)]
    pub dest_dir: Option<String>,
    #[serde(default)]
    pub prefix: Option<String>,
}

fn default_chunk() -> usize {
    1
}

#[derive(Debug, Serialize)]
pub struct SplitFile {
    pub path: String,
    pub pages: usize,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct SplitResult {
    pub files: Vec<SplitFile>,
    pub pages: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CropRequest {
    pub dest: String,
    #[serde(default)]
    pub pages: Vec<u32>,
    /// 视觉方向的上 / 右 / 下 / 左，单位毫米
    #[serde(default)]
    pub margins: [f64; 4],
    #[serde(default)]
    pub reset_crop: bool,
}

/// 解析 "1-3,5" / "1、3-5" 这类页码范围，返回 1-based 页号（已去重、保留顺序）。
pub fn parse_page_ranges(spec: &str, total: usize) -> Result<Vec<u32>, String> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    let normalized = spec.replace(['，', '、'], ",");
    for raw in normalized.split([',', ' ', '\n', '\r', '\t']) {
        let part = raw.trim();
        if part.is_empty() {
            continue;
        }
        let (start, end) = match part.split_once('-') {
            Some((a, b)) => (
                a.trim()
                    .parse::<u32>()
                    .map_err(|_| format!("页码「{part}」不是有效数字"))?,
                b.trim()
                    .parse::<u32>()
                    .map_err(|_| format!("页码「{part}」不是有效数字"))?,
            ),
            None => {
                let n = part
                    .parse::<u32>()
                    .map_err(|_| format!("页码「{part}」不是有效数字"))?;
                (n, n)
            }
        };
        if start == 0 || end == 0 {
            return Err("页码从 1 开始".into());
        }
        if start > end {
            return Err(format!("页码范围「{part}」起点大于终点"));
        }
        if end as usize > total {
            return Err(format!(
                "第 {end} 页不存在（本文档共 {total} 页）"
            ));
        }
        for n in start..=end {
            if seen.insert(n) {
                out.push(n);
            }
        }
    }
    if out.is_empty() {
        return Err("没有有效页码".into());
    }
    Ok(out)
}

#[tauri::command]
pub fn document_page_count(path: String) -> Result<usize, String> {
    let doc = load_doc(&path)?;
    let pages = doc.get_pages().len();
    if pages == 0 {
        return Err("这个 PDF 没有页面".into());
    }
    Ok(pages)
}

#[tauri::command]
pub fn apply_page_plan(
    path: String,
    plan: String,
    backup: bool,
) -> Result<PageResult, String> {
    let parsed: PagePlan =
        serde_json::from_str(&plan).map_err(|e| format!("页面操作参数不合法：{e}"))?;
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("原文件不存在，无法保存".into());
    }
    let bytes = std::fs::read(&src).map_err(|e| format!("读取原文件失败：{e}"))?;
    let mut doc = Document::load_mem(&bytes).map_err(|e| format!("解析 PDF 失败：{e}"))?;

    let pages = doc.get_pages();
    if pages.is_empty() {
        return Err("这个 PDF 没有页面".into());
    }
    if parsed.order.is_empty() {
        return Err("不能把所有页面都删掉".into());
    }
    let mut seen = BTreeSet::new();
    for n in &parsed.order {
        if !pages.contains_key(n) {
            return Err(format!("第 {n} 页不存在"));
        }
        if !seen.insert(*n) {
            return Err(format!("第 {n} 页重复出现"));
        }
    }
    for n in parsed.rotations.keys() {
        if !pages.contains_key(n) {
            return Err(format!("要旋转的第 {n} 页不存在"));
        }
    }

    let root = pages_root(&doc)?;
    let mut final_ids: Vec<ObjectId> = parsed
        .order
        .iter()
        .map(|n| pages[n])
        .collect();

    // 先按最终坐标插外部页，再统一写页面树
    for item in &parsed.inserts {
        let at = item.index.min(final_ids.len());
        let added = match item.kind.as_str() {
            "pdf" => import_pdf_pages(&mut doc, root, &item.path, at)?,
            "image" => vec![add_image_page(&mut doc, root, &item.path)?],
            other => return Err(format!("不支持的插入类型：{other}")),
        };
        for (offset, id) in added.into_iter().enumerate() {
            final_ids.insert(at + offset, id);
        }
    }

    // 保留页补全继承属性，并把旋转写成显式值
    for n in &parsed.order {
        let delta = parsed.rotations.get(n).copied().unwrap_or(0);
        prepare_page(&mut doc, pages[n], delta)?;
    }

    // 被删掉的页：移除页面对象及其直接注释，内容流留给其他共享对象
    let kept: BTreeSet<ObjectId> = parsed.order.iter().map(|n| pages[n]).collect();
    for (n, id) in &pages {
        if !kept.contains(id) {
            remove_page_annotations(&mut doc, *id);
            doc.delete_object(*id);
            let _ = n;
        }
    }

    set_page_tree(&mut doc, root, &final_ids)?;
    let written = save_doc(&mut doc, &src, backup)?;
    Ok(PageResult {
        pages: final_ids.len(),
        bytes: written,
    })
}

#[tauri::command]
pub fn extract_pages(path: String, pages: Vec<u32>, dest: String) -> Result<PageResult, String> {
    let src = Path::new(&path);
    if !src.is_file() {
        return Err("原文件不存在".into());
    }
    let out = PathBuf::from(&dest);
    if same_path(src, &out) {
        return Err("提取目标不能和原文件是同一个文件".into());
    }
    let doc = load_doc(&path)?;
    let all = doc.get_pages();
    if pages.is_empty() {
        return Err("没有选择要提取的页面".into());
    }
    let mut seen = BTreeSet::new();
    for n in &pages {
        if !all.contains_key(n) {
            return Err(format!("第 {n} 页不存在"));
        }
        if !seen.insert(*n) {
            return Err(format!("第 {n} 页重复选择"));
        }
    }

    let mut out_doc = doc.clone();
    let ids: Vec<ObjectId> = seen.iter().map(|n| all[n]).collect();
    for id in &ids {
        prepare_page(&mut out_doc, *id, 0)?;
    }
    let root = pages_root(&out_doc)?;
    set_page_tree(&mut out_doc, root, &ids)?;

    // 提取件不保留指向缺失页的大纲和表单
    if let Some(catalog) = catalog_dict_mut(&mut out_doc) {
        catalog.remove(b"Outlines");
        catalog.remove(b"PageMode");
        catalog.remove(b"AcroForm");
        catalog.remove(b"PageLabels");
    }

    out_doc
        .save(&out)
        .map_err(|e| format!("写入提取文件失败：{e}"))?;
    let bytes = std::fs::metadata(&out).map_err(|e| e.to_string())?.len();
    Ok(PageResult {
        pages: ids.len(),
        bytes,
    })
}

/// 把多个 PDF 按顺序合并成一个新文件，原件一个都不改。
#[tauri::command]
pub fn merge_documents(inputs: Vec<String>, dest: String) -> Result<PageResult, String> {
    if inputs.len() < 2 {
        return Err("至少选择两个 PDF 才能合并".into());
    }
    let out = PathBuf::from(&dest);
    if out.as_os_str().is_empty() {
        return Err("没有选择保存位置".into());
    }
    if out
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("pdf"))
        != Some(true)
    {
        return Err("合并结果必须是 .pdf 文件".into());
    }
    for path in &inputs {
        let p = Path::new(path);
        if !p.is_file() {
            return Err(format!("找不到要合并的文件：{path}"));
        }
        if same_path(p, &out) {
            return Err("合并结果不能覆盖参与合并的原文件".into());
        }
    }

    let mut doc = load_doc(&inputs[0])?;
    let root = pages_root(&doc)?;
    let first = doc.get_pages();
    if first.is_empty() {
        return Err("第一个 PDF 没有页面".into());
    }
    let mut ids: Vec<ObjectId> = first.values().copied().collect();
    let mut map: BTreeMap<(usize, ObjectId), ObjectId> = BTreeMap::new();

    for (index, path) in inputs.iter().enumerate().skip(1) {
        let ext = load_doc(path)?;
        let pages = ext.get_pages();
        if pages.is_empty() {
            return Err(format!("{} 没有页面", file_label(path)));
        }
        for (_, page_id) in pages {
            ids.push(import_page(
                &ext,
                &mut doc,
                page_id,
                root,
                index,
                &mut map,
            )?);
        }
    }

    strip_document_tree(&mut doc);
    set_page_tree(&mut doc, root, &ids)?;
    let bytes = save_new_doc(&mut doc, &out)?;
    Ok(PageResult {
        pages: ids.len(),
        bytes,
    })
}

/// 拆分当前 PDF：按每份页数，或按 "1-3,5" 这样的多段区间，输出到原目录。
#[tauri::command]
pub fn split_document(path: String, request: String) -> Result<SplitResult, String> {
    let req: SplitRequest =
        serde_json::from_str(&request).map_err(|e| format!("拆分参数不合法：{e}"))?;
    let src = Path::new(&path);
    if !src.is_file() {
        return Err("原文件不存在".into());
    }
    let doc = load_doc(&path)?;
    let all = doc.get_pages();
    let total = all.len();
    if total == 0 {
        return Err("这个 PDF 没有页面".into());
    }

    let groups: Vec<Vec<u32>> = if req.mode == "ranges" {
        if req.ranges.is_empty() {
            return Err("没有填写拆分区间".into());
        }
        let mut groups = Vec::new();
        for spec in &req.ranges {
            let pages = parse_page_ranges(spec, total)?;
            if !pages.is_empty() {
                groups.push(pages);
            }
        }
        groups
    } else {
        let chunk = req.chunk.max(1);
        let mut groups = Vec::new();
        let mut start = 1u32;
        while start <= total as u32 {
            let end = (start + chunk as u32 - 1).min(total as u32);
            groups.push((start..=end).collect());
            start = end + 1;
        }
        groups
    };
    if groups.is_empty() {
        return Err("没有可拆分的页面".into());
    }

    let dest_dir = match req.dest_dir.as_deref() {
        Some(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => src.parent().unwrap_or(Path::new(".")).to_path_buf(),
    };
    if !dest_dir.is_dir() {
        return Err(format!("输出目录不存在：{}", dest_dir.display()));
    }
    let prefix = req
        .prefix
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| safe_stem(s))
        .unwrap_or_else(|| {
            safe_stem(
                src.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("document"),
            )
        });

    let mut files = Vec::with_capacity(groups.len());
    for group in groups {
        for n in &group {
            if !all.contains_key(n) {
                return Err(format!("第 {n} 页不存在"));
            }
        }
        let mut part = doc.clone();
        let ids: Vec<ObjectId> = group.iter().map(|n| all[n]).collect();
        let root = pages_root(&part)?;
        for id in &ids {
            prepare_page(&mut part, *id, 0)?;
        }
        strip_document_tree(&mut part);
        set_page_tree(&mut part, root, &ids)?;

        let first = group.first().copied().unwrap_or(1);
        let last = group.last().copied().unwrap_or(first);
        let out = unique_path(
            &dest_dir,
            &prefix,
            if first == last {
                format!("{first}")
            } else {
                format!("{first}-{last}")
            },
        );
        part.save(&out)
            .map_err(|e| format!("写入拆分文件失败：{e}"))?;
        let bytes = std::fs::metadata(&out).map_err(|e| e.to_string())?.len();
        files.push(SplitFile {
            path: out.to_string_lossy().to_string(),
            pages: ids.len(),
            bytes,
        });
    }

    Ok(SplitResult { files, pages: total })
}

/// 按视觉方向四边内缩裁切，生成新文件；pages 为空表示全部页。
#[tauri::command]
pub fn crop_pages(path: String, request: String) -> Result<PageResult, String> {
    let req: CropRequest =
        serde_json::from_str(&request).map_err(|e| format!("裁切参数不合法：{e}"))?;
    let src = Path::new(&path);
    if !src.is_file() {
        return Err("原文件不存在".into());
    }
    let out = PathBuf::from(&req.dest);
    if same_path(src, &out) {
        return Err("裁切结果不能覆盖原文件".into());
    }
    if !out
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
    {
        return Err("裁切结果必须是 .pdf 文件".into());
    }
    if req.margins.iter().any(|m| !m.is_finite() || *m < 0.0) {
        return Err("裁切边距不能是负数".into());
    }
    if !req.reset_crop
        && req.margins.iter().all(|m| *m <= 0.0001)
    {
        return Err("请至少设置一边裁切边距".into());
    }

    let mut doc = load_doc(&path)?;
    let all = doc.get_pages();
    if all.is_empty() {
        return Err("这个 PDF 没有页面".into());
    }
    let targets: Vec<u32> = if req.pages.is_empty() {
        all.keys().copied().collect()
    } else {
        let mut seen = BTreeSet::new();
        for n in &req.pages {
            if !all.contains_key(n) {
                return Err(format!("第 {n} 页不存在"));
            }
            if !seen.insert(*n) {
                return Err(format!("第 {n} 页重复选择"));
            }
        }
        seen.into_iter().collect()
    };

    let mm = 72.0 / 25.4;
    for n in &targets {
        crop_one_page(&mut doc, all[n], &req.margins, req.reset_crop, mm)?;
    }
    let bytes = save_new_doc(&mut doc, &out)?;
    Ok(PageResult {
        pages: targets.len(),
        bytes,
    })
}

fn crop_one_page(
    doc: &mut Document,
    page_id: ObjectId,
    margins: &[f64; 4],
    reset: bool,
    mm: f64,
) -> Result<(), String> {
    let media = effective_box(doc, page_id, b"MediaBox")
        .ok_or_else(|| "页面缺少有效的 MediaBox，无法裁切".to_string())?;
    let base = if reset {
        media
    } else {
        effective_box(doc, page_id, b"CropBox").unwrap_or(media)
    };
    let rotation = normalized_rotation(doc, page_id);
    let (top, right, bottom, left) = rotate_margins(rotation, margins);

    let x0 = base[0] + left * mm;
    let x1 = base[2] - right * mm;
    let y0 = base[1] + bottom * mm;
    let y1 = base[3] - top * mm;
    if x1 - x0 < 18.0 || y1 - y0 < 18.0 {
        return Err("裁切后页面小于 18pt，边距太大了".into());
    }
    let (mut nx0, mut ny0, mut nx1, mut ny1) = (x0, y0, x1, y1);
    nx0 = nx0.max(media[0]);
    ny0 = ny0.max(media[1]);
    nx1 = nx1.min(media[2]);
    ny1 = ny1.min(media[3]);
    if nx1 - nx0 < 18.0 || ny1 - ny0 < 18.0 {
        return Err("裁切后页面小于 18pt，边距太大了".into());
    }

    let page = doc
        .get_object_mut(page_id)
        .map_err(|_| "找不到页面对象".to_string())?
        .as_dict_mut()
        .map_err(|_| "页面不是字典".to_string())?;
    page.set(
        "CropBox",
        Object::Array(vec![
            Object::Real(nx0 as f32),
            Object::Real(ny0 as f32),
            Object::Real(nx1 as f32),
            Object::Real(ny1 as f32),
        ]),
    );
    Ok(())
}

fn effective_box(doc: &Document, page_id: ObjectId, key: &[u8]) -> Option<[f64; 4]> {
    let obj = inherited(doc, page_id, key)?;
    let arr = obj.as_array().ok()?;
    if arr.len() < 4 {
        return None;
    }
    let mut v = [0.0; 4];
    for (i, item) in arr.iter().take(4).enumerate() {
        v[i] = match item {
            Object::Real(f) => *f as f64,
            Object::Integer(n) => *n as f64,
            _ => return None,
        };
    }
    Some([
        v[0].min(v[2]),
        v[1].min(v[3]),
        v[0].max(v[2]),
        v[1].max(v[3]),
    ])
}

fn normalized_rotation(doc: &Document, page_id: ObjectId) -> i32 {
    let raw = inherited(doc, page_id, b"Rotate")
        .and_then(|o| o.as_i64().ok())
        .unwrap_or(0);
    (((raw % 360) + 360) % 360) as i32
}

/// 把「视觉方向」的四边内缩换算成未旋转 PDF 坐标的四边内缩。
fn rotate_margins(rotation: i32, margins: &[f64; 4]) -> (f64, f64, f64, f64) {
    let [top, right, bottom, left] = *margins;
    match rotation {
        90 => (right, bottom, left, top),
        180 => (bottom, left, top, right),
        270 => (left, top, right, bottom),
        _ => (top, right, bottom, left),
    }
}

fn strip_document_tree(doc: &mut Document) {
    if let Some(catalog) = catalog_dict_mut(doc) {
        for key in [
            &b"Outlines"[..],
            &b"PageLabels"[..],
            &b"AcroForm"[..],
            &b"OpenAction"[..],
            &b"StructTreeRoot"[..],
            &b"Names"[..],
            &b"Dests"[..],
        ] {
            catalog.remove(key);
        }
    }
}

fn safe_stem(input: &str) -> String {
    let cleaned: String = input
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "document".into()
    } else {
        trimmed.into()
    }
}

fn unique_path(dir: &Path, prefix: &str, tag: String) -> PathBuf {
    let base = dir.join(format!("{prefix}-{tag}.pdf"));
    if !base.exists() {
        return base;
    }
    for i in 2..1000 {
        let candidate = dir.join(format!("{prefix}-{tag} ({i}).pdf"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{prefix}-{tag}-{}.pdf", std::process::id()))
}

fn file_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

fn save_new_doc(doc: &mut Document, dest: &Path) -> Result<u64, String> {
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(format!("输出目录不存在：{}", parent.display()));
        }
    }
    let tmp = temp_path(dest);
    doc.save(&tmp)
        .map_err(|e| format!("写入临时文件失败：{e}"))?;
    let written = std::fs::metadata(&tmp).map_err(|e| e.to_string())?.len();
    std::fs::rename(&tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("写入结果文件失败：{e}")
    })?;
    Ok(written)
}

fn load_doc(path: &str) -> Result<Document, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取原文件失败：{e}"))?;
    Document::load_mem(&bytes).map_err(|e| format!("解析 PDF 失败：{e}"))
}

fn pages_root(doc: &Document) -> Result<ObjectId, String> {
    let catalog_id = doc
        .trailer
        .get(b"Root")
        .ok()
        .and_then(|o| o.as_reference().ok())
        .ok_or_else(|| "找不到 PDF 目录对象".to_string())?;
    let catalog = doc
        .get_object(catalog_id)
        .map_err(|_| "找不到 PDF 目录对象".to_string())?
        .as_dict()
        .map_err(|_| "PDF 目录不是字典".to_string())?;
    let pages = catalog
        .get(b"Pages")
        .map_err(|_| "找不到页面树".to_string())?
        .as_reference()
        .map_err(|_| "页面树不是引用".to_string())?;
    let root = doc
        .get_object(pages)
        .map_err(|_| "找不到页面树对象".to_string())?
        .as_dict()
        .map_err(|_| "页面树不是字典".to_string())?;
    if root.get(b"Type").ok().and_then(|o| o.as_name().ok()) != Some(b"Pages".as_ref()) {
        return Err("页面树类型不正确".into());
    }
    Ok(pages)
}

fn catalog_dict_mut(doc: &mut Document) -> Option<&mut Dictionary> {
    let catalog_id = doc
        .trailer
        .get(b"Root")
        .ok()
        .and_then(|o| o.as_reference().ok())?;
    doc.get_object_mut(catalog_id).ok()?.as_dict_mut().ok()
}

fn inherited(doc: &Document, page_id: ObjectId, key: &[u8]) -> Option<Object> {
    let mut current = page_id;
    for _ in 0..64 {
        let dict = doc.get_object(current).ok()?.as_dict().ok()?;
        if let Ok(v) = dict.get(key) {
            return Some(v.clone());
        }
        match dict.get(b"Parent").ok()? {
            Object::Reference(id) => current = *id,
            _ => return None,
        }
    }
    None
}

fn prepare_page(doc: &mut Document, page_id: ObjectId, delta: i32) -> Result<(), String> {
    let mut copies: Vec<(&[u8], Object)> = Vec::new();
    for key in [
        &b"Resources"[..],
        &b"MediaBox"[..],
        &b"CropBox"[..],
        &b"UserUnit"[..],
    ] {
        let has = doc
            .get_object(page_id)
            .map_err(|_| "找不到页面对象".to_string())?
            .as_dict()
            .map_err(|_| "页面不是字典".to_string())?
            .get(key)
            .is_ok();
        if !has {
            if let Some(v) = inherited(doc, page_id, key) {
                copies.push((key, v));
            }
        }
    }

    let rotation = inherited(doc, page_id, b"Rotate")
        .and_then(|o| o.as_i64().ok())
        .unwrap_or(0);
    let next = if delta == 0 {
        None
    } else {
        Some(((rotation + delta as i64) % 360 + 360) % 360)
    };

    let page = doc
        .get_object_mut(page_id)
        .map_err(|_| "找不到页面对象".to_string())?
        .as_dict_mut()
        .map_err(|_| "页面不是字典".to_string())?;
    for (key, v) in copies {
        page.set(key, v);
    }
    if let Some(rot) = next {
        page.set("Rotate", Object::Integer(rot));
    }
    Ok(())
}

fn set_page_tree(doc: &mut Document, root: ObjectId, ids: &[ObjectId]) -> Result<(), String> {
    {
        let node = doc
            .get_object_mut(root)
            .map_err(|_| "找不到页面树对象".to_string())?
            .as_dict_mut()
            .map_err(|_| "页面树不是字典".to_string())?;
        node.set(
            "Kids",
            Object::Array(ids.iter().map(|id| Object::Reference(*id)).collect()),
        );
        node.set("Count", Object::Integer(ids.len() as i64));
    }
    // 把所有页的 Parent 指回根节点；否则提取 / 合并后仍指向旧中间节点。
    for id in ids {
        if let Ok(obj) = doc.get_object_mut(*id) {
            if let Ok(page) = obj.as_dict_mut() {
                page.set("Parent", Object::Reference(root));
            }
        }
    }
    Ok(())
}

fn remove_page_annotations(doc: &mut Document, page_id: ObjectId) {
    let refs: Vec<ObjectId> = doc
        .get_object(page_id)
        .ok()
        .and_then(|o| o.as_dict().ok())
        .and_then(|d| d.get(b"Annots").ok())
        .map(|obj| match obj {
            Object::Array(items) => items
                .iter()
                .filter_map(|o| o.as_reference().ok())
                .collect(),
            Object::Reference(id) => doc
                .get_object(*id)
                .ok()
                .and_then(|o| o.as_array().ok())
                .map(|a| a.iter().filter_map(|o| o.as_reference().ok()).collect())
                .unwrap_or_default(),
            _ => Vec::new(),
        })
        .unwrap_or_default();
    for id in refs {
        doc.delete_object(id);
    }
}

fn import_pdf_pages(
    doc: &mut Document,
    root: ObjectId,
    path: &str,
    at: usize,
) -> Result<Vec<ObjectId>, String> {
    let ext = load_doc(path)?;
    let pages = ext.get_pages();
    if pages.is_empty() {
        return Err("要插入的 PDF 没有页面".into());
    }
    let mut map: BTreeMap<(usize, ObjectId), ObjectId> = BTreeMap::new();
    let mut ids = Vec::with_capacity(pages.len());
    for (_, page_id) in pages {
        ids.push(import_page(&ext, doc, page_id, root, 0, &mut map)?);
    }
    let _ = at;
    Ok(ids)
}

fn import_page(
    src: &Document,
    dst: &mut Document,
    page_id: ObjectId,
    root: ObjectId,
    src_index: usize,
    map: &mut BTreeMap<(usize, ObjectId), ObjectId>,
) -> Result<ObjectId, String> {
    if let Some(existing) = map.get(&(src_index, page_id)) {
        return Ok(*existing);
    }
    let mut dict = src
        .get_object(page_id)
        .map_err(|_| "插入 PDF 的页面对象缺失".to_string())?
        .as_dict()
        .map_err(|_| "插入 PDF 的页面不是字典".to_string())?
        .clone();
    dict.remove(b"Parent");

    let new_id = dst.add_object(Object::Null);
    map.insert((src_index, page_id), new_id);
    let mut obj = Object::Dictionary(dict);
    copy_value(src, dst, &mut obj, src_index, map)?;
    dst.set_object(new_id, obj);
    let page = dst
        .get_object_mut(new_id)
        .map_err(|_| "插入页面失败".to_string())?
        .as_dict_mut()
        .map_err(|_| "插入页面不是字典".to_string())?;
    page.set("Parent", Object::Reference(root));
    Ok(new_id)
}

fn copy_value(
    src: &Document,
    dst: &mut Document,
    value: &mut Object,
    src_index: usize,
    map: &mut BTreeMap<(usize, ObjectId), ObjectId>,
) -> Result<(), String> {
    match value {
        Object::Reference(id) => {
            let new_id = copy_ref(src, dst, *id, src_index, map)?;
            *value = Object::Reference(new_id);
        }
        Object::Dictionary(dict) => {
            for (_, v) in dict.iter_mut() {
                copy_value(src, dst, v, src_index, map)?;
            }
        }
        Object::Array(items) => {
            for v in items.iter_mut() {
                copy_value(src, dst, v, src_index, map)?;
            }
        }
        Object::Stream(stream) => {
            for (_, v) in stream.dict.iter_mut() {
                copy_value(src, dst, v, src_index, map)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn copy_ref(
    src: &Document,
    dst: &mut Document,
    id: ObjectId,
    src_index: usize,
    map: &mut BTreeMap<(usize, ObjectId), ObjectId>,
) -> Result<ObjectId, String> {
    if let Some(existing) = map.get(&(src_index, id)) {
        return Ok(*existing);
    }
    let mut obj = src
        .get_object(id)
        .map_err(|_| format!("插入对象 {} {} 缺失", id.0, id.1))?
        .clone();
    let new_id = dst.add_object(Object::Null);
    map.insert((src_index, id), new_id);
    copy_value(src, dst, &mut obj, src_index, map)?;
    dst.set_object(new_id, obj);
    Ok(new_id)
}

fn add_image_page(doc: &mut Document, root: ObjectId, path: &str) -> Result<ObjectId, String> {
    let img = image::open(path).map_err(|e| format!("读不了这张图片：{e}"))?;
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return Err("图片尺寸为 0".into());
    }
    let rgb = img.to_rgb8();
    let raw = rgb.as_raw();
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
    enc.write_all(raw)
        .map_err(|e| format!("压缩图片失败：{e}"))?;
    let data = enc.finish().map_err(|e| format!("压缩图片失败：{e}"))?;

    let mut image_dict = Dictionary::new();
    image_dict.set("Type", "XObject");
    image_dict.set("Subtype", "Image");
    image_dict.set("Width", Object::Integer(w as i64));
    image_dict.set("Height", Object::Integer(h as i64));
    image_dict.set("ColorSpace", "DeviceRGB");
    image_dict.set("BitsPerComponent", Object::Integer(8));
    image_dict.set("Filter", "FlateDecode");
    image_dict.set("Length", Object::Integer(data.len() as i64));
    let image_id = doc.add_object(Object::Stream(Stream::new(image_dict, data)));

    let portrait = h >= w;
    let (pw, ph) = if portrait {
        (595.28, 841.89)
    } else {
        (841.89, 595.28)
    };
    let scale = ((pw - 48.0) / w as f64).min((ph - 48.0) / h as f64);
    let dw = w as f64 * scale;
    let dh = h as f64 * scale;
    let x = (pw - dw) / 2.0;
    let y = (ph - dh) / 2.0;
    let content = format!("q {dw:.3} 0 0 {dh:.3} {x:.3} {y:.3} cm /Im0 Do Q");
    let content_id = doc.add_object(Object::Stream(Stream::new(
        {
            let mut d = Dictionary::new();
            d.set("Length", Object::Integer(content.len() as i64));
            d
        },
        content.into_bytes(),
    )));

    let mut xobjects = Dictionary::new();
    xobjects.set("Im0", Object::Reference(image_id));
    let mut resources = Dictionary::new();
    resources.set("XObject", Object::Dictionary(xobjects));

    let mut page = Dictionary::new();
    page.set("Type", "Page");
    page.set("Parent", Object::Reference(root));
    page.set(
        "MediaBox",
        Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(pw as f32),
            Object::Real(ph as f32),
        ]),
    );
    page.set("Resources", Object::Dictionary(resources));
    page.set("Contents", Object::Reference(content_id));
    Ok(doc.add_object(Object::Dictionary(page)))
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

    fn sample() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("assets")
            .join("M0-阅读样本.pdf")
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("voluma-pages-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn deletes_and_reorders_pages() {
        let dir = temp_dir("reorder");
        let target = dir.join("doc.pdf");
        std::fs::copy(sample(), &target).unwrap();
        let plan = PagePlan {
            order: vec![5, 1, 3, 2],
            rotations: BTreeMap::from([(3, 90)]),
            inserts: vec![],
        };
        apply_page_plan(
            target.to_string_lossy().to_string(),
            serde_json::to_string(&plan).unwrap(),
            true,
        )
        .unwrap();
        let doc = Document::load(&target).unwrap();
        let pages = doc.get_pages();
        assert_eq!(pages.len(), 4);
        let rotated = doc.get_object(pages[&3]).unwrap().as_dict().unwrap();
        assert_eq!(rotated.get(b"Rotate").unwrap().as_i64().unwrap(), 90);
        assert!(dir.join("doc.pdf.bak").exists());
    }

    #[test]
    fn extracts_selected_pages() {
        let dir = temp_dir("extract");
        let out = dir.join("part.pdf");
        let res = extract_pages(
            sample().to_string_lossy().to_string(),
            vec![2, 4],
            out.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(res.pages, 2);
        let doc = Document::load(&out).unwrap();
        assert_eq!(doc.get_pages().len(), 2);
    }

    #[test]
    fn inserts_pdf_pages() {
        let dir = temp_dir("insertpdf");
        let target = dir.join("doc.pdf");
        std::fs::copy(sample(), &target).unwrap();
        let plan = PagePlan {
            order: vec![1, 2, 3, 4, 5],
            rotations: BTreeMap::new(),
            inserts: vec![InsertAt {
                index: 2,
                kind: "pdf".into(),
                path: sample().to_string_lossy().to_string(),
            }],
        };
        let res = apply_page_plan(
            target.to_string_lossy().to_string(),
            serde_json::to_string(&plan).unwrap(),
            false,
        )
        .unwrap();
        assert_eq!(res.pages, 10);
        let doc = Document::load(&target).unwrap();
        assert_eq!(doc.get_pages().len(), 10);
    }

    #[test]
    fn inserts_image_page() {
        let dir = temp_dir("insertimg");
        let png = dir.join("dot.png");
        let img = image::RgbImage::from_pixel(40, 20, image::Rgb([24, 100, 180]));
        img.save(&png).unwrap();
        let target = dir.join("doc.pdf");
        std::fs::copy(sample(), &target).unwrap();
        let plan = PagePlan {
            order: vec![1, 2, 3, 4, 5],
            rotations: BTreeMap::new(),
            inserts: vec![InsertAt {
                index: 0,
                kind: "image".into(),
                path: png.to_string_lossy().to_string(),
            }],
        };
        let res = apply_page_plan(
            target.to_string_lossy().to_string(),
            serde_json::to_string(&plan).unwrap(),
            false,
        )
        .unwrap();
        assert_eq!(res.pages, 6);
        let doc = Document::load(&target).unwrap();
        let pages = doc.get_pages();
        let first = doc.get_object(pages[&1]).unwrap().as_dict().unwrap();
        assert!(first.get(b"Resources").unwrap().as_dict().unwrap().has(b"XObject"));
    }

    #[test]
    fn rejects_empty_page_plan() {
        let dir = temp_dir("empty");
        let target = dir.join("doc.pdf");
        std::fs::copy(sample(), &target).unwrap();
        let plan = PagePlan {
            order: vec![],
            rotations: BTreeMap::new(),
            inserts: vec![],
        };
        let err = apply_page_plan(
            target.to_string_lossy().to_string(),
            serde_json::to_string(&plan).unwrap(),
            false,
        )
        .unwrap_err();
        assert!(err.contains("删掉"));
    }

    #[test]
    fn parses_page_ranges_and_rejects_bad_input() {
        let pages = parse_page_ranges("1-3, 5、7", 8).unwrap();
        assert_eq!(pages, vec![1, 2, 3, 5, 7]);
        assert!(parse_page_ranges("0-2", 8).is_err());
        assert!(parse_page_ranges("5-2", 8).is_err());
        assert!(parse_page_ranges("9", 8).is_err());
        assert!(parse_page_ranges("abc", 8).is_err());
        assert!(parse_page_ranges("", 8).is_err());
    }

    #[test]
    fn merges_two_documents_in_order() {
        let dir = temp_dir("merge");
        let out = dir.join("all.pdf");
        let res = merge_documents(
            vec![
                sample().to_string_lossy().to_string(),
                sample().to_string_lossy().to_string(),
            ],
            out.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(res.pages, 10);
        let doc = Document::load(&out).unwrap();
        assert_eq!(doc.get_pages().len(), 10);
        let root = pages_root(&doc).unwrap();
        for (_, page_id) in doc.get_pages() {
            let page = doc.get_object(page_id).unwrap().as_dict().unwrap();
            assert_eq!(
                page.get(b"Parent").unwrap().as_reference().unwrap(),
                root,
                "合并后页面的 Parent 必须指回页面树根"
            );
        }
        let mut copy = doc.clone();
        let catalog = catalog_dict_mut(&mut copy).unwrap();
        assert!(catalog.get(b"AcroForm").is_err(), "合并件应清掉跨页表单树");
    }

    #[test]
    fn splits_by_chunk_without_overwriting_source() {
        let dir = temp_dir("split-chunk");
        let target = dir.join("doc.pdf");
        std::fs::copy(sample(), &target).unwrap();
        let req = SplitRequest {
            mode: "chunk".into(),
            chunk: 2,
            ranges: vec![],
            dest_dir: Some(dir.to_string_lossy().to_string()),
            prefix: Some("part".into()),
        };
        let res = split_document(
            target.to_string_lossy().to_string(),
            serde_json::to_string(&req).unwrap(),
        )
        .unwrap();
        assert_eq!(res.pages, 5);
        assert_eq!(res.files.len(), 3);
        assert_eq!(
            res.files.iter().map(|f| f.pages).collect::<Vec<_>>(),
            vec![2, 2, 1]
        );
        for f in &res.files {
            assert!(Path::new(&f.path).is_file());
            let doc = Document::load(&f.path).unwrap();
            assert_eq!(doc.get_pages().len(), f.pages);
        }
        assert_eq!(
            std::fs::metadata(&target).unwrap().len(),
            std::fs::metadata(sample()).unwrap().len(),
            "拆分不能改动原文件"
        );
    }

    #[test]
    fn splits_by_custom_ranges() {
        let dir = temp_dir("split-ranges");
        let target = dir.join("doc.pdf");
        std::fs::copy(sample(), &target).unwrap();
        let req = SplitRequest {
            mode: "ranges".into(),
            chunk: 1,
            ranges: vec!["1-2".into(), "4".into()],
            dest_dir: Some(dir.to_string_lossy().to_string()),
            prefix: Some("piece".into()),
        };
        let res = split_document(
            target.to_string_lossy().to_string(),
            serde_json::to_string(&req).unwrap(),
        )
        .unwrap();
        assert_eq!(res.files.len(), 2);
        assert_eq!(res.files[0].pages, 2);
        assert_eq!(res.files[1].pages, 1);
    }

    #[test]
    fn crops_with_visual_margins_and_resets() {
        let dir = temp_dir("crop");
        let target = dir.join("doc.pdf");
        std::fs::copy(sample(), &target).unwrap();
        let out = dir.join("cropped.pdf");
        let media = {
            let doc = Document::load(&target).unwrap();
            let page_id = doc.get_pages()[&1];
            effective_box(&doc, page_id, b"MediaBox").unwrap()
        };
        let req = CropRequest {
            dest: out.to_string_lossy().to_string(),
            pages: vec![1],
            margins: [10.0, 20.0, 30.0, 40.0],
            reset_crop: false,
        };
        let res = crop_pages(
            target.to_string_lossy().to_string(),
            serde_json::to_string(&req).unwrap(),
        )
        .unwrap();
        assert_eq!(res.pages, 1);
        let doc = Document::load(&out).unwrap();
        let page_id = doc.get_pages()[&1];
        let crop = effective_box(&doc, page_id, b"CropBox").unwrap();
        let mm = 72.0 / 25.4;
        assert!((crop[0] - (media[0] + 40.0 * mm)).abs() < 0.01);
        assert!((crop[1] - (media[1] + 30.0 * mm)).abs() < 0.01);
        assert!((crop[2] - (media[2] - 20.0 * mm)).abs() < 0.01);
        assert!((crop[3] - (media[3] - 10.0 * mm)).abs() < 0.01);

        // 重置裁切应回到 MediaBox
        let reset = CropRequest {
            dest: dir.join("reset.pdf").to_string_lossy().to_string(),
            pages: vec![1],
            margins: [0.0; 4],
            reset_crop: true,
        };
        crop_pages(
            out.to_string_lossy().to_string(),
            serde_json::to_string(&reset).unwrap(),
        )
        .unwrap();
        let doc = Document::load(dir.join("reset.pdf")).unwrap();
        let page_id = doc.get_pages()[&1];
        let crop = effective_box(&doc, page_id, b"CropBox").unwrap();
        for i in 0..4 {
            assert!((crop[i] - media[i]).abs() < 0.01);
        }
    }

    #[test]
    fn crop_margin_follows_page_rotation() {
        let dir = temp_dir("crop-rotate");
        let target = dir.join("doc.pdf");
        std::fs::copy(sample(), &target).unwrap();
        let plan = PagePlan {
            order: vec![1, 2, 3, 4, 5],
            rotations: BTreeMap::from([(1, 90)]),
            inserts: vec![],
        };
        apply_page_plan(
            target.to_string_lossy().to_string(),
            serde_json::to_string(&plan).unwrap(),
            false,
        )
        .unwrap();

        let doc = Document::load(&target).unwrap();
        let page_id = doc.get_pages()[&1];
        let before = effective_box(&doc, page_id, b"CropBox")
            .or_else(|| effective_box(&doc, page_id, b"MediaBox"))
            .unwrap();
        drop(doc);

        let out = dir.join("rot-cropped.pdf");
        let req = CropRequest {
            dest: out.to_string_lossy().to_string(),
            pages: vec![1],
            margins: [10.0, 0.0, 0.0, 0.0],
            reset_crop: false,
        };
        crop_pages(
            target.to_string_lossy().to_string(),
            serde_json::to_string(&req).unwrap(),
        )
        .unwrap();
        let doc = Document::load(&out).unwrap();
        let page_id = doc.get_pages()[&1];
        let after = effective_box(&doc, page_id, b"CropBox").unwrap();
        let mm = 72.0 / 25.4;
        assert!((after[0] - (before[0] + 10.0 * mm)).abs() < 0.01, "90° 页的视觉上边对应 PDF 左边");
        assert!((after[1] - before[1]).abs() < 0.01);
        assert!((after[2] - before[2]).abs() < 0.01);
    }

    #[test]
    fn rejects_crop_that_leaves_too_little_page() {
        let dir = temp_dir("crop-too-much");
        let target = dir.join("doc.pdf");
        std::fs::copy(sample(), &target).unwrap();
        let req = CropRequest {
            dest: dir.join("bad.pdf").to_string_lossy().to_string(),
            pages: vec![1],
            margins: [300.0, 300.0, 300.0, 300.0],
            reset_crop: false,
        };
        let err = crop_pages(
            target.to_string_lossy().to_string(),
            serde_json::to_string(&req).unwrap(),
        )
        .unwrap_err();
        assert!(err.contains("18pt"));
    }
}
