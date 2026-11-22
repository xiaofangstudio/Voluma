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
    let mut map: BTreeMap<ObjectId, ObjectId> = BTreeMap::new();
    let mut ids = Vec::with_capacity(pages.len());
    for (_, page_id) in pages {
        ids.push(import_page(&ext, doc, page_id, root, &mut map)?);
    }
    let _ = at;
    Ok(ids)
}

fn import_page(
    src: &Document,
    dst: &mut Document,
    page_id: ObjectId,
    root: ObjectId,
    map: &mut BTreeMap<ObjectId, ObjectId>,
) -> Result<ObjectId, String> {
    if let Some(existing) = map.get(&page_id) {
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
    map.insert(page_id, new_id);
    let mut obj = Object::Dictionary(dict);
    copy_value(src, dst, &mut obj, map)?;
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
    map: &mut BTreeMap<ObjectId, ObjectId>,
) -> Result<(), String> {
    match value {
        Object::Reference(id) => {
            let new_id = copy_ref(src, dst, *id, map)?;
            *value = Object::Reference(new_id);
        }
        Object::Dictionary(dict) => {
            for (_, v) in dict.iter_mut() {
                copy_value(src, dst, v, map)?;
            }
        }
        Object::Array(items) => {
            for v in items.iter_mut() {
                copy_value(src, dst, v, map)?;
            }
        }
        Object::Stream(stream) => {
            for (_, v) in stream.dict.iter_mut() {
                copy_value(src, dst, v, map)?;
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
    map: &mut BTreeMap<ObjectId, ObjectId>,
) -> Result<ObjectId, String> {
    if let Some(existing) = map.get(&id) {
        return Ok(*existing);
    }
    let mut obj = src
        .get_object(id)
        .map_err(|_| format!("插入对象 {} {} 缺失", id.0, id.1))?
        .clone();
    let new_id = dst.add_object(Object::Null);
    map.insert(id, new_id);
    copy_value(src, dst, &mut obj, map)?;
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
}
