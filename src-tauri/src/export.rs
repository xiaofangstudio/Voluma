use lopdf::{Document, Object, ObjectId};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub bytes: u64,
    pub removed: usize,
}

#[tauri::command]
pub fn export_without_annotations(path: String, dest: String) -> Result<ExportResult, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("原文件不存在，无法导出".into());
    }
    let bytes = std::fs::read(&src).map_err(|e| format!("读取原文件失败：{e}"))?;
    let mut doc = Document::load_mem(&bytes).map_err(|e| format!("解析 PDF 失败：{e}"))?;
    let (removed, size) = export_doc(&mut doc, Path::new(&dest))?;
    Ok(ExportResult {
        bytes: size,
        removed,
    })
}

fn export_doc(doc: &mut Document, dest: &Path) -> Result<(usize, u64), String> {
    let pages: Vec<ObjectId> = doc.get_pages().values().copied().collect();
    let mut removed = 0usize;
    for page_id in pages {
        let mut page = doc
            .get_object(page_id)
            .map_err(|_| "找不到页面对象".to_string())?
            .as_dict()
            .map_err(|_| "页面对象不是字典".to_string())?
            .clone();
        let Some(annots) = page
            .get(b"Annots")
            .ok()
            .and_then(|o| annots_array(doc, o))
        else {
            continue;
        };
        let mut kept: Vec<Object> = Vec::new();
        for item in annots {
            let subtype = item
                .as_reference()
                .ok()
                .and_then(|id| doc.get_object(id).ok())
                .and_then(|o| o.as_dict().ok())
                .and_then(|d| d.get(b"Subtype").ok())
                .and_then(|o| o.as_name().ok())
                .map(|n| n.to_vec())
                .or_else(|| {
                    item.as_dict()
                        .ok()
                        .and_then(|d| d.get(b"Subtype").ok())
                        .and_then(|o| o.as_name().ok())
                        .map(|n| n.to_vec())
                });
            match subtype.as_deref() {
                Some(b"Link") | Some(b"Widget") => kept.push(item),
                _ => removed += 1,
            }
        }
        if kept.is_empty() {
            page.remove(b"Annots");
        } else {
            page.set("Annots", Object::Array(kept));
        }
        doc.set_object(page_id, Object::Dictionary(page));
    }

    doc.prune_objects();

    let tmp = temp_path(dest);
    doc.save(&tmp).map_err(|e| format!("写入临时文件失败：{e}"))?;
    let size = std::fs::metadata(&tmp)
        .map_err(|e| format!("读取导出文件失败：{e}"))?
        .len();
    std::fs::rename(&tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("保存导出文件失败：{e}")
    })?;
    Ok((removed, size))
}

fn annots_array(doc: &Document, o: &Object) -> Option<Vec<Object>> {
    match o {
        Object::Array(a) => Some(a.clone()),
        Object::Reference(id) => doc
            .get_object(*id)
            .ok()
            .and_then(|o| o.as_array().ok())
            .map(|a| a.clone()),
        _ => None,
    }
}

fn temp_path(dest: &Path) -> PathBuf {
    let name = dest
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "voluma-export.pdf".into());
    dest.with_file_name(format!("{name}.voluma-tmp"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    fn sample() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("assets")
            .join("M0-阅读样本.pdf")
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("voluma-export-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn removes_comment_annotations_but_keeps_links_and_widgets() {
        let dir = temp_dir("annots");
        let dest = dir.join("clean.pdf");
        let mut doc = Document::load(sample()).unwrap();
        let page_id = *doc.get_pages().values().next().unwrap();
        let text_id = doc.add_object(Object::Dictionary(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Text",
            "Rect" => vec![10.into(), 10.into(), 30.into(), 30.into()],
        }));
        let link_id = doc.add_object(Object::Dictionary(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Link",
            "Rect" => vec![40.into(), 40.into(), 60.into(), 60.into()],
        }));
        let mut page = doc.get_object(page_id).unwrap().as_dict().unwrap().clone();
        page.set(
            "Annots",
            Object::Array(vec![
                Object::Reference(text_id),
                Object::Reference(link_id),
            ]),
        );
        doc.set_object(page_id, Object::Dictionary(page));

        let (removed, _) = export_doc(&mut doc, &dest).unwrap();
        assert_eq!(removed, 1);

        let out = Document::load(&dest).unwrap();
        let page = out.get_object(page_id).unwrap().as_dict().unwrap();
        let annots = page.get(b"Annots").unwrap().as_array().unwrap();
        assert_eq!(annots.len(), 1);
        let kept = annots[0].as_reference().unwrap();
        let d = out.get_object(kept).unwrap().as_dict().unwrap();
        assert_eq!(d.get(b"Subtype").unwrap().as_name().unwrap(), b"Link");
        assert!(!out.objects.contains_key(&text_id), "被移除的注释对象应该一并清掉");
    }

    #[test]
    fn removes_annots_key_when_nothing_left() {
        let dir = temp_dir("empty");
        let dest = dir.join("clean.pdf");
        let mut doc = Document::load(sample()).unwrap();
        let page_id = *doc.get_pages().values().next().unwrap();
        let note_id = doc.add_object(Object::Dictionary(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Highlight",
            "Rect" => vec![10.into(), 10.into(), 30.into(), 30.into()],
        }));
        let mut page = doc.get_object(page_id).unwrap().as_dict().unwrap().clone();
        page.set("Annots", Object::Array(vec![Object::Reference(note_id)]));
        doc.set_object(page_id, Object::Dictionary(page));

        export_doc(&mut doc, &dest).unwrap();
        let out = Document::load(&dest).unwrap();
        let page = out.get_object(page_id).unwrap().as_dict().unwrap();
        assert!(page.get(b"Annots").is_err());
    }
}
