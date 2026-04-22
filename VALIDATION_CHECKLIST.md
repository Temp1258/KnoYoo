# v2.0.8 手工验收清单

> 对应 `PLAN_DOCUMENTS.md` 的 Phase B.8 手工端到端验证。
> 每条都是"做什么 → 看什么"，逐条勾选。
>
> **用法**：出现不符合期望的立刻停下，把编号 + 实际现象（截图或 Console 报错）告诉 Claude。

---

## 准备

| 项 | 内容 |
|---|---|
| 测试音频 | 1 个 mp3 / m4a，< 10 MB，3–5 分钟最舒服 |
| 测试视频 | 1 个 mp4，< 50 MB |
| Dev 服务器 | `cd apps/desktop && pnpm tauri:dev` |
| 数据库路径 | `~/Library/Application Support/knoyoo.desktop/data/notes.db` |
| sqlite3 | macOS 自带 |
| AI 已配置 | 设置 → AI（H 段需要） |
| 安全备份 | 开跑前做一次"设置 → 数据 → 导出备份" |

---

## A. 启动 & Schema 迁移

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| A.1 | `pnpm tauri:dev` 启动 | 无错误弹窗 | ☐ |
| A.2 | Console 无 red error | 没有 `schema init failed` / `migration failed` | ☐ |
| A.3 | `sqlite3 notes.db "SELECT val FROM app_kv WHERE key='media_migration_v1'"` | `done` | ☐ |
| A.4 | `sqlite3 notes.db ".schema media_items"` | 含 `media_type`, `file_hash`, `notes`, `ai_status` 等列 | ☐ |
| A.5 | `sqlite3 notes.db "SELECT COUNT(*) FROM web_clips WHERE source_type IN ('audio','local_video')"` | `0` | ☐ |
| A.6 | `sqlite3 notes.db "SELECT COUNT(*) FROM media_items"` | 原 audio + local_video 的数量（你之前是 2） | ☐ |

---

## B. 老数据保真（A.6 > 0 才有意义）

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| B.1 | 打开"影音"页 | 老 audio + local_video 全部展示，分"音频 / 本地视频"两栏 | ☐ |
| B.2 | 点一条老 media | 详情：content / summary / tags 都在 | ☐ |
| B.3 | 有笔记的 media | 详情"我的笔记"区显示原笔记 | ☐ |
| B.4 | 非中文带译文的 media | 切到"中文译文"视图有内容 | ☐ |

---

## C. 新音频导入

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| C.1 | 拖 mp3 到"影音"页 | 详情抽屉自动打开 | ☐ |
| C.2 | 进度条推进 | 依次：`正在转录` → `AI 清洗为可读版` → `生成摘要与标签` | ☐ |
| C.3 | 转录完成 | content 区显示可读 Markdown | ☐ |
| C.4 | 摘要 + 标签生成 | summary 非空 + 3–5 个标签 | ☐ |
| C.5 | `sqlite3 ... "SELECT media_type,file_path,file_hash,file_size FROM media_items ORDER BY id DESC LIMIT 1"` | 四个字段**都**有值 | ☐ |
| C.6 | 再次拖同一 mp3 | **不**产生新行，状态重置重跑 | ☐ |

---

## D. 新本地视频导入

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| D.1 | 拖 mp4 到"影音"页 | 详情打开 | ☐ |
| D.2 | ffmpeg 抽音频无报错 | 进度推进到"正在转录" | ☐ |
| D.3 | 流程同 C.2–C.4 | 正常 | ☐ |
| D.4 | sqlite 查询 | `media_type = 'local_video'` | ☐ |

---

## E. 主页 dropzone 分流

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| E.1 | 主页拖 mp3 | 跳 `/media?openClip=<id>`，详情打开 | ☐ |
| E.2 | 主页拖 mp4 | 同 E.1 | ☐ |
| E.3 | 主页拖 epub | 跳 `/books` | ☐ |
| E.4 | 主页拖 pdf | 跳 `/documents?openDocument=<id>`（Phase C 后 pdf 默认进文档区） | ☐ |
| E.5 | 照片 App 直接拖视频 | 友好提示"请先导出原始文件"，不是通用"不支持格式" | ☐ |
| E.6 | 主页拖 docx | 跳 `/documents?openDocument=<id>`，详情自动打开 | ☐ |
| E.7 | 主页拖 md | 跳 `/documents?openDocument=<id>` | ☐ |
| E.8 | 主页拖 txt | 跳 `/documents?openDocument=<id>` | ☐ |

---

## F. 搜索（主页 + QuickSearch）

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| F.1 | 主页搜一个 media 内容里的词 | 结果里有 media kind 条目（🎧/🎬 图标） | ☐ |
| F.2 | 点击 media 结果 | 跳 `/media?openClip=<id>`，详情打开 | ☐ |
| F.3 | `Cmd+Shift+K` 搜同一词 | 同样命中 + 跳转 | ☐ |
| F.4 | 搜 2 字中文短词 | LIKE 兜底命中 | ☐ |
| F.5 | 搜 1 字 CJK | 仍命中 | ☐ |
| F.6 | 有多种 kind 时 | 同屏可同时看到 clip / media / book / document | ☐ |
| F.7 | 搜一个 document 内容里的词 | 结果里有 document kind（绿色 📄 图标） | ☐ |
| F.8 | 点击 document 结果 | 跳 `/documents?openDocument=<id>`，详情打开且内容匹配 | ☐ |
| F.9 | scope=documents | 只返 document 结果 | ☐ |

---

## G. 详情页编辑

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| G.1 | 改标题保存 | 列表刷新同步 | ☐ |
| G.2 | 改摘要保存 | `SELECT summary FROM media_items WHERE id=?` 已变 | ☐ |
| G.3 | 加 1 个新标签 | 显示 + sqlite tags 数组 +1 | ☐ |
| G.4 | 删 1 个标签 | 消失 | ☐ |
| G.5 | "让 AI 重新归类" | summary + tags 被重新生成 | ☐ |
| G.6 | "重新翻译"（非中文 media） | 译文区刷新 | ☐ |
| G.7 | 首次打开详情 | 未读 → 已读 | ☐ |
| G.8 | "标为未读" | 回到未读 | ☐ |
| G.9 | 写一条笔记保存 | `SELECT notes FROM media_items WHERE id=?` 非空 | ☐ |
| G.10 | 编辑笔记保存 | 更新 | ☐ |
| G.11 | 删除笔记 | 消失，sqlite `notes = ''`（空串） | ☐ |

---

## H. AI 对话 + 引用（B.7 重点）

**前置**：设置配好 AI。

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| H.1 | 右下角 💬 打开 | 正常打开 | ☐ |
| H.2 | 问与某 media 内容相关的问题 | 回答里有 `[MEDIA:<数字>]` 标记 | ☐ |
| H.3 | 消息底下"引用来源" | 含"影音 · 〈media 标题〉" | ☐ |
| H.4 | 问与 web clip 相关的问题 | 回答用 `[CLIP:<数字>]`；引用"剪藏 · 〈标题〉" | ☐ |
| H.5 | 问涉及两种来源的问题 | 两种引用同时列出 | ☐ |
| H.6 | 新对话再问 | 上一会话引用不串扰 | ☐ |
| H.7 | 切回旧会话 | 旧消息可见 | ☐ |
| H.8 | 问智库不存在的内容 | AI 老实说"智库没有"，不乱编 ID | ☐ |
| H.9 | 问涉及 document 的问题 | 回答里有 `[DOC:<数字>]` 标记 | ☐ |
| H.10 | 引用卡 | 含一行"文档 · 〈document 标题〉" | ☐ |

---

## I. 乐色

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| I.1 | MediaPage 删一条 | 从列表消失 | ☐ |
| I.2 | 进"乐色"页 | **四个** tab：剪藏 / 书籍 / 影音 / 文档（Phase C 加了"文档"） | ☐ |
| I.3 | tab 标签带计数 | 如 `影音 · 1` / `文档 · 2` | ☐ |
| I.4 | 点"影音"tab | 刚删的条目在，媒体类型徽标对 | ☐ |
| I.5 | 点"恢复" | 回 MediaPage，trash 计数 -1 | ☐ |
| I.6 | 点"永久删除" | `SELECT * FROM media_items WHERE id=?` 空 | ☐ |
| I.7 | "清空影音乐色" | 确认 + 清空 | ☐ |
| I.8 | "剪藏"/"书籍" tab | 100% 同迁移前 | ☐ |
| I.9 | DocumentsPage 删一条 → 进文档 tab | 看到条目，格式徽标对（PDF / Word / Markdown / 纯文本） | ☐ |
| I.10 | 文档恢复 | 回 DocumentsPage 主列表 | ☐ |
| I.11 | 文档"永久删除" | `SELECT * FROM documents WHERE id=?` 空，对应文件也从 `documents/` 目录删除 | ☐ |
| I.12 | "清空文档乐色" | 批量删除 + 文件一并清理 | ☐ |

---

## J. 导出 Markdown

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| J.1 | DevTools Console 跑 `await window.__TAURI__.core.invoke("export_media_item_to_file", { id: <media_id>, path: "/tmp/test.md" })` | 无异常 | ☐ |
| J.2 | 打开 /tmp/test.md | frontmatter 含 `title / media_type / file_path / file_hash / tags` | ☐ |
| J.3 | 正文 | 标题 → 类型标签 → 转录来源 → AI 摘要 → 我的笔记 → 分隔线 → 转录正文 | ☐ |
| J.4 | `export_clip_to_file` 对 web clip | 仍正常工作 | ☐ |

---

## K. 回归

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| K.1 | ClipsPage 所有操作 | 100% 同迁移前 | ☐ |
| K.2 | BooksPage 所有操作 | 100% 同迁移前 | ☐ |
| K.3 | 浏览器扩展收藏网页 | 正常进智库 | ☐ |
| K.4 | 导入 YouTube / Bilibili 链接 | 正常转录，仍写 `web_clips` | ☐ |
| K.5 | 设置 → 数据 → 导出备份 | 生成 .db 文件 | ☐ |
| K.6 | 设置 → 数据 → 导入备份 | 恢复 + 重启，老数据完整 | ☐ |

---

## L. 风险路径

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| L.1 | 转录中 `Cmd+Q` 退出 | 无 panic、无数据损坏 | ☐ |
| L.2 | 重启 | 状态能识别（pending / failed） | ☐ |
| L.3 | "重试转录" | 重新跑 pipeline 完成 | ☐ |
| L.4 | sqlite 手工清空一条的 `file_path` | 点"重试"给出友好错误，不崩溃 | ☐ |

---

---

## M. 文档导入（Phase C）

**准备**：1 个 pdf（< 10 MB）+ 1 个 docx（带几个 Heading 段落）+ 1 个 md（带 `#` 标题）+ 1 个 txt

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| M.1 | 拖 pdf 到"文档"页 | 详情抽屉打开，几秒后 content 显示文本，summary + tags 生成 | ☐ |
| M.2 | 拖 docx 到"文档"页 | content 显示带 markdown 标题语法（`# …` / `## …`），TOC 自动出现 | ☐ |
| M.3 | 拖 md 到"文档"页 | content 保留原 markdown，TOC 按 `#` 层级渲染 | ☐ |
| M.4 | 拖 txt 到"文档"页 | content 显示纯文本，无 TOC 模块 | ☐ |
| M.5 | 重复拖同一 pdf | 不产生新行，报错"已在文档"或类似 | ☐ |
| M.6 | 拖 .xlsx / .pptx / .zip | 友好报错"不支持的文档格式（仅支持 pdf/docx/md/txt）" | ☐ |
| M.7 | 照片 App 拖文件到文档页 | 友好提示"请先从照片 App 中导出" | ☐ |
| M.8 | `sqlite3 ... "SELECT file_format,file_path,file_hash,word_count FROM documents ORDER BY id DESC LIMIT 1"` | 四个字段**都**有值 | ☐ |

---

## N. 文档页展示 + 详情编辑

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| N.1 | DocumentsPage 打开 | 文档按格式分组：PDF / Word / Markdown / 纯文本 四栏 | ☐ |
| N.2 | 左侧导航有"文档" | 图标 📄，位于影音与发现之间 | ☐ |
| N.3 | 详情显示 content / summary / tags | 都正常 | ☐ |
| N.4 | 写笔记，保存 | `SELECT notes FROM documents WHERE id=?` 非空 | ☐ |
| N.5 | 删除笔记 | `notes = ''`（空串，非 NULL） | ☐ |
| N.6 | "让 AI 重新归类"按钮 | summary + tags 重新生成 | ☐ |
| N.7 | 详情页无"AI 翻译"按钮 | 文档 v1 不支持翻译，不出现 | ☐ |
| N.8 | 标题编辑、摘要编辑、标签增删 | 全部落库 | ☐ |
| N.9 | 切换"已读/未读" | 状态翻转；`last_opened_at` 自动更新 | ☐ |

---

## O. 跨类型移动（C.11）

**前提**：手上有至少 1 个 pdf 书籍、1 个 pdf 文档、1 个 epub 书籍、1 个 docx 文档。

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| O.1 | 打开 pdf 文档详情 | sticky 操作栏有"移到书籍"按钮（BookMarked 图标） | ☐ |
| O.2 | 点击"移到书籍" | 跳 `/books?openBook=<id>`；toast"已移动到书籍" | ☐ |
| O.3 | 乐色 → 文档 tab | 能看到刚移走的文档（软删，可恢复） | ☐ |
| O.4 | books 目录 | 新增 `{hash}.pdf` 文件；documents 目录的原文件仍在（copy 非 move） | ☐ |
| O.5 | 打开 pdf 书籍详情 | 底部 footer 有"移到文档"按钮 | ☐ |
| O.6 | 点击"移到文档" | 跳 `/documents?openDocument=<id>`；toast"已移动到文档" | ☐ |
| O.7 | 原 book 进入乐色"书籍" tab | ✓ | ☐ |
| O.8 | 打开 docx 文档详情 | **不**显示"移到书籍"按钮（文档格式非 pdf） | ☐ |
| O.9 | 打开 epub 书籍详情 | **不**显示"移到文档"按钮 | ☐ |
| O.10 | 尝试把已存在 hash 的 pdf 跨移 | 友好报错"《X》已在书籍 / 已在文档" | ☐ |

---

## P. TOC 目录（C.12）

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| P.1 | 打开一个带 ≥3 个 `#` 标题的 md 文档 | "目录 (N)" 收缩条出现 | ☐ |
| P.2 | 打开一个带 ≥3 个 Heading 段落的 docx 文档 | TOC 同样出现（docx 现在会被渲染为 `<h1>`..`<h6>`） | ☐ |
| P.3 | 点开 TOC | 列表条目缩进按 level 展开 | ☐ |
| P.4 | 点击 TOC 某条 | 正文平滑滚动到对应标题 | ☐ |
| P.5 | 打开 txt 文档 | **无** TOC 模块（没有标题结构） | ☐ |
| P.6 | 打开 pdf 文档 | 一般**无** TOC 模块（pdf 提取后是纯文本，无 markdown `#`） | ☐ |
| P.7 | 打开一个标题 < 3 个的 md | **无** TOC 模块（`extractHeadings` 阈值 ≥ 3） | ☐ |

---

## 最关键 12 条（v2.0.9 · 时间紧只跑这些能覆盖 85% 风险）

A.3 / A.5 / B.1 / C.4 / C.6 / E.4 / F.1 / F.7 / G.11 / H.3 / I.2 / M.2 / O.2 / P.2

（M.2 / P.2 合计一条——docx 带 TOC 是本轮改动的核心路径）

---

*基线：v2.0.9 · 更新于 2026-04-22（Phase C 全部落地）*
