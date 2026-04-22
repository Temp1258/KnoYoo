# P1 实施计划：Schema 重构 + 新增「文档」顶级内容区

> 本文件是 BLUEPRINT.md 中 P1 两项（schema 重构 + 文档区）的**战术级实施计划**。
> BLUEPRINT 写"做什么 / 为什么"，本文件写"怎么做 / 到什么程度算完"。

---

## 1. 背景

### 心智模型与数据现状

用户的四容器硬边界：

| 容器 | 来源 |
|---|---|
| 智库 | 网页收藏（扩展 / URL 导入） |
| 书籍 | 用户声明为书的文件 |
| 影音 | 用户手动上传的本地音 / 视频 |
| 文档（**新增**） | 用户手动上传的本地文本文件 |

但数据层现状：`web_clips` 表一张表承载了 article / video / audio / local_video 四种 `source_type`。其中 audio / local_video 用到的字段（`transcription_status` / `source_language` / `translated_content` / 本地 `file_path`）对 article 永远为 NULL——**字段需求早就分家，只是表没拆**。

### 为什么两件事要一起做

新增「文档」若继续共表，会加深历史债；拆分 `web_clips` 才能让四容器在数据层对齐心智模型。开工前把 audio / local_video 迁出，`documents` 才能干净入场。**同一个版本完成两件事，迁移风险最小（用户量最小时动手）。**

---

## 2. 范围

**In**：
- 新建 `media_items` + `media_items_fts`，把 audio / local_video 从 `web_clips` 迁过来
- 新建 `documents` + `documents_fts`
- 新增 `DocumentsPage` + 左侧导航
- 主页 dropzone 路由扩展（docx / md / txt / pdf → 文档；epub 仍进书籍）
- 文档解析：pdf / docx / md / txt
- 搜索聚合 / AI 对话上下文 / Markdown 导出 / 乐色 四处接入 `media_items` 和 `documents`

**Out**（本计划不覆盖）：
- 扫描版 PDF OCR（独立 P1 项，单独计划）
- xlsx / pptx / rtf / zip / 图片 等格式
- 跨类型移动（书籍 ↔ 文档）
- 文档的章节结构化、目录生成等后续能力

---

## 3. 分阶段实施

### Phase A — 准备与决策对齐（0.5 天）

**任务**
1. 第 4 节「待用户拍板」的所有决策点取得答复
2. 新表 schema 最终定稿（依决策 #4、#5）
3. `docx` 解析 POC：写一个最小的 `extract_text_from_docx(path) -> String`，验证 `docx-rs` crate 可用；若失败则退路切 `zip` + `quick-xml` 自己解析 `word/document.xml` 的 `<w:t>` 节点
4. `pdf` 文本抽取重构预案：把现有 `books.rs` 里的 pdf 文本抽取抽成 `pdf_text::extract_text(path)`，书籍在此之上叠加元数据抽取

**达成标准**
- [ ] 所有待拍板决策有答案
- [ ] 对一份 10 页 docx 能输出 ≈ 肉眼可读版正文的纯文本
- [ ] `pdf_text::extract_text` 重构通过现有书籍回归测试

---

### Phase B — Schema 重构：`web_clips` → `media_items`（1.5 天）

#### B.1 新表 `media_items`
**文件**：`apps/desktop/src-tauri/src/db.rs`（新增 migration）

字段定稿（对齐 `db.rs` 现有约定：时间戳用 TEXT ISO 8601、`is_*` 前缀、partial unique index 允许软删后重传）：

```sql
CREATE TABLE IF NOT EXISTS media_items (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  media_type           TEXT    NOT NULL,                    -- 'audio' | 'local_video'
  title                TEXT    NOT NULL DEFAULT '',
  file_path            TEXT    NOT NULL,
  file_hash            TEXT    NOT NULL DEFAULT '',         -- 老 audio 行若无 hash，迁移后留空串，新导入流式 sha256 填充
  file_size            INTEGER NOT NULL DEFAULT 0,
  audio_duration_sec   INTEGER NOT NULL DEFAULT 0,          -- 对齐现 web_clips 字段名
  content              TEXT    NOT NULL DEFAULT '',         -- 清洗后可读版
  raw_content          TEXT    NOT NULL DEFAULT '',
  summary              TEXT    NOT NULL DEFAULT '',
  tags                 TEXT    NOT NULL DEFAULT '[]',
  transcription_status TEXT    NOT NULL DEFAULT '',
  transcription_error  TEXT    NOT NULL DEFAULT '',
  transcription_source TEXT    NOT NULL DEFAULT '',
  source_language      TEXT    NOT NULL DEFAULT '',
  translated_content   TEXT    NOT NULL DEFAULT '',
  ai_status            TEXT    NOT NULL DEFAULT 'pending',
  ai_error             TEXT    NOT NULL DEFAULT '',
  is_starred           INTEGER NOT NULL DEFAULT 0,
  is_read              INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at           TEXT
);
-- Partial unique: 软删除 + 空 hash 都不阻塞重传，沿用 books 表经验
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_file_hash_active
  ON media_items(file_hash) WHERE deleted_at IS NULL AND file_hash <> '';
CREATE INDEX IF NOT EXISTS idx_media_items_type    ON media_items(media_type);
CREATE INDEX IF NOT EXISTS idx_media_items_deleted ON media_items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_media_items_created ON media_items(created_at DESC);
```

**达成标准**
- [ ] migration 在空库 / 有旧数据库 两种场景都能成功
- [ ] 幂等（重启应用不重复建表）

#### B.2 `media_items_fts` trigram 触发器
**文件**：`apps/desktop/src-tauri/src/db.rs`

复制 `web_clips_fts` 模板：虚拟表 + INSERT/UPDATE/DELETE 三个触发器。索引字段：`title` / `content` / `tags` / `summary`。

**达成标准**
- [ ] 对 `media_items` 任意写操作 → FTS 行自动同步
- [ ] 新增 Rust 单元测试：写入→FTS 命中；更新→命中新；删除→不再命中

#### B.3 一次性迁移
**文件**：`apps/desktop/src-tauri/src/db.rs`（新增迁移函数 + `app_kv` 幂等标志）

```
1. 检查 app_kv['media_migration_v1'] == 'done'，是则跳过
2. 开事务
3. INSERT INTO media_items (...) SELECT ... FROM web_clips
   WHERE source_type IN ('audio', 'local_video') AND deleted_at IS NULL
4. 对软删除的行同样迁移一份（带 deleted_at）
5. 校验 A：SELECT COUNT(*) FROM media_items == 源行数；不等则 ROLLBACK + panic
6. DELETE FROM web_clips WHERE source_type IN ('audio', 'local_video')
7. 校验 B：SELECT COUNT(*) FROM web_clips WHERE source_type IN ('audio','local_video') == 0；不等则 ROLLBACK + panic
8. app_kv['media_migration_v1'] = 'done'
9. 提交事务
```

**关键原则**
- **INSERT + DELETE 在同一事务内**——原子性保证：要么全部成功，要么全部回滚，不会出现"复制成功但没删掉"或"删掉了但没复制"的半状态
- **双重校验**：INSERT 后比对行数 + DELETE 后确认无残留，任一失败立刻 ROLLBACK + panic
- `app_kv['media_migration_v1']` 幂等标志防重复跑
- ⚠️ 本方案（决策 #1 = B）牺牲了一个版本的回滚窗口。此为用户本次明确选择；**未来类似的 schema 重构事件默认回到 A（保留旧行跨版本）以保护用户数据**

**达成标准**
- [ ] 单元测试：预置 N 条 audio + M 条 local_video 的假数据 → 跑迁移 → `media_items` 恰好 N+M 行且字段一一对应；`web_clips` 里 audio/local_video 残留 = 0
- [ ] 单元测试：软删除行也被迁移且保留 `deleted_at`
- [ ] 单元测试：重复跑 migration 不会重复插入且不报错
- [ ] 单元测试：迁移中途模拟行数校验失败 → 事务 ROLLBACK，`web_clips` 数据无损
- [ ] 手工：拿一份真实的旧数据库跑一次，影音页内容完全一致

#### B.4 后端改写 `audio.rs` / `transcribe.rs`
**文件**：
- `apps/desktop/src-tauri/src/audio.rs`
- `apps/desktop/src-tauri/src/transcribe.rs`
- `apps/desktop/src-tauri/src/main.rs`（命令注册）

改动点：
- `import_audio_file` / `import_local_video_file` → 改写 `media_items`
- `transcribe.rs` 的 ID 查询由 `web_clips` → `media_items`
- Tauri 事件 `transcribe://progress` 的 payload 字段名保持不变（避免前端改动扩散）
- 新增 Tauri 命令：`list_media_items` / `get_media_item` / `delete_media_item` / `restore_media_item`

**达成标准**
- [ ] 新导入 mp3 → 出现在 `media_items`（不再进 `web_clips`）
- [ ] 转录进度条正常推进
- [ ] `cargo test` 全绿

#### B.5 前端 `MediaPage.tsx` 改接口
**文件**：`apps/desktop/src/pages/MediaPage.tsx` + 相关卡片 / 详情组件

把 Tauri invoke 目标从 `list_clips` 等改为 `list_media_items` 等，类型从 `Clip` → 新增 `MediaItem`。

**达成标准**
- [ ] 影音页列表 / 详情 / 搜索 / 删除 / 恢复 所有功能与迁移前行为一致
- [ ] `pnpm typecheck` + `pnpm test` 全绿

#### B.6 搜索聚合
**文件**：`apps/desktop/src-tauri/src/search.rs`

现有结构：`web_clips` + `books` 两路 UNION。新增 `media_items` 一路，沿用现有 bm25 归一化。结果 `kind` 字段扩充："media"。

**达成标准**
- [ ] 主搜索和 QuickSearch 都能找到影音内容并正确分类图标
- [ ] 单元测试覆盖三路合并排序

#### B.7 AI 对话上下文 / Markdown 导出 / 乐色 接入
- `ai.rs` 的 context 拼接：增加 `media_items` 一路
- `export.rs` 的 Markdown 导出：增加影音分组
- 乐色页：影音单独 tab（与剪藏 / 书籍 并列）

**达成标准**
- [ ] AI 对话引用影音内容时引用来源正确指向 media_items
- [ ] Markdown 导出文件包含影音分节
- [ ] 删除的影音可在乐色中恢复

#### B.8 回归测试

**自动化**（✅ 2026-04-22 跑完全绿）
- [x] `cargo test --bin desktop` —— 163 / 163 通过
- [x] `cargo clippy --bin desktop --all-targets -- -D warnings` —— 干净
- [x] `pnpm typecheck` —— 干净
- [x] `pnpm lint` —— 干净（0 warning）
- [x] `pnpm test --run` —— 4 / 4 通过
- [x] `pnpm build` —— bundle 产出成功

**手工端到端验证清单**（累积自 B.4–B.7；pnpm tauri:dev 启动后按顺序跑）

*迁移 & 旧数据*
- [ ] 老用户首次启动 → `media_items` 表建好、老 audio/local_video 行已迁移（查数据库可见 `media_migration_v1 = 'done'`）
- [ ] MediaPage 打开 → 迁移前的老内容完整展示（标题/摘要/标签/笔记/软删状态）
- [ ] 老 clip_notes 里针对 audio/local_video 的笔记已复制到 `media_items.notes`（通过详情页笔记区验证）

*新导入 — 音频*
- [ ] 从 MediaPage 拖入一个 mp3 → `media_items` 插入新行、`file_path`/`file_hash`/`file_size` 存储
- [ ] 转录进度条推进（`transcribe://progress` 事件按 stage 更新）
- [ ] 转录完成 → content / raw_content 填充、summary + tags 生成
- [ ] 非中文音频自动产出中文译文（`translated_content`）、详情页"译文"切换正常
- [ ] 重复拖入同一文件 → 不产生重复行（active file_hash unique），状态重置为 pending 重跑

*新导入 — 本地视频*
- [ ] 从 MediaPage 拖入一个 mp4 → ffmpeg 抽音频 → 走相同管道
- [ ] HomePage dropzone 拖入 mp4 → 正确路由到 MediaPage 并打开详情
- [ ] HomePage dropzone 拖入 mp3 → 正确路由到 MediaPage

*搜索 — unified_search*
- [ ] 主页大搜索框输入媒体内容里的词 → 命中 media kind 结果
- [ ] 点击 media 结果 → 跳 `/media?openClip=<id>` → 详情页打开
- [ ] QuickSearch 浮窗（Cmd+Shift+K / Ctrl+Shift+K）搜同样的词 → 同样结果 + 点击跳转
- [ ] CJK 短查询（1–2 字） → LIKE 兜底能找到 media
- [ ] scope=media 只返 media 结果、scope=clips 不返 media

*详情页 — 编辑 & 交互*
- [ ] 编辑标题 → 保存后列表刷新
- [ ] 编辑摘要 → `update_media_item` 的 summary patch 落库
- [ ] 编辑标签（添加/删除） → tags patch 落库；前端 dedup 生效
- [ ] 手动"让 AI 重新归类" → `ai_auto_tag_media_item`，summary + tags 重新生成
- [ ] 手动"重新翻译" → `ai_translate_media_item`，译文刷新
- [ ] 详情页"标为已读/未读"切换 → `toggle_read_media_item`
- [ ] 详情页自动 mark_read → 打开即置为已读
- [ ] 笔记：新建 / 编辑 / 删除 → 三条路径都走 `save_media_item_notes`（删除 = 存空字符串）

*AI 对话 — B.7 新加*
- [ ] AI Chat Drawer 问一个与 media 内容相关的问题 → 上下文包含 media_items 内容
- [ ] AI 回答附带的引用能跳到对应 media 详情（非 404）

*导出 & 乐色 — B.7 新加*
- [ ] Markdown 导出 → 文件里包含"影音"分节，每条 media 的 title / summary / tags / content 都在
- [ ] 删除一个 media → 乐色页能看到（新增 media tab）
- [ ] 乐色里恢复 → 回到 MediaPage 主列表
- [ ] 乐色里彻底清除 → 行从 media_items 消失

*回归 — web_clips & books*
- [ ] ClipsPage 功能 100% 与迁移前一致（文章/在线视频列表、详情编辑、搜索、对话上下文）
- [ ] BooksPage 功能 100% 与迁移前一致
- [ ] 旧数据的 web_clips 行（article + video）数量无变化

*风险路径*
- [ ] 强制关闭 app 在转录中途 → 重启后 transcription_status 回到可识别状态（pending / failed）不是"卡死"
- [ ] 迁移失败模拟（手动造假数据破坏一致性）→ app 启动时报错阻止启动，不丢数据

---

### Phase C — 新增「文档」顶级内容区（2 天）

#### C.1 新表 `documents` + `documents_fts`
**文件**：`apps/desktop/src-tauri/src/db.rs`

```sql
CREATE TABLE IF NOT EXISTS documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL DEFAULT '',
  file_path      TEXT    NOT NULL,
  file_hash      TEXT    NOT NULL,
  file_format    TEXT    NOT NULL,                          -- 'pdf' | 'docx' | 'md' | 'txt'
  file_size      INTEGER NOT NULL DEFAULT 0,
  word_count     INTEGER NOT NULL DEFAULT 0,
  toc_json       TEXT    NOT NULL DEFAULT '',               -- [{title, level, anchor}, ...]；空串表示无目录
  content        TEXT    NOT NULL DEFAULT '',
  raw_content    TEXT    NOT NULL DEFAULT '',
  summary        TEXT    NOT NULL DEFAULT '',
  tags           TEXT    NOT NULL DEFAULT '[]',
  ai_status      TEXT    NOT NULL DEFAULT 'pending',
  ai_error       TEXT    NOT NULL DEFAULT '',
  is_starred     INTEGER NOT NULL DEFAULT 0,
  is_read        INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  added_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_file_hash_active
  ON documents(file_hash) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_format  ON documents(file_format);
CREATE INDEX IF NOT EXISTS idx_documents_deleted ON documents(deleted_at);
CREATE INDEX IF NOT EXISTS idx_documents_added   ON documents(added_at DESC);
```

+ `documents_fts` trigram 触发器（同 B.2 模板）。

**达成标准**：同 B.1 / B.2。

#### C.2 格式解析（含 TOC 抽取）

每种格式不仅抽正文，也同步生成 `toc_json`（若有章节结构）。

**docx**
**文件**：`apps/desktop/src-tauri/src/docx_extract.rs`（新建）
- 首选 `docx-rs` crate；不可用则退 `zip` + `quick-xml` 手撸
- 正文：提取 `<w:t>` 文本节点，按段落合并，忽略图片 / 表格样式 / 页眉页脚
- TOC：扫描 `<w:pStyle w:val="Heading1..Heading6">` 段落，按 Heading 级别构建树

**md / txt**
直接 `std::fs::read_to_string`。
- md 原样保留正文（AI 清洗阶段处理 Markdown 语法）；TOC：正则 `^(#{1,6})\s+(.+)$` 按 `#` 数量分级
- txt：无 TOC（`toc_json = NULL`）

**pdf**
**文件**：`apps/desktop/src-tauri/src/pdf_text.rs`（由 `books.rs` 抽出）
- `extract_text(path) -> String` 用 `pdf-extract`（主）+ `lopdf`（兜底），和书籍共用
- `extract_outline(path) -> Option<Toc>` 用 `lopdf` 读 PDF `/Outlines` 树构造 TOC（pdf 自带书签时才有；否则返回 None）
- 书籍在此之上叠加元数据抽取，文档只取纯文本 + TOC

**达成标准**
- [ ] 每种格式单元测试：喂入样本文件 → 输出非空文本
- [ ] 带章节的 docx / md / pdf 样本：`toc_json` 非空且层级正确
- [ ] 无章节的 txt / 扫描版 pdf：`toc_json` 为 NULL，不报错
- [ ] 书籍 pdf 路径回归测试通过（未因抽取函数搬家而退化）

#### C.3 后端 `documents.rs`（新建）
**文件**：`apps/desktop/src-tauri/src/documents.rs` + `main.rs`（命令注册）

核心命令：
- `import_document(file_path)` — 单文件导入
- `list_documents(filter)` / `get_document(id)` / `update_document` / `delete_document` / `restore_document`
- `reprocess_document(id)` — 失败时重跑 AI 管道

流程：
1. 流式 sha256 → 去重
2. 按扩展名分派解析（C.2）
3. 写入 `documents`，`ai_status = pending`
4. 投入 `AI_BACKGROUND_TASKS` 后台队列
5. 跑现有三阶段 AI 管道（Raw → Readable → Summary + Tags）——把 `clips.rs` 里的管道抽成 `ai_pipeline::process(content, opts) -> (readable, summary, tags)` 可复用函数
6. 成功 `ai_status = ok`；失败 `ai_status = failed` + `ai_error`

**达成标准**
- [ ] 单元测试：4 种格式各 1 个小样本，`import_document` 返回成功，`documents` 有一条记录且 `content` 非空
- [ ] AI 管道产出 `summary` + `tags`
- [ ] 重复导入同一文件返回"已存在"而非重复插入

#### C.4 前端 `DocumentsPage.tsx`
**文件**：
- `apps/desktop/src/pages/DocumentsPage.tsx`（新建）
- `apps/desktop/src/components/Documents/DocumentCard.tsx`（新建）
- `apps/desktop/src/components/Documents/DocumentDetail.tsx`（新建）

参考 `MediaPage` 的布局：列表视图 + 页内搜索框 + 拖入 dropzone + 详情抽屉。
- 文档卡：文件名 + 格式徽标 + 字数 + AI 摘要前两行 + 标签
- 详情抽屉：标题 / 原文 / 清洗版 / 摘要 / 标签 / 元数据（格式、大小、字数、导入时间、最后打开时间）/ 重跑按钮

**达成标准**
- [ ] 列表正常分页
- [ ] 页内搜索（FTS）工作
- [ ] 空状态有引导文案

#### C.5 左侧导航
**文件**：`apps/desktop/src/components/Layout/NavSidebar.tsx`

插入"文档"项，位置：**主页 / 智库 / 书籍 / 影音 / 文档 / 发现 / 乐色 / 设置**（影音之后、发现之前）。图标用 `lucide-react` 的 `FileText`。

**达成标准**
- [ ] 点击导航跳转 `/documents`
- [ ] 当前路由高亮与其他项一致

#### C.6 路由注册
**文件**：`apps/desktop/src/App.tsx`（或等效的路由入口）

添加 `<Route path="/documents" element={<DocumentsPage />} />`。

#### C.7 主页 dropzone 路由扩展
**文件**：`apps/desktop/src/pages/HomePage.tsx`

```ts
const BOOK_EXTS = ["epub"];                          // 移除 pdf
const DOCUMENT_EXTS = ["pdf", "docx", "md", "txt"];  // 新增
// AUDIO_EXTS / VIDEO_EXTS 不变
```

分派逻辑新增 `else if (DOCUMENT_EXTS.includes(ext)) → invoke("import_document", ...)`。

**达成标准**
- [ ] 主页拖入 pdf → 进文档
- [ ] 主页拖入 docx / md / txt → 进文档
- [ ] 主页拖入 epub → 仍进书籍
- [ ] 文档页内拖入同样走 `import_document`
- [ ] 书籍页内拖入 pdf 仍走 `add_book`（归属规则不破）

#### C.8 搜索聚合
**文件**：`apps/desktop/src-tauri/src/search.rs`

在 B.6 的三路基础上增加 `documents` 第四路。`kind` 扩充："document"。

**达成标准**
- [ ] 主搜索 / QuickSearch 能找到文档并正确分类图标
- [ ] 单元测试覆盖四路合并排序

#### C.9 AI 对话上下文 / Markdown 导出 / 乐色
- `ai.rs`：context 增加 documents 一路
- `export.rs`：Markdown 导出增加"文档"分组
- 乐色页：增加文档 tab（与剪藏 / 书籍 / 影音 并列）

**达成标准**
- [ ] AI 对话可引用文档内容
- [ ] Markdown 导出包含文档
- [ ] 删除的文档可恢复

#### C.10 里程碑（可选，本版本不做）
`milestones.rs` 的四类里程碑目前基于 clip_count / consecutive_days / tag_depth / books_read。本版本**不增加** document_count 里程碑——等上线后看真实使用数据再定义节点。

#### C.11 跨类型移动（书籍 ↔ 文档）
**文件**：
- `apps/desktop/src-tauri/src/documents.rs` + `books.rs`（新增命令）
- `apps/desktop/src/components/Books/BookDetailDrawer.tsx`
- `apps/desktop/src/components/Documents/DocumentDetail.tsx`

核心命令：
- `convert_document_to_book(document_id) -> book_id`：
  1. 开事务
  2. 读 document 行：title / file_path / file_hash / file_size / content / raw_content / summary / tags
  3. INSERT INTO books（映射共通字段；author / publisher / published_year / cover_path 留 NULL；`ai_status = pending` 触发元数据补抽取）
  4. UPDATE documents SET deleted_at = now WHERE id = document_id（软删除，可从乐色恢复）
  5. 提交
- `convert_book_to_document(book_id) -> document_id`：
  1. 开事务
  2. 读 book 行：title / file_path / file_hash / file_size / content / raw_content / summary / tags
  3. INSERT INTO documents（`file_format` 由扩展名推断；书籍专属字段 author / publisher / reading_progress / rating 丢弃；`ai_status = ok` 直接沿用现有 summary/tags）
  4. UPDATE books SET deleted_at = now WHERE id = book_id
  5. 提交

UI：
- 书籍详情抽屉 actions 区新增「移动到文档」按钮 → 确认对话框 → 成功后跳转 `/documents` 并高亮新条目
- 文档详情抽屉同理新增「移动到书籍」按钮 → 跳转 `/books`
- 确认对话框明确说明：「此操作会把本条从『书籍』移到『文档』。可以从乐色恢复原书籍。」

**达成标准**
- [ ] 单元测试：双向转换的 happy path + `file_hash` 保持不变 + 乐色可恢复
- [ ] 单元测试：book → document 后，book 专属字段（cover / rating / progress）确实被丢弃而非悄悄保留
- [ ] 手工：把一个 pdf 上传到"书籍"→ 移到"文档"→ 验证详情 OK → 从乐色恢复原书籍
- [ ] 手工：反向一遍，验证 AI 元数据重跑能补齐

#### C.12 TOC 侧边目录 UI
**文件**：
- `apps/desktop/src/components/common/TocSidebar.tsx`（新建，复用组件）
- `apps/desktop/src/components/Documents/DocumentDetail.tsx`
- `apps/desktop/src/components/Books/BookDetailDrawer.tsx`

能力：
- 解析 `toc_json`（`[{title, level, anchor}]`）渲染为可折叠树
- 点击目录项滚动到正文对应锚点（用 `IntersectionObserver` 追踪当前可视段落并高亮）
- 正文侧 `ClipDetail` 类组件渲染时为每个 heading 自动打 `id` 锚点（docx/md 用解析时携带的 anchor；pdf 按章节标题生成 slug）
- 响应式：`<768px` 窗口折叠成顶部下拉菜单
- `toc_json = NULL` 时整块不渲染（不是"空目录"占位）

**达成标准**
- [ ] pdf 文档（带书签）：TOC 显示章节、点击跳转、当前章节高亮
- [ ] docx 文档（带标题样式）：同上
- [ ] md 文档：基于 `#` 层级的 TOC 可用
- [ ] txt 文档：侧边栏不渲染
- [ ] 书籍详情同样可用（复用组件）
- [ ] 小窗口折叠下拉无溢出
- [ ] 目录项与正文双向同步（滚动正文也高亮对应项）

---

### Phase D — 下版本清理（v2.0.8）

由于决策 #1 = B，迁移事务内已经 DELETE 旧行，v2.0.7 发布后 `web_clips` 里不存在 audio/local_video 残留。v2.0.8 只需：

1. 移除 `db.rs` 中 `media_migration_v1` 幂等代码（`app_kv` 标志可留作档案）
2. 若一切顺利，也可移除 B.4 中为兼容过渡保留的任何遗留读路径

---

## 4. 已决议的关键选择

| # | 决议 | 理由 |
|---|---|---|
| 1 | **旧行立即 DELETE**（B）| 用户明确选择；INSERT + 校验 A + DELETE + 校验 B 在同一事务内完成，一步到位。⚠️ 未来类似 schema 重构默认回到 A（保留旧行跨版本）以更好地保护用户数据 |
| 2 | NavSidebar 顺序：主页 / 智库 / 书籍 / 影音 / **文档** / 发现 / 乐色 / 设置（A）| 最少打断现有用户习惯 |
| 3 | **支持**书籍 ↔ 文档跨类型移动（B）| quality-first 方向；工作量 +0.5 天可接受 |
| 4 | 列名 `media_type`，值保留 `audio` / `local_video`（B）| 修正列语义，零歧义风险 |
| 5a | 现在加 `word_count` | AI 解析时顺手算，零额外成本 |
| 5b | 现在加 `last_opened_at` | 支持"最近访问"排序 |
| 5c | 加字段 **+ 消费 UI**（TOC 侧边目录）| quality-first；半吊子字段无价值。书籍详情也能复用同一组件 |

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 迁移中断（断电 / 崩溃） | 迁移包在单事务；ROLLBACK 自动恢复 `web_clips`；`app_kv` 幂等标志 |
| 行数校验（A 或 B）不过 | 任一不过立刻 ROLLBACK + panic 阻止启动，`web_clips` 数据不损 |
| **决策 #1 = B 带来的零回滚窗口** | 上线前强制完成：(a) B.3 / B.8 单元测试全部覆盖；(b) 真实旧数据库手工跑一遍；(c) beta 内部验证 2–3 天 |
| docx 解析失败 | `ai_status=failed` + `ai_error`；UI 显示重试按钮（复用书籍模式） |
| pdf 抽取函数搬家导致书籍回归 | 函数签名不变，只搬文件；保留现有书籍测试 |
| FTS 索引损坏 | 已有 rebuild 工具；增加 `rebuild_all_fts` 兜底命令（若未存在） |
| 跨类型移动导致 file_hash 冲突 | 双向转换不改文件，`file_hash` 跟随条目走，不会重复 |
| TOC 渲染超长（几百章） | 虚拟滚动（`@tanstack/react-virtual`）或懒加载；目录节点 > 200 时折叠深层 |

**回滚预案**：
- 由于决策 #1 = B，`web_clips` 里旧行已被删除，无法通过"版本回退"恢复
- 仅剩回滚路径：**用户自己的数据库备份**（KnoYoo 在 v2.0.6 之前有「设置 → 数据 → 导出备份」功能）
- 因此上线前**必须**：首次启动迁移前，检查是否存在最近 7 天内的备份；若无，弹窗提示用户先手动备份再继续

---

## 6. 工作量估算

| Phase | 估时 |
|---|---|
| A 准备 | 0.5 天 |
| B schema 重构 | 1.5 天 |
| C 新增文档域（基础） | 2 天 |
| C.11 跨类型移动 | +0.5 天 |
| C.12 TOC 侧边目录 UI | +1 天 |
| **总计（v2.0.7 内完成）** | **5.5 天** |

Phase D（v2.0.8 清理）不计入本次。

---

## 7. 最终验收清单

### 功能
- [ ] 主页拖入 docx / md / txt / pdf → 进文档
- [ ] 主页拖入 epub → 进书籍
- [ ] 主页拖入 mp3 / mp4 → 进影音（走 `media_items`）
- [ ] 书籍页内拖入 pdf → 仍进书籍
- [ ] 文档页显示 / 搜索 / 删除 / 恢复全部正常
- [ ] 文档详情显示 AI 摘要 + 标签 + 重跑按钮
- [ ] 主页统一搜索能找到文档
- [ ] QuickSearch 浮窗能找到文档
- [ ] AI 对话能引用文档内容
- [ ] Markdown 导出包含文档分组
- [ ] 影音页功能 100% 与迁移前一致
- [ ] 老数据完全可见可操作

### 技术
- [ ] `cargo test --all` 全绿
- [ ] `cargo clippy --all-targets -- -D warnings` 全绿
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` 全绿
- [ ] 新 migration 在全新空库上运行成功
- [ ] 新 migration 在有现存 audio / local_video 数据的库上运行成功
- [ ] 迁移幂等（重复跑不报错也不重复插入）

### UX
- [ ] NavSidebar "文档"项位于 **影音 / 发现** 之间
- [ ] 文档图标用 `lucide-react` 的 `FileText`
- [ ] 文档页空状态有引导文案
- [ ] 文档卡片包含：文件名 / 格式徽标 / 字数 / 摘要前两行 / 标签

### 跨类型移动
- [ ] 文档详情"移动到书籍"按钮正常工作
- [ ] 书籍详情"移动到文档"按钮正常工作
- [ ] 确认对话框文案明确、可取消
- [ ] 移动后源条目可在乐色恢复
- [ ] 书 → 文档后，book 专属字段（cover / rating / progress）被丢弃
- [ ] 文档 → 书后，触发 AI 元数据重抽

### TOC 目录
- [ ] PDF 文档 TOC 显示并可点击跳转（有 outline 的情况）
- [ ] DOCX 基于标题样式生成 TOC
- [ ] MD 基于 `#` 层级生成 TOC
- [ ] TXT / 无 outline 的 PDF：侧边栏不渲染
- [ ] 正文滚动时对应目录项高亮
- [ ] 书籍详情复用同一 TOC 组件
- [ ] `<768px` 窗口折叠为顶部下拉

---

*计划版本：v2（决议已落定）· 2026-04-21*
