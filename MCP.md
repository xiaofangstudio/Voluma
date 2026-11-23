# Voluma MCP

Voluma 自带 MCP，不需要额外安装服务、不联网、不写账号。同一个 `Voluma.exe`：

- 双击：正常打开 PDF 工作台。
- 加 `--mcp`：进入 stdio MCP 服务，由 AI 客户端拉起来用。

## 客户端配置

Claude Desktop / Cursor / 其他支持 stdio MCP 的客户端：

```json
{
  "mcpServers": {
    "voluma": {
      "command": "D:\\20533\\deskbox\\fangwork\\Papyra\\Voluma\\Voluma.exe",
      "args": ["--mcp"]
    }
  }
}
```

把 `command` 换成实际安装路径即可。`env`、`cwd` 都不需要。

## 工具

| 工具 | 作用 | 是否写盘 |
| --- | --- | --- |
| `voluma_pdf_info` | 页数、每页尺寸与旋转、注释数、是否含 AcroForm | 只读 |
| `voluma_extract_pages` | 按 `1-3,5` 或 `[1,2,3]` 提取新 PDF | 写新文件 |
| `voluma_export_clean` | 导出无注释版，保留链接与表单 Widget | 写新文件 |
| `voluma_apply_page_plan` | 原地重排 / 旋转 / 删除 / 插入 PDF 或图片 | 原地写回 |
| `voluma_flatten_form` | 把 AcroForm 按当前值展平（含中文矢量） | 写新文件 |

所有路径都用本机绝对路径。`voluma_apply_page_plan` 默认 `backup=false`，要留底传 `backup=true`。

## 示例

```json
{"name":"voluma_pdf_info","arguments":{"path":"D:\\书\\样本.pdf"}}
```

```json
{"name":"voluma_extract_pages","arguments":{"path":"D:\\书\\样本.pdf","dest":"D:\\书\\前三页.pdf","pages":"1-3"}}
```

```json
{"name":"voluma_export_clean","arguments":{"path":"D:\\书\\已批注.pdf","dest":"D:\\书\\交出去.pdf"}}
```

```json
{"name":"voluma_apply_page_plan","arguments":{"path":"D:\\书\\样本.pdf","order":[1,3,2,4,5],"rotations":{"1":90}}}
```

```json
{"name":"voluma_flatten_form","arguments":{"path":"D:\\书\\表单.pdf","dest":"D:\\书\\表单-展平.pdf"}}
```

## 协议

- JSON-RPC 2.0，一行一个 JSON 对象，UTF-8。
- 支持 `initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call`。
- 服务信息：`name=voluma`、`version=0.1.0`。
- 日志只走 stderr，stdout 全部留给协议。

## 边界

- 不提供文字提取、OCR、渲染截图：这些要么依赖字体映射，要么需要完整的 PDF.js 版面，当前工具集不做半成品。
- 不提供 GUI 打印：系统打印必须由用户在桌面里确认。
- 不做路径白名单：MCP 客户端就是本机调用方，按传入的绝对路径读写；不接受 URL、云盘路径。
- 写操作不弹窗、不询问，调用前请先确认目标文件。
