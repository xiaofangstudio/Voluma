//! Voluma 自带 MCP（Model Context Protocol）stdio 服务。
//!
//! 同一个 `Voluma.exe` 加 `--mcp` 参数即进入本模块，不创建窗口、不读写 GUI 状态；
//! 只通过 stdin / stdout 交换 JSON-RPC。工具全部在本机执行，文件不离开这台电脑。

use lopdf::{Document, Object};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

const PROTOCOL_FALLBACK: &str = "2024-11-05";

/// 进入 MCP stdio 循环；返回进程退出码。
pub fn run_stdio() -> i32 {
    eprintln!("[voluma-mcp] stdio server ready");
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[voluma-mcp] read error: {e}");
                return 1;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[voluma-mcp] invalid json: {e}");
                let resp = error_response(Value::Null, -32700, "JSON 解析失败");
                let _ = writeln!(stdout, "{resp}");
                let _ = stdout.flush();
                continue;
            }
        };

        if req.get("method").and_then(Value::as_str) == Some("exit") {
            break;
        }

        let Some(id) = req.get("id").cloned() else {
            // 通知（initialized / cancelled / progress 等）不需要回包。
            continue;
        };
        let method = req.get("method").and_then(Value::as_str).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(Value::Null);
        let resp = match method {
            "initialize" => initialize_result(id, &params),
            "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
            "tools/list" => json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": tool_definitions() } }),
            "tools/call" => {
                let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
                tool_result(id, call_tool(name, &args))
            }
            _ => error_response(id, -32601, "不支持的方法"),
        };
        let _ = writeln!(stdout, "{resp}");
        let _ = stdout.flush();
    }
    eprintln!("[voluma-mcp] bye");
    0
}

fn initialize_result(id: Value, params: &Value) -> Value {
    let version = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or(PROTOCOL_FALLBACK);
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "protocolVersion": version,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": {
                "name": "voluma",
                "title": "Voluma PDF 工作台",
                "version": env!("CARGO_PKG_VERSION")
            },
            "instructions": "Voluma 的本地 PDF 工具。所有路径都是本机绝对路径；写操作会直接写盘，删页/重排默认不备份，除非 backup=true。"
        }
    })
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}

fn tool_result(id: Value, output: Result<Value, String>) -> Value {
    match output {
        Ok(v) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default() }],
                "isError": false
            }
        }),
        Err(e) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": e }],
                "isError": true
            }
        }),
    }
}

fn call_tool(name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "voluma_pdf_info" => tool_info(args),
        "voluma_extract_pages" => tool_extract(args),
        "voluma_export_clean" => tool_export_clean(args),
        "voluma_apply_page_plan" => tool_apply_plan(args),
        "voluma_flatten_form" => tool_flatten(args),
        other => Err(format!("不认识的工具：{other}")),
    }
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "voluma_pdf_info",
            "description": "读取本机 PDF 元信息：页数、每页尺寸/旋转、注释数量、是否含 AcroForm。只读。",
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "PDF 绝对路径" } },
                "required": ["path"]
            }
        },
        {
            "name": "voluma_extract_pages",
            "description": "把指定页提取成一个新 PDF。pages 支持 \"1-3,5\" 或 [1,2,3]；不会改原文件。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "原 PDF 绝对路径" },
                    "dest": { "type": "string", "description": "输出 PDF 绝对路径，不能与原文件相同" },
                    "pages": {
                        "oneOf": [
                            { "type": "string", "description": "如 1-3,5" },
                            { "type": "array", "items": { "type": "integer" } }
                        ]
                    }
                },
                "required": ["path", "dest", "pages"]
            }
        },
        {
            "name": "voluma_export_clean",
            "description": "导出不含注释的干净版 PDF：删除高亮/便签等注释，保留链接与表单 Widget。dest 省略时生成 <原名>-clean.pdf。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "原 PDF 绝对路径" },
                    "dest": { "type": "string", "description": "输出路径，省略则自动命名" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "voluma_apply_page_plan",
            "description": "按页面计划原地重排/旋转/删除页面，可选插入 PDF 或图片。order 为保留页的 1-based 顺序；backup=true 先留 .bak。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "原 PDF 绝对路径（会被原地写回）" },
                    "order": { "type": "array", "items": { "type": "integer" }, "description": "保留页顺序；省略则保持全部页" },
                    "rotations": {
                        "type": "object",
                        "additionalProperties": { "type": "integer" },
                        "description": "页号 -> 追加旋转 90/-90/180"
                    },
                    "inserts": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "index": { "type": "integer", "description": "插入到最终页序的位置，0 表示最前" },
                                "kind": { "type": "string", "enum": ["pdf", "image"] },
                                "path": { "type": "string" }
                            },
                            "required": ["index", "kind", "path"]
                        }
                    },
                    "backup": { "type": "boolean", "description": "写回前是否保留 .bak，默认 false" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "voluma_flatten_form",
            "description": "把 AcroForm 表单按当前值展平（中文用矢量路径），输出新文件。dest 省略时生成 <原名>-flat.pdf。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "原 PDF 绝对路径" },
                    "dest": { "type": "string", "description": "输出路径，省略则自动命名" }
                },
                "required": ["path"]
            }
        }
    ])
}

/* ------------------------------------------------------------------ */
/* 工具实现                                                             */
/* ------------------------------------------------------------------ */

fn tool_info(args: &Value) -> Result<Value, String> {
    let path = req_str(args, "path")?;
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("文件不存在".into());
    }
    let bytes = std::fs::metadata(&src).map_err(|e| format!("读文件信息失败：{e}"))?.len();
    let doc = Document::load_mem(&std::fs::read(&src).map_err(|e| format!("读取失败：{e}"))?)
        .map_err(|e| format!("解析 PDF 失败：{e}"))?;
    let pages = doc.get_pages();
    let mut sizes = Vec::new();
    let mut annotations = 0usize;
    for (no, id) in pages.iter() {
        let page = doc.get_object(*id).and_then(|o| o.as_dict()).map_err(|_| "页面对象不是字典".to_string())?;
        let (w, h) = page_box(&doc, page);
        let rotate = page.get(b"Rotate").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0);
        let count = page
            .get(b"Annots")
            .ok()
            .and_then(|o| resolve(&doc, o))
            .and_then(|o| o.as_array().ok())
            .map(|a| a.len())
            .unwrap_or(0);
        annotations += count;
        sizes.push(json!({ "page": no, "width": round1(w), "height": round1(h), "rotate": rotate, "annots": count }));
    }
    let has_form = doc
        .trailer
        .get(b"Root")
        .ok()
        .and_then(|o| resolve(&doc, o))
        .and_then(|o| o.as_dict().ok())
        .map(|d| d.get(b"AcroForm").is_ok())
        .unwrap_or(false);
    Ok(json!({
        "path": src.to_string_lossy(),
        "bytes": bytes,
        "pages": pages.len(),
        "version": doc.version,
        "hasAcroForm": has_form,
        "annotations": annotations,
        "pageSizes": sizes
    }))
}

fn tool_extract(args: &Value) -> Result<Value, String> {
    let path = req_str(args, "path")?;
    let dest = req_str(args, "dest")?;
    let total = crate::pages::document_page_count(path.clone())?;
    let pages = parse_pages(args.get("pages").ok_or("缺少 pages")?, total)?;
    let r = crate::pages::extract_pages(path, pages, dest.clone())?;
    Ok(json!({ "dest": dest, "pages": r.pages, "bytes": r.bytes }))
}

fn tool_export_clean(args: &Value) -> Result<Value, String> {
    let path = req_str(args, "path")?;
    let dest = optional_dest(args, &path, "-clean.pdf")?;
    ensure_distinct(&path, &dest)?;
    let r = crate::export::export_without_annotations(path, dest.clone())?;
    Ok(json!({ "dest": dest, "bytes": r.bytes, "removed": r.removed }))
}

fn tool_apply_plan(args: &Value) -> Result<Value, String> {
    let path = req_str(args, "path")?;
    let total = crate::pages::document_page_count(path.clone())?;
    let order = match args.get("order") {
        Some(v) => {
            let arr = v.as_array().ok_or("order 必须是数组")?;
            let mut out = Vec::new();
            for x in arr {
                let n = x.as_u64().ok_or("order 里必须是页号")? as u32;
                out.push(n);
            }
            out
        }
        None => (1..=total as u32).collect(),
    };
    let mut rotations = serde_json::Map::new();
    if let Some(obj) = args.get("rotations").and_then(Value::as_object) {
        for (k, v) in obj {
            let n: u32 = k.parse().map_err(|_| format!("页号不合法：{k}"))?;
            let d = v.as_i64().ok_or_else(|| format!("第 {n} 页旋转值不合法"))?;
            rotations.insert(k.clone(), json!(d));
        }
    }
    let inserts = args.get("inserts").cloned().unwrap_or_else(|| json!([]));
    let backup = args.get("backup").and_then(Value::as_bool).unwrap_or(false);
    let plan = json!({ "order": order, "rotations": rotations, "inserts": inserts });
    let r = crate::pages::apply_page_plan(path, plan.to_string(), backup)?;
    Ok(json!({ "pages": r.pages, "bytes": r.bytes }))
}

fn tool_flatten(args: &Value) -> Result<Value, String> {
    let path = req_str(args, "path")?;
    let dest = optional_dest(args, &path, "-flat.pdf")?;
    ensure_distinct(&path, &dest)?;
    let r = crate::form::flatten_form(path, dest.clone(), "{\"fields\":[]}".into())?;
    Ok(json!({ "dest": dest, "fields": r.fields, "bytes": r.bytes }))
}

/* ------------------------------------------------------------------ */
/* 小工具                                                               */
/* ------------------------------------------------------------------ */

fn req_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| format!("缺少参数 {key}"))
}

fn optional_dest(args: &Value, src: &str, suffix: &str) -> Result<String, String> {
    if let Some(v) = args.get("dest").and_then(Value::as_str) {
        if !v.trim().is_empty() {
            return Ok(v.to_string());
        }
    }
    let src_path = PathBuf::from(src);
    let stem = src_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("原文件路径没有文件名")?;
    let name = format!("{stem}{suffix}");
    let mut p = src_path;
    p.set_file_name(name);
    Ok(p.to_string_lossy().to_string())
}

fn ensure_distinct(src: &str, dest: &str) -> Result<(), String> {
    let a = path_key(src);
    let b = path_key(dest);
    if a == b {
        return Err("输出不能覆盖原文件，请换一个路径".into());
    }
    Ok(())
}

fn path_key(p: &str) -> String {
    let path = Path::new(p);
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    };
    abs.to_string_lossy().to_lowercase()
}

fn parse_pages(v: &Value, total: usize) -> Result<Vec<u32>, String> {
    let mut out = Vec::new();
    match v {
        Value::Array(a) => {
            for x in a {
                let n = x.as_u64().ok_or("pages 里必须是页号")? as u32;
                out.push(n);
            }
        }
        Value::String(s) => {
            for part in s.split(',') {
                let part = part.trim();
                if part.is_empty() {
                    continue;
                }
                if let Some((a, b)) = part.split_once('-') {
                    let start: u32 = a.trim().parse().map_err(|_| format!("页号不合法：{part}"))?;
                    let end: u32 = b.trim().parse().map_err(|_| format!("页号不合法：{part}"))?;
                    if start > end {
                        return Err(format!("页码范围反了：{part}"));
                    }
                    for n in start..=end {
                        out.push(n);
                    }
                } else {
                    out.push(part.parse().map_err(|_| format!("页号不合法：{part}"))?);
                }
            }
        }
        _ => return Err("pages 必须是字符串或数组".into()),
    }
    if out.is_empty() {
        return Err("没有选择任何页".into());
    }
    for n in &out {
        if *n == 0 || *n as usize > total {
            return Err(format!("第 {n} 页不存在（共 {total} 页）"));
        }
    }
    Ok(out)
}

fn page_box(doc: &Document, page: &lopdf::Dictionary) -> (f64, f64) {
    for key in [b"CropBox".as_slice(), b"MediaBox".as_slice()] {
        if let Ok(o) = page.get(key) {
            if let Some(arr) = resolve(doc, o).and_then(|v| v.as_array().ok()) {
                if arr.len() == 4 {
                    let nums: Vec<f64> = arr.iter().filter_map(obj_num).collect();
                    if nums.len() == 4 {
                        return ((nums[2] - nums[0]).abs(), (nums[3] - nums[1]).abs());
                    }
                }
            }
        }
    }
    (612.0, 792.0)
}

fn resolve<'a>(doc: &'a Document, o: &'a Object) -> Option<&'a Object> {
    match o {
        Object::Reference(id) => doc.get_object(*id).ok(),
        _ => Some(o),
    }
}

fn obj_num(o: &Object) -> Option<f64> {
    match o {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(*r as f64),
        _ => None,
    }
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_page_ranges_and_list() {
        let v = json!("1-3,5");
        assert_eq!(parse_pages(&v, 5).unwrap(), vec![1, 2, 3, 5]);
        let v = json!([2, 4]);
        assert_eq!(parse_pages(&v, 5).unwrap(), vec![2, 4]);
    }

    #[test]
    fn reject_page_out_of_range() {
        assert!(parse_pages(&json!("1-6"), 5).is_err());
        assert!(parse_pages(&json!("3-1"), 5).is_err());
        assert!(parse_pages(&json!([]), 5).is_err());
    }
}
