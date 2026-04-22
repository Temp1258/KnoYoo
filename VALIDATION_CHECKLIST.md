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
| E.4 | 主页拖 pdf | 跳 `/books`（Phase C 后才会进文档区） | ☐ |
| E.5 | 照片 App 直接拖视频 | 友好提示"请先导出原始文件"，不是通用"不支持格式" | ☐ |

---

## F. 搜索（主页 + QuickSearch）

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| F.1 | 主页搜一个 media 内容里的词 | 结果里有 media kind 条目（🎧/🎬 图标） | ☐ |
| F.2 | 点击 media 结果 | 跳 `/media?openClip=<id>`，详情打开 | ☐ |
| F.3 | `Cmd+Shift+K` 搜同一词 | 同样命中 + 跳转 | ☐ |
| F.4 | 搜 2 字中文短词 | LIKE 兜底命中 | ☐ |
| F.5 | 搜 1 字 CJK | 仍命中 | ☐ |
| F.6 | 有多种 kind 时 | 同屏可同时看到 clip / media / book | ☐ |

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

---

## I. 乐色

| # | 操作 | 期望看到 | ✓ |
|---|---|---|---|
| I.1 | MediaPage 删一条 | 从列表消失 | ☐ |
| I.2 | 进"乐色"页 | 三个 tab：剪藏 / 书籍 / 影音 | ☐ |
| I.3 | tab 标签带计数 | 如 `影音 · 1` | ☐ |
| I.4 | 点"影音"tab | 刚删的条目在，媒体类型徽标对 | ☐ |
| I.5 | 点"恢复" | 回 MediaPage，trash 计数 -1 | ☐ |
| I.6 | 点"永久删除" | `SELECT * FROM media_items WHERE id=?` 空 | ☐ |
| I.7 | "清空影音乐色" | 确认 + 清空 | ☐ |
| I.8 | "剪藏"/"书籍" tab | 100% 同迁移前 | ☐ |

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

## 最关键 10 条（时间紧只跑这些能覆盖 80% 风险）

A.3 / A.5 / B.1 / C.4 / C.6 / E.5 / F.1 / G.11 / H.3 / I.4

---

*基线：v2.0.8 · 创建于 2026-04-22*
