# Voluma · 开发与构建说明（M0–M8）

> 小方工作室 ｜ Papyra 办公套件 ｜ 2026-11-24

## 一 环境要求

| 项 | 版本 |
| --- | --- |
| Node.js | ≥ 20（本机 22.23.2） |
| npm | ≥ 10 |
| Rust | stable（本机 1.99.0） |
| C++ 构建工具 | Visual Studio 2022 Build Tools（MSVC x64） |
| 运行时 | WebView2 Runtime（Win10/11 自带） |

## 二 常用命令

```bash
npm install            # 安装前端依赖
npm run tauri dev      # 开发模式（Vite 1420 + Tauri 窗口，热更新）
npx tauri build --no-bundle   # 只出 exe，不打包安装器
.\Voluma.exe --mcp            # 同一 exe 进入 stdio MCP 服务（给 AI 客户端拉）
npx tauri build        # 出 NSIS 安装包（需联网拉 NSIS）
npm run icons          # 由 assets/*.svg 重新生成全套图标
node scripts/make-sample-pdf.mjs  # 生成 5 页带目录的测试 PDF
node scripts/verify-m1.mjs        # 无头浏览器验收 M1，截图到 review/
node scripts/verify-m2.mjs        # 注释工具/列表/连续重绘验收，截图到 review-m2/
node scripts/verify-ui.mjs        # M0 基础阅读验收
node scripts/make-form-pdf.mjs    # 生成 M3 六字段表单样本 assets/M3-表单样本.pdf
node scripts/e2e-pages.mjs        # M3 页面旋转 / 重排 / 删除 UI 验收
node scripts/e2e-pages-insert.mjs # M3 插入 PDF / 图片 UI 验收（含原生对话框）
node scripts/e2e-pages-extract.mjs # M3 提取选中页 UI 验收
node scripts/e2e-forms.mjs        # M3 表单填写 / 自动保存 / 重开回读 UI 验收
node scripts/e2e-flatten-cjk.mjs  # M3 中文表单展平 UI 验收
node scripts/e2e-print.mjs        # M4 打印面板 / 页码 / 3 页排版 DOM 验收（拦截系统对话框）
node scripts/e2e-print-all.mjs    # M4 全部页打印几何与 5 页排版截图
node scripts/e2e-print-dialog.mjs # M4 真实打开系统打印预览
node scripts/e2e-print-form.mjs   # M4 打印带表单当前值的页面
node scripts/e2e-print-annot.mjs  # M4 打印带高亮注释的页面
node scripts/e2e-print-layouts.mjs# M4 2-up / 4-up 版式
node scripts/e2e-print-long.mjs   # M4 40 页低内存打印路径（压缩图片）
node scripts/e2e-print-paginate.mjs # M4 分页回归：全部 5 页、2-up 3 页、4-up 2 页
node scripts/e2e-release-m4.mjs   # M4 Release 端到端：高亮 / 导出 / 系统预览
node scripts/e2e-mcp.mjs          # M5/M6 自带 MCP：握手 / 8 工具 / 提取 / 导出 / 合并 / 拆分 / 裁切 / 展平
node scripts/e2e-toolkit.mjs      # M6 工具面板：真实 UI 合并 / 拆分 / 裁切（含原生选文件）
node scripts/e2e-theme.mjs        # M7 主题：深/浅/跟随系统、持久化、纸面白色、顶栏不溢出
node scripts/e2e-tts.mjs          # M8 朗读：系统语音 / 暂停继续 / 跳段 / 跨页 / 高亮 / 偏好 / 窄窗
node scripts/e2e-export-clean.mjs # M4 不含注释导出（真实原生另存对话框）
node scripts/e2e-export-form.mjs  # M4 导出时保留表单 Widget
node scripts/probe-annots.mjs <pdf>  # 用 PDF.js 回读 Rust 写出的注释
```

产物：`src-tauri/target/release/voluma.exe`

## 三 目录

```
Voluma/
  MCP.md               自带 MCP 配置、工具表与示例
  assets/              图标 SVG 源 + 测试 PDF（5 页、含两级书签）
  review/              验收截图（无头浏览器生成）
  review-m2/           M2 注释验收截图
  scripts/             图标生成、样本 PDF、M0/M1/M2 验收脚本
  src/
    App.tsx            启动页 → 欢迎页 → 阅读器 三段状态机
    components/
      Splash/Welcome/TopBar/Icons
      Viewer.tsx       阅读器主控（模式、缩放、搜索、注释、表单、自动保存）
      Sidebar.tsx      目录 / 缩略图 / 搜索 / 注释四合一侧栏
      Continuous.tsx   连续滚动（按页虚拟化）
      PageManager.tsx  页面缩略图 / 旋转 / 删除 / 重排 / 插入 / 提取
      ToolkitPanel.tsx 合并 / 拆分 / 裁切三页签（含裁切实时预览）
      ThemeMenu.tsx    界面主题弹层（跟随系统 / 浅色 / 深色）
      TtsBar.tsx       底部朗读条（播放 / 跳段 / 语音 / 语速）
      FormPanel.tsx    表单字段列表 / 立即保存 / 导出展平
      PrintPanel.tsx   打印页码 / 版式面板
    lib/
      pdf.ts           PDF.js 封装：尺寸、渲染、文本层、检索、目录、缩略图
      annots.ts        注释模型、坐标换算、SVG 覆盖层、选区提取
      forms.ts         表单 Widget 扫描、PDF.js 控件层、值收集
      print.ts         打印页渲染、@page 版式、系统打印与清场
      recents.ts       最近文件（localStorage）
      tauri.ts         IPC（二进制直传、对话框、注释/页面/表单/导出命令）
      theme.ts         主题偏好存储、系统深浅色监听、html[data-theme]
      tts.ts           朗读分段（baseline 聚行 / 段落切分 / 220 字上限）、偏好读写
  src-tauri/
    src/lib.rs         read_document / file_exists / file_size
                       read_annotations / save_annotations（lopdf）
                       document_page_count / apply_page_plan / extract_pages
                       merge_documents / split_document / crop_pages
                       save_form_values / flatten_form / export_without_annotations
    src/pages.rs       页面计划（重排 + 删除 + 插入）、合并、拆分、CropBox 裁切
    src/form.rs        AcroForm 读写、展平、ttf-parser 中文字形转路径
    src/export.rs      不含注释导出、页面 /Annots 过滤、孤立对象清理
    src/mcp.rs         --mcp stdio 服务、8 个本地 PDF 工具、JSON-RPC
    icons/             1024 主图、32/128/256、icon.ico（16–256 七档）
```

## 四 M0 验收（已完成）

| 项 | 结果 |
| --- | --- |
| 启动页 → 欢迎页 | 650ms 淡出、980ms 切换，同底色不闪白 |
| 最近文件卡片墙 | 首页封面、页数、进度、大小，读到最后一次位置 |
| 打开 PDF | Tauri 对话框；浏览器兜底 file input |
| 单页 / 双页对开 / 100% 实际尺寸 / 适应宽度 | 612×792pt 页在 1280 窗口：100% = 816px，适应宽度 = 151% |
| 光标锚点缩放（Ctrl+滚轮）、8%–6400% | 通过 |
| 夜间反转 | 暖灰底、主题红保留色相 |
| 16px 图标可辨认 | 两页 + 红缎带，小尺寸走简化版 |

## 五 M1 验收（已完成）

M1 出口：三种阅读模式 + 目录缩略图 + 搜索 + 夜间反转。

| 项 | 结果 |
| --- | --- |
| 连续滚动 | 5 页文档：DOM 页位 5 个，同时只渲染 2–4 个画布；滚动后自动换页 |
| 单页 / 双页 | 双页并排、中缝阴影；双页模式下翻页步进 2 页 |
| 文本层 | PDF.js TextLayer，可选中复制；透明文本覆盖在画布上，检索高亮按 span 命中 |
| 目录侧栏 | 书签树（三级缩进）；Chapter Two → 第 3 页实测跳转正确；无书签时给出缩略图引导 |
| 缩略图侧栏 | IntersectionObserver 懒渲染；当前页绛红描边并自动滚入视野 |
| 全文搜索 | 5 页样本搜 “Papyra” 得 9 条结果；结果面板按页显示摘要、命中计数 |
| 高亮区分 | 全部命中淡绛红 `hl`，当前页加重 `hl-current`，逐条定位时深色 `hl-focus` |
| Enter 逐个跳转 | 连按 3 次从第 1 页跨到第 2 页，当前条与阅读位置同步 |
| 页码跳转 / 进度保存 | 连续模式滚动实时更新页码；关闭后重开回到上次页 |
| 夜间反转 | 三种模式均生效，UI 主题不变 |

无头验收（`verify-m1.mjs`）实测无 console error。

## 六 M2 验收（已完成）

M2 出口：八种注释工具 + 注释列表面板 + 自动保存；**注释直接写 PDF 标准对象，不再产生 `.voluma.json`**。

| 项 | 结果 |
| --- | --- |
| 高亮 / 下划线 / 删除线 | 先选工具再拖选文字；选区逐行转 QuadPoints，覆盖多行 |
| 矩形 / 椭圆 | 拖拽绘制，松手生成；预览层虚线跟随 |
| 画笔 | 指针轨迹平滑采样（≥2px 才加点），生成 Ink + InkList |
| 便签 / 图钉 | 点击落点弹出玻璃输入卡；写 `/Subtype /Text`，便签 `/Name /Comment`、图钉 `/Name /PushPin` |
| 注释列表面板 | 侧栏第四页签；按页 / 按时间排序、点击跳转、选中展开 5 色改色、行尾删除 |
| 自动保存 | 停手 1.2 秒触发；顶栏显示 未保存 / 保存中 / 已保存 / 保存失败 |
| 写回实现 | Rust `lopdf` 删旧 `voluma-` 注释、写新注释与 `/AP /N` 外观流；临时文件原子替换 |
| 数据安全 | 首次保存复制 `<文件名>.pdf.bak`，后续保存不覆盖原件 |
| 外部注释 | 只删 `/NM` 以 `voluma-` 开头的注释，其他软件写的一律保留 |
| 三种模式 | 单页 / 双页 / 连续均重绘注释层；连续模式滚动换页后仍能画出 |
| 坐标正确 | 100% 下选中一行文字 → `/Rect` 与文字区域吻合（样本实测 y 607.27–623.27pt） |
| 外观回显 | 写出的 PDF 用 PDF.js 重新打开，高亮与画笔在画布上直接可见（`/AP` 生效） |

实测数据（`verify-m2.mjs`，浏览器预览模式）：高亮 1、矩形 1、画笔 1、便签 1，共 4 条；列表 4 行；改色第 3 色生效；删除后剩 3 条；连续模式第 1 页 3 条注释随页重绘；`consoleErrors=[]`。

Tauri 端到端（测试副本 `tmp-e2e/annot-e2e.pdf`）：WebView2 调试端口 9333，打开 → 高亮 → 自动保存 → `read_annotations` 回读到同一条 `voluma-…`；再画矩形 → 第二次保存后磁盘上 2 条，且 `.bak` 仍是首次保存前的原件大小。

Release 端到端（`e2e-release-page5.mjs`，4.16 MB / 4,364,288 字节）：真实 `Voluma.exe` 打开 5 页样本第 5 页 → 落便签 → 自动保存 → 关闭重开最近文件，第 5 页便签回显且状态「已保存」；用 PDF.js 复核磁盘文件，第 5 页得到 1 条 `/Subtype /Text`、`contentsObj` 为原文、`hasAppearance=true`。

Rust 单测 7 条全过：标准注释写入、重复保存不重复、删除可清除、回读字段完整、便签/图钉文字回读、缺失页拒绝写入、Windows 原子替换与 `.bak` 保留。回归时发现样本 PDF 生成脚本的对象号与第 4/5 页及大纲对象撞号，导致 `lopdf` 只识别 3 页；已修正对象号并重新生成 5 页样本，页号识别与第 4 页注释写入均恢复。写入前现在会校验页号存在与 `voluma-` 前缀，避免静默丢注释。

## 七 M3 验收（已完成）

M3 出口：页面管理五件事 + AcroForm 填写 / 保存 / 展平，全部在真实 Tauri UI 验收。

| 项 | 结果 |
| --- | --- |
| 页面旋转 | 第 1 页右转 90° 应用后尺寸 1056×816；重开页面管理仍显示 `↻ 90°`（原生旋转 + 增量） |
| 拖拽重排 | 第 1 页拖到末位，应用后页序正确 |
| 删除页 | 删除原第 5 页，应用后 5 页变 4 页；暂存不弹确认，只在最终应用确认一次 |
| 插入 PDF | 插入 5 页样本后总页数 5→10，内容与页序正确 |
| 插入图片 | `review-m2/40-page-manager.png` 转 A4 横向图片页，总页数变 11 |
| 提取页 | 第 1 页另存 `pages-extracted.pdf`（4547 字节 / 1 页），打开内容为样本第 1 页 |
| 表单控件 | 1 页 6 字段：文本框 name/company、勾选 agree、单选 plan、下拉 city、多行 notes；控件与页面字段框对齐 |
| 表单填写 | 输入中文 / 英文、勾选、单选、下拉后 1.2 秒自动保存，顶栏「已保存」 |
| 重开回读 | 重开文档后 name/company/notes 中文回显、agree 勾选、plan 第二项选中、city Shenzhen |
| 中文展平 | 填「方小明 / 小方工作室 / 第一行第二行备注」导出 `forms-flat-cjk.pdf`（25333 字节），重开后 0 控件、表单按钮 disabled，中文以矢量字形显示 |
| 英文展平 | 英文值导出 11020 字节，重开无 Widget、无 `/AcroForm` |

Rust 单测 16 条全过：原 15 条 + `flatten_chinese_values_as_vector_text`（中文展平必须写出 `% VolumaCjk` 矢量内容流）。

Release 数据：`npx tauri build --no-bundle` 1m24s，`voluma.exe` 4,995,584 字节（4.76MB），较 M2 增加 0.60MB（新增 ttf-parser 与表单/页面代码）。

已知限制：
- 中文展平是路径字形，不可搜索/复制；找不到系统中文字体时明确报错。
- 表单保存与注释保存是两次串行写盘，不是单次原子合并。
- 删除页只删页面对象与直接注释，不清理孤立内容流/大纲；插入 PDF 不处理加密；数字签名写回即失效。

## 八 M4 验收（已完成）

M4 出口：系统打印（页码 / 缩放 / 多页合一）+ 不含注释导出；全部在真实 Tauri UI 与系统打印预览中验收。

| 项 | 结果 |
| --- | --- |
| 打印入口 | 顶栏打印机按钮 / `Ctrl+P`；无文档或载入中给出提示 |
| 页码范围 | 全部 / 当前页 / 自定义 `1-3,5`；越界显示红字「页码超出 1–40」并禁用打印 |
| 版式 | 适应纸张 / 实际大小 / 每张 2 页 / 每张 4 页，面板显示约几张纸 |
| 实际大小 | Letter 612×792pt 文档按 1pt=1/72in 输出 816×1056 CSS px；打印 PDF 仍为 5 页，真机纸张裁切待复验 |
| 打印 DOM | 3 页实测生成 3 张画布 1224×1584（144 DPI），页码与选择一致 |
| 系统预览 | 最终 Release 打开 5 页文档的 WebView2 打印预览，顶部显示「总数: 5 纸张」，无空白页（`review-m2/100-final-native-preview.png`）；单页打印实测 1 张 |
| 注释外观 | 带高亮页打印 DOM 中高亮可见（`review-m2/72-print-annot.png`） |
| 表单值 | 中文六字段表单打印页显示方小明 / 小方工作室 / 勾选 / 第二项单选 / Shenzhen / 两行备注（`review-m2/73-print-form.png`） |
| 2-up / 4-up | 最终 Release：5 页 → 3 张（2/2/1）与 2 张（4/1）；打印成 PDF 复核同为 3 页 / 2 页，4-up 为 A4 纵向 2×2 |
| 大文档内存 | 40 页自动切 108 DPI 压缩图片：40 张 918×1188，不再保留 40 份原始画布 |
| 不含注释导出 | 带 1 条高亮的 5274 字节文件导出为 4610 字节；PDF.js 回读注释 0；页面内容不变 |
| 保留表单 | 六字段表单导出后仍回读 7 个 Widget，字段与外观都在 |
| 保留链接 | Rust 单测确认 `/Subtype /Link` 不被删除 |
| 原子替换 | 先写 `<目标>.voluma-tmp`，再 rename；目标同名覆盖可用 |
| 清场 | 关闭系统打印预览后 `#voluma-print` 与临时 `@page` 样式自动移除，重开文档不残留 |

Rust 单测 20 条全过：原 16 条 + M4 两条（保留 Link/Widget 并清理被删注释对象；删光后移除页面 `/Annots` 键）+ MCP 两条（页码范围解析、越界拒绝）。

Release 数据：最终 `npx tauri build --no-bundle` 2m07s，`Voluma.exe` 5,006,336 字节（4.77MB）；`scripts/e2e-release-m4.mjs` 在真实 Release 上完成高亮、导出干净版（4610 字节、移除 1 处注释）与系统预览。

M5 构建：加入 `mcp.rs` 后再打 `--no-bundle` 1m36s，`Voluma.exe` 5,059,584 字节（4.83MB）；`node scripts/e2e-mcp.mjs` 在正式 exe 上全过；`npx tauri bundle --bundles nsis` 出 2,062,867 字节安装包。

实现要点：
- `src/lib/print.ts`：按页重新 `getPage` + `render`，`intent: "print"`、`annotationMode: ENABLE`；`#voluma-print` 在屏幕隐藏、打印时显示。
- 打印 DOM 在打印时通过 `@page { size: A4 …; margin: 10mm }` 与 `break-after: page` 控制；只写现代 `break-after`，不叠加旧的 `page-break-after`；同时把 `html/body` 的 `font-size/line-height` 归零——`<body>` 里原有的换行文本会在打印根节点前生成 21px 匿名行盒，把第 1 页顶出可打印区，浏览器就会补一张空白页。A4 内容高度取 275mm（单页）、188/274mm（2/4-up），比可打印区再小 2mm，避免浮点误差挤出白纸。
- 页数 >24 时把画布转 PNG、>120 页转 JPEG 95%，用图片替代画布并 `revokeObjectURL` 清场，控制大文档峰值内存。
- `src-tauri/src/export.rs`：复制后逐页过滤 `/Annots`，保留 `/Link` 与 `/Widget`；`doc.prune_objects()` 清掉不再被引用的注释对象、外观流与弹出注释。
- 导出前先 `flushSave`，避免导出的是尚未落盘的旧注释 / 表单值。

已知限制：
- 打印仍是整份预渲染，超大文档线性耗时；有逐页进度文案，但不可中断。
- 系统打印对话框自带页码范围；应用内已先筛页，系统里保持「全部」即可，避免二次筛选。
- 打印依赖 WebView2 的 `window.print()`：Windows 实测非阻塞并打开 Edge 打印预览；macOS / Linux 需按平台复验。
- 不含注释导出保留 `/Popup` 之外的其他非注释对象由 `prune_objects` 清理；若第三方注释被其他结构树直接引用，可能被保留为孤立对象但不会显示。

## 九 M6 验收（已完成）

M6 出口：二期首批三个无损工具，全部只生成新文件，原件不动；GUI 三页签 + MCP 三工具同轮验收。

| 项 | 结果 |
| --- | --- |
| 入口 | 顶栏「PDF 工具」/ `F11`；一个窗口三页签：合并、拆分、裁切 |
| 合并 | 当前文档固定参与，其他 PDF 可多选、删除、上下移；2 个 5 页样本合并为 10 页，页面 `/Parent` 全部指回页面树根 |
| 合并清引用 | `/Outlines`、`/PageLabels`、`/AcroForm`、`/StructTreeRoot`、`/Names` 清掉，页面内容、注释与链接保留 |
| 拆分（按份数） | 5 页按每 2 页一份，得到 2/2/1 三个文件；输出到指定目录，重名自动加序号 |
| 拆分（按区间） | `1-2`、`4` 两段得到 2 个文件（2 页 / 1 页）；单测覆盖 |
| 裁切 | 四边 10mm，Letter 612×792pt → CropBox `28.346, 28.346, 555.307×735.307pt`；只改 `/CropBox`，不重采样 |
| 旋转页裁切 | 第 1 页先转 90°，视觉上边 10mm 正确映射到 PDF 左边（x0 +28.346pt） |
| 恢复整页 | `resetCrop` 把 CropBox 重设为 MediaBox；单测通过 |
| 预览 | PDF.js 页面 + 虚线成品框 + 外侧压暗，实时显示成品毫米尺寸；虚线框按实际页宽高换算（10mm 四边像素误差 ≤2px，e2e 断言）；零边距与边距过大时提交按钮均禁用 |
| 安全 | 合并/裁切目标不能与任一原件相同；裁切后小于 18pt 直接拒绝；拆分不覆盖旧文件 |
| 单测 | Rust 28 条全过（原 20 + M6 页码范围解析、合并、拆分 2 条、裁切 2 条、拒绝过裁、MCP 8 工具定义） |
| MCP | `e2e-mcp.mjs` 在正式 exe 上 8 工具全过：合并 10 页、拆分 2/2/1、裁切 3 页 CropBox 正确 |
| UI e2e | `e2e-toolkit.mjs` 在真实 Tauri WebView 完成合并 10 页、拆分 2/2/1、裁切 CropBox；断言 10mm 预览框四边像素位置；日志 `review-m2/m6-toolkit-ui.txt` |

Release 数据：最终 `npx tauri build --no-bundle` 1m36s，`Voluma.exe` 5,117,952 字节（4.88MB），SHA256 `F73A0858065F36CCF4543082D053450724AD72A675362393F2F34D59F04957F3`；`npx tauri bundle --bundles nsis` 4.1s，安装包 2,083,541 字节（1.99MiB），SHA256 `F3F4ED7C2DD94E7DE4AC7AFEF8ECAC963EA5DDD083AA090370E562A2E56C2F99`。UI 实测窗口 1280 CSS px，顶栏工具入口未被挤出。

截图：`review-m2/110-m6-main.png` 主界面、`111` 合并初始、`112` 拆分初始、`113` 裁切零边距（按钮禁用）、`114` 合并已加入第二份、`115` 合并完成 10 页、`116` 拆分完成 2/2/1、`117` 四边 10mm 预览、`118` 裁切完成。

实现要点：
- `pages.rs` 的合并把第一个 PDF 作为底稿，后续文件逐页导入；对象映射键改为 `(源文件序号, ObjectId)`，解决多文件同对象号撞车。
- `set_page_tree` 统一把每个页面的 `/Parent` 指回根节点，修复提取 / 合并后页面仍指向旧中间节点的问题。
- 拆分按份数或区间生成页面组，每组 clone 一份文档、重设页面树、清跨页引用；文件名 `前缀-起止页.pdf`，已存在则加 ` (2)`。
- 裁切先取有效 CropBox（无则 MediaBox），把视觉四边按页面 `/Rotate` 换算到未旋转坐标，再写新 CropBox，并与 MediaBox 取交集。
- 预览用 `renderThumbnail` 渲染当前页，按页面毫米宽高计算虚线框百分比；不额外生成预览文件。

已知限制：
- 合并件与拆分件不保留 AcroForm，字段退化为 Widget 外观；若后续要保表单，需要按页重建字段树。
- 裁切不做自动白边识别，需手动输入四边毫米；裁切后注释 Rect 不重算，超出 CropBox 的部分由阅读器裁剪。
- 拆分逐份重新序列化，超大文档按份数线性耗时；不做并行写盘。

## 十 M7 验收（已完成）

M7 出口：界面主题三态（跟随系统 / 浅色 / 深色）可切换、可记忆、跟随 Windows；所有界面有深色样式，PDF 纸面与打印输出不变。

| 项 | 结果 |
| --- | --- |
| 入口 | 欢迎页底栏主题 chip + 阅读器顶栏半圆图标；弹层三选一，当前项打勾 |
| 启动防闪 | `index.html` CSS 前内联脚本读 `localStorage["voluma.theme.v1"]`，先写 `html[data-theme]`；`main.tsx` 再 `initTheme()` |
| 三态 | 跟随系统 / 浅色 / 深色；手选浅或深后固定，不再被系统覆盖 |
| 系统跟随 | `matchMedia("(prefers-color-scheme: dark)")` 监听；e2e 用 CDP 模拟系统深/浅，界面实时切换 |
| 持久化 | 重载后 `data-theme` 与 localStorage 均保持最后选择；启动首帧不闪白 |
| 纸面不变 | 深色下 `.page-wrap` 背景 `rgb(255,255,255)`，页面中心像素 `255,255,255`；夜间反转仍是独立滤镜 |
| 覆盖 | 启动页、欢迎页、顶栏 / 画布 / 页码 / toast、目录 / 缩略图 / 搜索 / 注释侧栏、注释工具条 / 便签、页面管理、表单、打印、PDF 工具、主题弹层 |
| 顶栏 | 1280 CSS px 下 27 个按钮全部在窗口内，无溢出；主题提示贴右对齐不再被裁 |
| UI e2e | `e2e-theme.mjs` 全过：深色欢迎 / 阅读 / 侧栏 / 页管理 / 工具 / 打印 / 注释条 / 表单，浅色欢迎与阅读；日志 `review-m2/m7-theme-ui.txt` |
| MCP 回归 | `e2e-mcp.mjs` 在 M7 正式 exe 上 8 工具仍全过，末行 `MCP OK` |

Release 数据：`npx tauri build --no-bundle` 2m18s，`Voluma.exe` 5,120,000 字节（4.88MB），SHA256 `162C5E40C075C01BC9E42234D917EBE1CCDD2940FDDA7498C2E0DABD900579FA`；`npx tauri bundle --bundles nsis` 5.8s，安装包 2,086,363 字节（1.99MiB），SHA256 `CB12345ECFC7F8B234BF6CA8F736385BAA667858F4DF18456BBDB06AA2C91AF3`。两者均未签名。

截图：`review-m2/120-m7-welcome-dark.png` 深色欢迎、`121` 深色阅读、`122` 深色缩略图、`123` 深色页面管理、`124` 深色 PDF 工具、`125` 主题弹层、`126` 浅色欢迎、`127` 浅色阅读、`128` 深色注释条、`129` 深色打印、`130` 深色表单。

实现要点：
- `theme.ts` 用模块级 snapshot + `useSyncExternalStore`，两个入口共用同一状态；`setThemeMode` 写 localStorage 后同步刷新 `data-theme` 与 `color-scheme`。
- 深色只覆盖 UI 令牌与少量硬编码表面，`--paper` 始终白色；打印仍由 `@media print` 强制白底。
- 深色主按钮反转为浅粉底深字；模态、输入框、文件列表、分段控件分别补了暗色表面，不只是把全局背景变黑。
- 顺手修复最近文件卡片的进度条：`span` 是行内元素，2px 高度不生效导致被撑成半圆，补 `display:block`。

已知限制：
- 主题偏好按整机保存，不按文档保存；没有自定义强调色、对比度调节。
- 系统跟随依赖 WebView2 的 `matchMedia`；不支持单独覆盖某个窗口的标题栏颜色。
- 深色下 PDF 注释颜色保持原色，不做色值映射，避免导出后颜色与屏幕不一致。

## 十一 M8 验收（已完成）

M8 出口：系统本地中文语音逐段朗读，能暂停 / 继续 / 跳段 / 停止，跨页自动继续，页内高亮只读，语音与语速可记忆；真实 WebView 与 900 窄窗通过。

| 项 | 结果 |
| --- | --- |
| 引擎 | 页面内 `speechSynthesis` + `SpeechSynthesisUtterance`，WebView2 系统语音，无 Rust SAPI、无联网 |
| 语音 | 本机 3 个 `zh-CN` 本地语音：Huihui / Kangkang / Yaoyao；默认 Huihui，下拉可切 |
| 分段 | `tts.ts` 按 baseline 聚行，行距 `>1.85 × 行高` 分段；中文不插空格，英文补空格；单段 ≤220 字，按句末标点切 |
| 状态机 | `onend` 推进段，页末自动下一页，空文本页跳过，末页进入「已读完」；`cancel()` + run token 防止旧回调误推进 |
| 语音条 | 播放 / 暂停、上一段 / 下一段、停止、关闭、语音下拉、0.70–1.60× 语速、页码与段进度、当前段文字、六态状态 |
| 页内高亮 | `.tts-focus` 只读层按当前 viewport 把 PDF rect 转 CSS px；暂停保留，停止 / 读完清除；不写 PDF、不影响打印 |
| 偏好 | `localStorage["voluma.tts.v1"]` 存语音名与语速；重开恢复；播放中换语音从当前段重读 |
| 快捷键 | `Alt+R` 开 / 关朗读条，`Esc` 关闭；`F6` 目录、`F9` 页面管理、`F10` 表单、`F11` PDF 工具均不冲突 |
| 顶栏 | 1280 CSS px 下 28 个按钮无溢出；900 窄窗隐藏文件名与保存胶囊、图标收 24px，28 个入口仍全部在窗口内 |
| UI e2e | `e2e-tts.mjs` 全过：3 语音、播放 / 暂停 / 继续 / 下一段 / 停止、语速与语音重载持久化、2 页中文样本 16.4s 自动跨页读完、`Alt+R` / `Esc`、900 窄窗；日志 `review-m2/m8-tts-ui.txt`，末行 `TTS UI OK` |
| MCP 回归 | TTS 是纯前端能力，不新增 MCP 工具；MCP 仍 8 个，`e2e-mcp.mjs` 回归 `MCP OK` |

Release 数据：`npx tauri build --no-bundle` 1m50s，`Voluma.exe` 5,124,608 字节（4.89MB），SHA256 `23DD5679E54B894FB4CE459CD91D2BA634019CDFB7341484EC940E7EB1CA8942`；`npx tauri bundle --bundles nsis` 出 2,091,271 字节（1.99MiB）安装包，SHA256 `5B9696133B83DFA7D44FBC47B8E8A237BD4ADFE98ECD394F5A7A7356AD579FF0`，两者均未签名。MCP 8 工具回归与 Rust 28 条单测同轮通过。

截图：`review-m2/131-m8-tts-dark.png` 深色朗读中与页内高亮、`132-m8-tts-finished.png` 跨页读完、`133-m8-tts-900.png` 900 窄窗朗读条。

实现要点：
- 朗读条挂在 `Viewer` 最外层，与页码浮层分开；底部 `74px`，不压页码胶囊。
- `speakTts` 先切页、再取段、再 `cancel()`、最后 `speak()`；每一轮 `run` 自增，暂停 / 跳段 / 换语音后的旧 `onend` 直接丢弃。
- `finishTts` 清空 `ttsSegments` 进入 `done`，朗读条显示「已读完」，不再遗留上一段的段计数。
- 朗读从当前页开始，连续模式用 `continuousRef.goToPage`，单页 / 双页直接 `goTo`；页内高亮最多重试 8 次等待页面渲染完成。

已知限制：
- 只读 PDF 文本层；扫描件与图片文字不读（OCR 放三期）。
- 不做逐字 `word boundary` 高亮，不导出音频。
- 音色、断句与停顿由 Windows 语音包决定；纯图片 PDF 无文本可读时会提示并跳过。

## 十二 已定的实现口径

1. **100% = 实际尺寸**：1pt = 96/72 CSS px，与 Acrobat 百分比一致；「适应宽度」按可用宽度反算。
2. **热路径全在前端**：翻页、缩放、绘制、检索都在 PDF.js；Rust 只做整份字节直传与文件存在性探测。
3. **整份字节直传**：`tauri::ipc::Response::new(bytes)` 返回原始二进制，避免 JSON 数组序列化大文件。
4. **连续模式虚拟化**：按页绝对定位，滚动时渲染视口 ±1 页、清理超出 ±3 页的画布；文本层只为已渲染页生成。
5. **全页尺寸预取**：打开后后台分批取每页原始尺寸（24 页一批），连续排版用；未取完时按首页尺寸占位并提示排版进度。
6. **搜索**：按页取文本并缓存；结果最多 400 条；输入防抖 320ms，新搜索自动跳第一条；同页多条按 span 顺次定位。
7. **侧栏**：单栏 280px，目录/缩略图/搜索三选一，打开时内容区收窄、阅读比例按可用宽度重算。
8. **夜间反转**：canvas 滤镜 `invert + hue-rotate(180deg) + sepia`，纸张转暖灰、主题色不偏青。
9. **注释即 PDF**：不存 sidecar；每一次保存把八类注释写成 `/Highlight` `/Underline` `/StrikeOut` `/Square` `/Circle` `/Ink` `/Text`，文件在任何阅读器里都是成品。
10. **坐标空间**：前端只存 PDF 用户坐标；选区 `convertToPdfPoint`，回显 `convertToViewportPoint/Rectangle`；`convertToViewportRectangle` 的 y 轴不保证升序，取 min/max。
11. **身份与去重**：`/NM voluma-…` 是唯一身份；Rust 回读按前缀过滤。PDF.js 的 `getAnnotations()` 只暴露对象引用 `17R`、不暴露 NM，因此注释读取走 Rust 的 `read_annotations`，不逐页扫 PDF.js。
12. **外观流必写**：每种注释生成 Form XObject；高亮 0.4 alpha + Multiply，矩形/椭圆/画笔带 2pt 边框。这样 Acrobat、Chrome、系统预览不依赖前端覆盖层也能看见。
13. **保存链路**：1.2 秒防抖 → 单飞锁 + 待办标记 → Rust `spawn_blocking` 整份重写 → 临时文件 → 原子替换；保存中继续编辑会自动续存，不会丢最后一笔。
14. **`.bak` 语义**：只在目标旁不存在 `.bak` 时复制一次，保留最初原件；连续自动保存不覆盖。
15. **覆盖层缓存**：按页签名（尺寸 + 选中 id + 注释 id/type/color）跳过无变化重绘；无注释的页不创建空 SVG。
16. **关闭前落盘**：关闭文档、打开另一个文件、`Ctrl+S` 都先触发一次立即保存，不等 1.2 秒防抖。
17. **页面计划一次提交**：前端只暂存旋转增量、删除集合、插入卡；应用时一次 `apply_page_plan`，Rust 内完成重排 + 删除 + 插入，避免多次写盘。
18. **表单值通道**：PDF.js 控件写入 `annotationStorage`；`collectFormValues` 按字段名聚合（未选中的按钮显式发 `Off`），Rust 只认 `{ fields: [...] }`，不接受裸数组。
19. **表单外观**：ASCII 文本由 Rust 生成 `/AP`（AcroForm `/DR` 首个字体或 Helvetica）；非 ASCII 不生成错字，置 `/NeedAppearances`，阅读器可自绘；Voluma 自身用 HTML 控件显示，不依赖 `/AP`。
20. **中文展平**：`ttf-parser` 读系统字体轮廓，按字段 Rect 与字号排版，逐字输出 PDF 路径并裁剪到字段框；只画字形，不嵌入字体，保证任何阅读器可开且文件不膨胀。
21. **打印不新增 Rust 命令**：前端把选中页重新渲染成打印 DOM，`window.print()` 直接进 WebView2 系统对话框；纸张、双面、份数交给系统，应用只负责页码与版式。
22. **打印渲染带注释**：重渲染用 `annotationMode: ENABLE`，把 PDF 里的 `/AP` 外观烘到画布；打印前 `flushSave`，表单值走已保存外观，不另造一套打印排版引擎。
23. **打印内存分档**：≤24 页保留 144 DPI 画布；25–120 页 108 DPI + PNG；>120 页 108 DPI + JPEG 95%，并即时释放原画布。
24. **打印前先消掉匿名行盒**：`@media print` 把 `html/body` 的 `font-size/line-height` 置 0，避免 `<body>` 换行在打印根节点前撑出 21px 行盒；页面与多页板只写 `break-after: page`，删掉旧的 `page-break-after`；页容器比 A4 可打印区再小 2mm 兜底。
25. **干净版导出保留交互**：只删非 `/Link`、非 `/Widget` 的 `/Annots`；表单字段与超链接不动，随后 `prune_objects()` 清孤立注释对象，兼顾“干净”与“还能填表”。

## 十三 相对分册的增补

- 顶部图标条新增「导航」组（目录 F6 / 缩略图 F7 / 搜索 Ctrl+F / 注释 F8）、「连续」模式按钮（Ctrl+3）与「注释」组 8 个工具（H/U/S/R/O/P/N/I），其余分组保持附录 A 原样。
- 注释工具条落在左下（避开居中页码胶囊），玻璃层 + 5 色点 + 「完成」；工具选中态是唯一使用绛红 soft 底的按钮组。
- 顶栏新增保存状态小胶囊，替代分册里没有的「保存按钮」。
- 双页对开暂为「当前页 + 下一页」并排，封面单页优先仍按待确认问题 4 留待拍板。

## 十四 自带 MCP

- **单 exe 双入口**：`main.rs` 先看 `--mcp`，命中就进 `voluma_lib::mcp::run_stdio()`；否则照常 `tauri::Builder` 起窗口。不额外装服务，也不生成第二个 exe。
- **协议**：JSON-RPC 2.0，stdin/stdout 一行一个 JSON，UTF-8；stdout 只放协议，日志全走 stderr。支持 `initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call`。
- **工具**：`voluma_pdf_info`、`voluma_extract_pages`、`voluma_export_clean`、`voluma_apply_page_plan`、`voluma_merge_pdfs`、`voluma_split_pdf`、`voluma_crop_pages`、`voluma_flatten_form`；全部复用 GUI 同一套 Rust 函数，不维护第二套逻辑。
- **安全边界**：只认本机绝对路径，不访问 URL / 云盘；写操作直接写盘，`apply_page_plan` 默认不备份，需留底显式 `backup=true`；合并 / 拆分 / 裁切只写新文件。
- **测试**：`node scripts/e2e-mcp.mjs` 拉起 `Voluma.exe --mcp`，验证 8 工具、5 页元信息、提取 3 页、干净导出、表单展平后 0 Widget、第 1 页旋转 90°、合并 10 页、拆分 2/2/1、裁切 CropBox、缺文件返回 `isError`。
- **配置文档**：`MCP.md` 给出 Claude Desktop / Cursor 的 `mcpServers` 配置与调用示例。

## 十五 安装包

- **命令**：`npx tauri bundle --bundles nsis`，复用已经打好的 release exe，不再重编。
- **产物**：`src-tauri/target/release/bundle/nsis/Voluma_0.1.0_x64-setup.exe`，2,091,271 字节（1.99MiB）；根目录留一份同名副本。
- **内容**：安装包里的 `Voluma.exe` 5,124,608 字节（4.89MB），同一个 exe 既开 GUI 也支持 `--mcp`。
- **签名**：主 exe 与安装包均为 `NotSigned`；正式发布前需要代码签名，否则 SmartScreen 提示未知发布者。
- **未验**：静默安装 / 卸载、开始菜单项、升级覆盖；GitHub Release 与 FangBox 上架待账号与发布信息确认。
- **SHA256（exe）**：`23DD5679E54B894FB4CE459CD91D2BA634019CDFB7341484EC940E7EB1CA8942`。
- **SHA256（NSIS）**：`5B9696133B83DFA7D44FBC47B8E8A237BD4ADFE98ECD394F5A7A7356AD579FF0`。

## 十六 明确的未做（按分册排期）

- M2：~~注释全套 + 注释列表 + sidecar 自动保存~~（已完成，且改为 PDF 原生注释）
- M3：~~页面旋转/删除/重排/提取/插入、表单填写与展平~~（已完成，中文展平走矢量字形）
- M4：~~打印、不含注释导出~~（已完成，打印走 WebView2 系统对话框）
- M5：~~自带 MCP（`--mcp`，8 工具）~~、~~NSIS 安装包~~（已完成，安装包未签名）；代码签名、GitHub Release、上架 FangBox 待做
- M6：~~合并 / 拆分 / 裁切~~（已完成，三页签 + 3 个 MCP 工具，只写新文件）；自动白边识别、合并保表单待做
- M7：~~界面主题（跟随系统 / 浅色 / 深色）~~（已完成，全部界面覆盖、偏好持久化、PDF 纸面不变）；自定义强调色、高对比度待做
- M8：~~朗读（系统 TTS 逐段读）~~（已完成，暂停/继续/跳段/停止、跨页自动、页内高亮、偏好持久化）；逐字高亮、音频导出、OCR 取词待做
- 未做但已知：撤销/重做、注释文字二次编辑、跨页选区拆成多条、增量保存、加密 PDF 写入。

*2026-11-24 ｜ M8 朗读完成，系统 TTS 逐段读 + 页内高亮，UI / 跨页 / 窄窗全过*
