# KnoYoo v2.0.9 手工验收清单（大白话完整版）

> **基线**：v2.0.9
> 包含的大改动：Phase B 把本地音视频从"智库"表里拆到独立的"影音"表；Phase C 新增了"文档"顶级区（专门放 pdf / docx / md / txt）；顺带改了搜索、AI 对话、乐色、导出等一圈配套。
>
> 这份清单的目的：在你真正开始日常用 v2.0.9 之前，系统性地把**每个改过的地方**都验证一遍，确保没有回归、没有遗漏。

---

## 怎么读这份清单

每条测试有 5 段信息：

- **背景**：这条测试对应的是产品的哪个功能、为什么值得单独验
- **在哪里做**：具体到哪个页面 / 菜单 / 文件 / 终端命令
- **怎么操作**：一步一步的具体动作
- **应该看到什么**：通过的标准（肉眼可见的现象 / sqlite 返回的值）
- **失败意味着什么**：如果不符合标准，大概率是哪段代码挂了，对用户造成什么影响

---

## 开始前的准备

| 需要什么 | 为什么 |
|---|---|
| 一个 mp3（3–5 分钟，不要太长以免转录等半天） | C 段"新音频导入" |
| 一个 mp4（< 50 MB，最好也不要太长） | D 段"新本地视频导入" |
| 一个 docx（故意写 3 个以上用 Heading 样式的标题段落） | M、P 段"docx 带 TOC" |
| 一个 md 文件（里面有几个 `#` 标题） | M、P 段"md 带 TOC" |
| 一个 txt 文件（随便什么内容） | M 段"txt 导入" |
| 一个 pdf（< 10 MB，能文字提取的普通 pdf；扫描版走不通） | M、O 段 |
| 已配置的 AI provider | H 段"AI 对话"必需 |
| 开跑前做一次"设置 → 数据 → 导出备份" | 万一某条把数据搞坏了能回滚 |

**启动方式**：终端 `cd apps/desktop && pnpm tauri:dev` —— 首次编译要 1–2 分钟，耐心等主窗口弹出。

**数据库路径（macOS）**：`~/Library/Application Support/knoyoo.desktop/data/notes.db` —— 清单里很多 sqlite 命令会用到这个。

**建议打开**：DevTools（主窗口右键 → 检查），Console 面板保持可见，所有错误会出现在这里。

---

## A. 启动 & 数据库迁移（最基础的一段，30 秒跑完）

### A.1 应用正常启动，没有白屏也没有报错

#### 背景
v2.0.8 首次发布那天，我们踩过一个坑：schema 迁移缺了一个 `notes` 列，导致 `open_db()` 每次都返回错误，所有功能瞬间全挂。这条是那次事故之后的"最起码的底线检查"。

#### 在哪里做
- 终端里先跑 `ps aux | grep tauri` 看看有没有还在跑的旧 dev server，有的话 `Ctrl+C` 掉
- 然后 `cd apps/desktop && pnpm tauri:dev`

#### 怎么操作
1. 观察终端输出（大约 30 秒内会有 Rust 编译的进度）
2. 等主窗口弹出
3. 同时留意终端里有没有红字

#### 应该看到什么
- 主窗口弹出，显示 HomePage（搜索框居中，下面有四个快捷入口卡：智库 / 书籍 / 影音 / 发现）
- 终端里**没有**这些字样：`schema init failed` / `migration failed` / `media_items insert row-count mismatch` / `PRAGMA foreign_keys` 相关的错
- 主窗口**没有**任何错误弹窗

#### 失败意味着什么
- 主窗口打不开或白屏：可能是 Rust 后端 panic 了
- 终端有 `schema init failed`：schema 迁移挂了，`ensure_schema()` 某一句 SQL 失败。很可能是数据库里有老版本残留状态，或者磁盘空间不足
- 所有界面点了都没反应：`open_db()` 每次都失败，所有命令级联挂掉（v2.0.8 事故重演）

---

### A.2 数据库完整性检查

#### 背景
SQLite 有一个内置的整库体检命令。定期检查避免小问题积累成大损坏。

#### 在哪里做
任意终端。

#### 怎么操作
```bash
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db "PRAGMA integrity_check"
```

#### 应该看到什么
一个字：`ok`

#### 失败意味着什么
输出是别的（比如 "wrong page type" 或列错误）：数据库文件损坏。这种情况需要从最近的备份恢复（设置 → 数据 → 导入备份），或把 `.db` 文件删了让应用重建（**会丢数据**）。

---

### A.3 迁移已完成的标志已设置

#### 背景
Phase B 做了一次数据迁移：把 `web_clips` 表里原本是 `audio` / `local_video` 类型的行，全部搬到新的 `media_items` 表。为了防止重复搬，迁移完成后在 `app_kv` 里记了个旗子 `media_migration_v1 = done`。

#### 在哪里做
终端。

#### 怎么操作
```bash
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "SELECT val FROM app_kv WHERE key='media_migration_v1'"
```

#### 应该看到什么
返回 `done`（一行）。

#### 失败意味着什么
返回空：迁移没运行。如果你的库里本来就没有老 audio/local_video 数据，空串也正常（空库跳过迁移但会立刻把旗子设为 done，所以通常还是该有 done）。如果确实应有数据却没迁，下次启动可能会又尝试迁，或者数据显示错位。

---

### A.4 两张新表（media_items, documents）结构完整

#### 背景
每个新表的字段数必须和代码里的 SELECT 语句对得上。v2.0.8 的坑就是字段少了一个 `notes`，SELECT 语句查不到而炸。

#### 在哪里做
终端。

#### 怎么操作
```bash
# 看 media_items 有没有 24 列，必须含 notes
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "PRAGMA table_info(media_items)" | wc -l

# 看 documents 有没有 21 列
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "PRAGMA table_info(documents)" | wc -l

# 验证关键列都在
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "PRAGMA table_info(media_items)" | grep -E "notes|file_hash|media_type" | wc -l

sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "PRAGMA table_info(documents)" | grep -E "notes|toc_json|word_count|file_format" | wc -l
```

#### 应该看到什么
- `media_items` 24 行
- `documents` 21 行
- 关键列检查：media_items 命中 3 个、documents 命中 4 个

#### 失败意味着什么
少任何一列 → schema 迁移没走完整，后续某个 UI 操作一定会在那一列上翻车（比如保存笔记、查 word_count 等）。

---

### A.5 FTS 虚拟表 + 触发器都在位

#### 背景
KnoYoo 的搜索是 SQLite FTS5 的 trigram（三字一组）全文索引。每张主表有一个同名 `_fts` 虚拟表 + 三个触发器（插入 / 更新 / 删除时自动同步 FTS）。触发器缺了会导致"新建的内容搜不到"。

#### 在哪里做
终端。

#### 怎么操作
```bash
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "SELECT name FROM sqlite_master WHERE name IN (
    'media_items_fts','media_items_ai','media_items_ad','media_items_au',
    'documents_fts','documents_ai','documents_ad','documents_au'
  )"
```

#### 应该看到什么
8 个名字（4 个 media 的 + 4 个 documents 的），顺序不固定。

#### 失败意味着什么
少任意一个 → 搜索索引没建全，新增行的搜索命中率变差或直接丢失。

---

### A.6 老 audio / local_video 已迁出 web_clips

#### 背景
Phase B 的核心是"拆表"：搬完后 `web_clips` 里不该再有 `source_type` 是 audio 或 local_video 的行。旧行全部应在 `media_items` 里。

#### 在哪里做
终端。

#### 怎么操作
```bash
# 这个应该是 0
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "SELECT COUNT(*) FROM web_clips WHERE source_type IN ('audio','local_video')"

# 这个应该等于迁移前的数量（你之前是 2 条 audio）
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "SELECT COUNT(*) FROM media_items"
```

#### 应该看到什么
- 第一条命令返回 `0`
- 第二条返回迁移前 `web_clips` 里 audio+local_video 的总数

#### 失败意味着什么
- 第一条非 0：老数据没删干净，搜索会出现重复结果
- 第二条少了：迁移的 INSERT 漏行，**数据丢失**。赶紧从备份恢复

---

### A.7 第二次启动不重复迁移（幂等性）

#### 背景
迁移只应在"第一次"跑。有了 `media_migration_v1 = done` 的旗子，后续启动应该秒过这一步。

#### 在哪里做
终端 + 主窗口。

#### 怎么操作
1. 关掉 dev server（终端 Ctrl+C）
2. 重新 `pnpm tauri:dev`
3. 观察启动时间和日志

#### 应该看到什么
- 启动没有明显变慢（没再跑一遍迁移）
- 日志里**没有** "migrating N rows" 这种字样（只有第一次会出现）
- `media_items` 行数没变（再查一遍 A.6 的第二条命令）

#### 失败意味着什么
如果又迁了一遍 → 代码层面漏了幂等检查，`media_items` 可能出现重复行。实务中不会坏功能，但污染数据。

---

## B. 老数据保真（如果 A.6 的第二条 > 0 才要跑这段）

> 如果你的库是全新的、没有任何 v2.0.7 时代的音视频，可以整段跳过。

### B.1 影音页能看到迁移后的老内容

#### 背景
迁移把数据搬到了新表 `media_items`，前端 MediaPage 通过新命令 `list_media_items` 查这个表。这条测试"数据看得见"。

#### 在哪里做
KnoYoo 主窗口 → 左侧导航 → 影音（🎧 耳机图标）。

#### 怎么操作
打开影音页。

#### 应该看到什么
- 页面分两栏：上面是"音频"，下面是"本地视频"（有才显示）
- 所有 v2.0.7 时代你记录过的音视频都在
- 每张卡片的标题、AI 摘要、标签、已读状态、星标都和迁移前一致

#### 失败意味着什么
- 空列表：迁移没搬数据过来，或者前端 `list_media_items` 查询挂了
- 某条缺字段（比如没标题）：迁移 INSERT 的 SELECT 字段对得不对，看 sqlite `SELECT * FROM media_items` 核对

---

### B.2 详情页字段完整

#### 背景
迁移复制的是每个字段，不是整行。需要每个字段都核对一遍。

#### 在哪里做
影音页 → 随便点一条老 audio。

#### 怎么操作
1. 点开详情
2. 检查正文（content）
3. 切换到"原始"视图看 raw_content
4. 看摘要和标签
5. 如果原来是非中文，切到"中文译文"

#### 应该看到什么
- 可读正文完整
- 原始视图也有内容
- 摘要 + 3-5 个标签都在
- 译文（如果有）也在

#### 失败意味着什么
某个字段为空 → 迁移 SELECT 漏了那个字段。对照 `db.rs::migrate_media_items_from_web_clips` 的 SELECT 列表排查。

---

### B.3 老笔记也搬过来了

#### 背景
笔记在老库里存在独立的 `clip_notes` 表，外键指向 `web_clips(id)`。如果直接 DELETE web_clips 里的 audio 行，`ON DELETE CASCADE` 会把笔记也删了。所以迁移用 LEFT JOIN 先把笔记复制到 `media_items.notes` 内联字段，再 DELETE。

#### 在哪里做
影音页 → 一条**曾经记过笔记**的 media 的详情。

#### 怎么操作
滚到详情页底部"我的笔记"区。

#### 应该看到什么
原笔记内容完整显示（绿色边框的笔记卡片）。

#### 失败意味着什么
笔记区是空的 → 迁移没复制笔记。**这是数据损失**。赶紧看数据库备份里是否有 `clip_notes` 相关行，手动恢复。

---

### B.4 孤儿笔记已清理

#### 背景
迁移完成后，`clip_notes` 表里不该有指向已消失 `web_clips` 行的"孤儿"笔记——CASCADE DELETE 应该随 web_clips 行的删除自动把它们清了。

#### 在哪里做
终端。

#### 怎么操作
```bash
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "SELECT n.id FROM clip_notes n LEFT JOIN web_clips w ON w.id=n.clip_id WHERE w.id IS NULL"
```

#### 应该看到什么
零行（空输出）。

#### 失败意味着什么
有孤儿笔记 → 级联删除没正确触发。不影响功能（只是冗余数据），但说明 FK 约束行为异常。

---

## C. 新音频导入（Phase B 的核心入口，要认真验）

### C.1 拖 mp3 到影音页触发导入

#### 背景
"拖拽"是 KnoYoo 最主要的加内容方式。Tauri 有原生的拖拽事件机制，前端 MediaPage 有一个监听器覆盖整个页面。

#### 在哪里做
KnoYoo 影音页。

#### 怎么操作
1. 从 Finder 选一个你准备好的 mp3
2. 按住鼠标拖到 KnoYoo 影音页的任意空白区域（不用非要拖到某个按钮上）
3. 松开

#### 应该看到什么
- 拖的过程中：屏幕出现半透明遮罩，正中央写着 "松开以导入到影音"
- 松开后：右侧从窗口右边滑出一个抽屉（该 mp3 的详情抽屉）
- 抽屉顶部有一条细进度条开始动

#### 失败意味着什么
- 遮罩不出现：Tauri 的 `onDragDropEvent` 没注册或被别的页面抢走了
- 遮罩出现但抽屉不开：后端 `import_audio_file` 失败，看 Console 的红字
- 抽屉开了但进度条不动：转录管道没起来，大概率是 ASR 的 API Key 没配或网络问题

---

### C.2 三阶段进度条依次推进

#### 背景
音频导入后会走三段 AI 管道：转录 → 清洗 → 生成摘要标签。前端通过 Tauri 事件 `transcribe://progress` 实时显示。

#### 在哪里做
C.1 打开的详情抽屉顶部进度条区域。

#### 怎么操作
就等着，观察文案变化。

#### 应该看到什么
依次经过：
1. `正在转录`（ASR 阶段，最慢，3-5 分钟音频通常 30 秒-2 分钟）
2. `AI 清洗为可读版`（几秒）
3. `生成摘要与标签`（几秒）
4. 进度条走满消失

#### 失败意味着什么
- 卡在"正在转录"不动：ASR 调用挂了。检查设置 → 视频转录 → API Key
- 卡在"AI 清洗为可读版"：AI 供应商配置问题
- 报"转录失败"：看具体错误文案，通常是 API 额度 / 密钥 / 网络

---

### C.3 正文区显示可读 Markdown

#### 背景
转录完成后，AI 把 ASR 输出的大段文本清洗成可读版（保留原信息但去除重复、加分段），写到 `content` 字段。

#### 在哪里做
同 C.2 的详情抽屉，等进度条消失后看正文区。

#### 怎么操作
读一下内容。

#### 应该看到什么
- 正文是可读的中文（或英文，看原始）
- 有分段，可能有 Markdown 格式（列表 / 引用块）
- 不是一大坨没断句的连续文本

#### 失败意味着什么
- 空白：`save_raw_transcript` 或 `ai_clean_clip_inner` 挂了
- 乱码：编码问题，这个罕见
- 一坨没清洗的：AI 清洗失败，但保底仍然把原始转录放出来

---

### C.4 摘要和标签自动生成

#### 背景
管道第三步：AI 根据内容生成简短摘要和 3-5 个中文标签。

#### 在哪里做
详情抽屉标题下方的摘要块 + 标签块。

#### 怎么操作
看一眼。

#### 应该看到什么
- 摘要块显示 2-3 句中文描述该内容
- 下方有 3-5 个小标签（蓝色胶囊形状）

#### 失败意味着什么
- 空摘要 + 空标签：`auto_tag_clip_inner` 挂了，或 AI 返回非法 JSON。看 Console
- 标签不是中文：AI prompt 没生效（罕见）

---

### C.5 数据库里字段完整

#### 背景
Phase B 重构让 audio.rs 不仅存 hash，还存 `file_path` / `file_size`，为将来"重新转录"铺路。

#### 在哪里做
终端。

#### 怎么操作
```bash
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "SELECT media_type,file_path,file_hash,file_size FROM media_items ORDER BY id DESC LIMIT 1"
```

#### 应该看到什么
四列都有值：
- `media_type` 是 `audio`
- `file_path` 是你刚拖的文件的绝对路径
- `file_hash` 是 64 位十六进制字符串
- `file_size` 是字节数（非 0）

#### 失败意味着什么
某列空 → `audio.rs::upsert_media_row` 的参数绑定遗漏。

---

### C.6 同一文件重复拖入不会重复入库

#### 背景
每个文件的 SHA-256 hash 在 DB 里是 `UNIQUE`（对活跃行）。重复拖同一个文件应该复用原行、重新跑一次转录，不产生第二条。

#### 在哪里做
影音页。

#### 怎么操作
1. 再次拖 C.1 那个 mp3
2. 观察列表条数和 sqlite

#### 应该看到什么
- 影音页条目数量**没变**
- 原详情抽屉打开，`transcription_status` 重新变回"正在转录"开始新一轮
- `sqlite3 ... "SELECT COUNT(*) FROM media_items"` 数量没增

#### 失败意味着什么
- 多了新行：dedup 逻辑没生效，UNIQUE 索引可能没建
- 报错"已在"且不重跑：可以，但你可能希望能重跑（视 UX 需求）

---

### C.7 非中文音频自动生成译文

#### 背景
Phase B 带来的 `ai_translate_clip_inner` 对 media 生效：识别源语言，如果不是中文就把 content 翻译成中文写入 `translated_content`。

#### 在哪里做
一个**英语或日语**的音频（需要你自备一个外语素材）。

#### 怎么操作
拖进去，等管道全部跑完（包括进度条的最后阶段可能有"生成译文"）。

#### 应该看到什么
- 详情页正文区右上出现视图切换：`可读版 / 原始 / 中文译文`
- 点"中文译文"显示完整翻译

#### 失败意味着什么
- 没"中文译文"选项：`ai_translate_clip_inner` 挂了，或源语言被判为 zh
- 译文空：AI 返回了但解析失败，看 sqlite `translated_content` 字段

---

## D. 新本地视频导入

### D.1 拖 mp4 触发 ffmpeg 抽音频

#### 背景
本地视频的转录是：先用 ffmpeg 从视频里抽出音轨（mono 16kHz mp3），然后走和音频一样的 ASR 管道。ffmpeg 作为 sidecar 二进制随 app 一起打包。

#### 在哪里做
影音页。

#### 怎么操作
拖一个 mp4 进去。

#### 应该看到什么
- 详情抽屉打开
- 进度条阶段名：先是提取阶段（可能没 UI 文案，但能看到进度推进），然后出现"正在转录"

#### 失败意味着什么
- 报"ffmpeg sidecar 解析失败"：打包时没正确带上 ffmpeg，或者 ffmpeg 权限问题
- 抽出来但转录失败：看错误文案，大概率是和音频同样的 ASR / AI 配置

---

### D.2 media_type 是 local_video

#### 背景
视频和音频共用 `media_items` 表，但 `media_type` 字段要区分，影响影音页的分栏渲染。

#### 在哪里做
终端。

#### 怎么操作
```bash
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "SELECT media_type FROM media_items ORDER BY id DESC LIMIT 1"
```

#### 应该看到什么
`local_video`

#### 失败意味着什么
如果是 `audio` → `import_local_video_file` 写错了 media_type，导致界面上出现在"音频"栏（实际是视频）。

---

### D.3 视频导入后其余流程同音频

#### 背景
抽完音频后，剩下的管道（ASR → AI 清洗 → 摘要标签）和音频完全一样。

#### 在哪里做
详情抽屉 + sqlite。

#### 怎么操作
和 C.3 / C.4 / C.5 一样，检查 content / summary / tags / file_path / file_hash。

#### 应该看到什么
全齐。

#### 失败意味着什么
基本不会单独失败——如果 C 段通过了但 D 这条挂，大概率是 ffmpeg 抽出来的音频格式不对（但 sidecar 配置是"mono 16kHz mp3"，所有供应商都支持）。

---

## E. 主页拖拽分流（Phase C 改过的关键路径）

> 主页是"懒人通道"：用户拖什么进来，KnoYoo 自己分流到合适的页面。Phase C 把 pdf 的默认目的地从 /books 改成 /documents。

### E.1 主页拖 mp3 → 影音页

#### 背景
音频文件的扩展名属于 `AUDIO_EXTS`，分流到 `import_audio_file`，然后跳转 `/media?openClip=<id>`。

#### 在哪里做
KnoYoo 主页（左侧导航最上面的"主页"）。

#### 怎么操作
从 Finder 拖一个 mp3 到主页的任意空白（不要拖到搜索框里）。

#### 应该看到什么
- 遮罩显示（同 C.1 那种）
- 松开后 URL 变成 `http://localhost:1420/media?openClip=<数字>`
- 影音页打开，该 mp3 的详情自动弹出

#### 失败意味着什么
- 没反应：HomePage 的 dropzone 监听器坏了
- 去了错误页面：`importOne` 分流逻辑判错（检查扩展名列表）

---

### E.2 主页拖 mp4 → 影音页

同 E.1，只是文件换成 mp4。URL 应该是 `/media?openClip=<id>`。

---

### E.3 主页拖 epub → 书籍页

#### 背景
epub 是纯书籍格式，`BOOK_EXTS` 只剩它一个（Phase C 把 pdf 拿走了）。

#### 在哪里做
主页。

#### 怎么操作
拖一个 epub。

#### 应该看到什么
跳 `/books`（书籍页），epub 进入导入流程。

#### 失败意味着什么
去了文档页 → 扩展名分流搞反了。

---

### E.4 主页拖 **pdf** → 文档页（Phase C 核心决策）

#### 背景
这是 Phase C 里你拍板的重要产品决策：**"懒人通道"默认把 pdf 视作文档**。只有你明确拖到 /books 页才算书。这样的逻辑是：大多数临时塞进来的 pdf 是笔记、资料、报告，只有少数是真正的"书"。

#### 在哪里做
主页。

#### 怎么操作
拖一个 pdf。

#### 应该看到什么
- URL 变成 `/documents?openDocument=<id>`
- 文档页打开，该 pdf 的详情弹出
- 几秒后正文、摘要、标签陆续出来

#### 失败意味着什么
- 如果去了 /books（旧行为）→ `HomePage.tsx::importOne` 里的 `BOOK_EXTS` 和 `DOCUMENT_EXTS` 定义没更新
- 这条失败会让用户以为"pdf 到底去哪儿了"

---

### E.5 照片 App 的文件不能直接拖入

#### 背景
macOS Photos App 的拖拽会暴露一个内部临时路径（`.photoslibrary/` 开头）。这个路径在 Photos 重整理内容后就失效。所以我们显式拦截这种路径，引导用户"先导出来"。

#### 在哪里做
主页或影音页或文档页（三处都做了拦截）。

#### 怎么操作
1. 打开 macOS 照片 App
2. 选一个视频
3. 直接拖到 KnoYoo 窗口里（不点"导出"）

#### 应该看到什么
toast（右上角通知）显示类似：`"『照片』App 的文件不能直接拖入。请先……导出……"`，**不是**"不支持格式"。

#### 失败意味着什么
- 显示通用"不支持"：`.photoslibrary/` 检查漏了这个拖拽区
- 直接接受并入库：**潜在的数据丢失**，因为 Photos 会清理那个内部文件，最后 `file_path` 指向空洞

---

### E.6 主页拖 docx → 文档页

#### 背景
Phase C 新增的分流分支。

#### 在哪里做
主页。

#### 怎么操作
拖一个 docx。

#### 应该看到什么
- 跳 `/documents?openDocument=<id>`
- 文档详情显示 content（带 `# 标题` 格式的 Markdown）
- 正文上方出现"目录 (N)"收缩条

#### 失败意味着什么
- 去别的页：分流错误
- content 没有 `# 标题` 语法：`doc_extract::parse_docx_xml` 没把 Heading 段落转成 Markdown（Phase C.12 修复点）

---

### E.7 主页拖 md → 文档页

#### 在哪里做
主页。

#### 怎么操作
拖一个 md。

#### 应该看到什么
- 跳 `/documents?openDocument=<id>`
- content 保留原 Markdown（不修改）
- 如果文件本身有 `#` 标题且 ≥3 个，出现"目录"收缩条

#### 失败意味着什么
内容被破坏：读文件时编码问题，或 `extract_md` 修改了字节。

---

### E.8 主页拖 txt → 文档页

同 E.7，但 txt 没标题所以**不显示**"目录"收缩条。

---

### E.9 主页拖不支持的格式

#### 背景
除了 audio / video / book / document 四类，其余格式应该有**明确的拒绝提示**（不是静默失败）。

#### 在哪里做
主页。

#### 怎么操作
拖一个 .xlsx 或 .zip 或 .rtf。

#### 应该看到什么
toast 显示：`"不支持的文件格式：.xlsx"`（或具体扩展名）。

#### 失败意味着什么
没 toast 静默吞掉 → 用户困惑为什么拖了没反应，找不到错误原因。

---

### E.10 主页快捷卡片还能正确导航

#### 背景
主页在搜索框下方有 4 张快捷卡（智库 / 书籍 / 影音 / 发现），不涉及改动但要回归。

#### 在哪里做
主页（搜索框为空时）。

#### 怎么操作
依次点 4 张卡。

#### 应该看到什么
分别跳 `/clips` / `/books` / `/media` / `/discover`。

#### 失败意味着什么
路由挂了或 SHORTCUTS 配置错。

---

## F. 搜索（主页大搜索框 + QuickSearch 浮窗）

### F.1 主页搜索命中 media

#### 背景
搜索使用 SQLite FTS5 的 trigram 索引，可以快速检索中英文短词。Phase B.6 让 media_items 有了自己的搜索路径。

#### 在哪里做
主页搜索框。

#### 怎么操作
1. 输入你某个 media 内容里出现过的词（比如你的 mp3 讲了"马拉松训练"，搜 "马拉松"）
2. 等结果列表出现

#### 应该看到什么
- 结果列表里能看到 media kind 的条目
- 每条有图标（🎧 耳机 = audio，🎬 影像 = local_video）
- 右上 label 显示"影音"
- 标题、摘要片段对得上

#### 失败意味着什么
- 无结果但该有：FTS 索引没建好或触发器没同步
- 有结果但 kind 错：`search.rs::search_media_fts` 返回的 kind 字段不对

---

### F.2 点击 media 结果跳转到详情

#### 在哪里做
F.1 的结果列表。

#### 怎么操作
用鼠标点其中一条 media 结果，或用键盘上下箭头选中后 Enter。

#### 应该看到什么
- URL 变成 `/media?openClip=<id>`
- 影音页打开，对应详情自动展开

#### 失败意味着什么
- 跳错页：`HomePage.tsx` 的 `choose(hit)` 分支错
- 跳对了但详情没开：MediaPage 的 `openClip` deep-link 没消费

---

### F.3 QuickSearch 浮窗

#### 背景
QuickSearch 是全局快捷键（默认 `Cmd+Shift+K` / `Ctrl+Shift+K`）召唤的 Spotlight 风格浮窗。主窗口可以不在前台。

#### 在哪里做
任意位置（可以切到别的 app 测试）。

#### 怎么操作
1. 按快捷键
2. 浮窗弹出后输入同 F.1 的词
3. 用 ↑↓ 选中结果，Enter 跳转

#### 应该看到什么
- 浮窗出现（macOS 上带磨砂透明效果）
- 输入即搜，结果和 F.1 一致
- Enter 后主窗口弹出前台，跳到对应详情

#### 失败意味着什么
- 快捷键不响应：`shortcut.rs` 注册挂了或系统抢占了这个组合
- 浮窗出但没结果：`unified_search` 没返回 / 网络延迟（极少见，SQLite 本地很快）

---

### F.4 主页搜索命中 document（Phase C.8 核心）

#### 在哪里做
主页。

#### 怎么操作
搜一个你某个 document 里出现的词。

#### 应该看到什么
结果有 document kind 的条目（📄 绿色图标，label "文档"）。

#### 失败意味着什么
- 搜不到：`search_documents_fts` 没注册或 FTS 索引有问题
- kind 不是 "document"：`KIND_DOCUMENT` 常量没用对

---

### F.5 点击 document 结果跳转

#### 在哪里做
F.4 结果列表。

#### 怎么操作
点 document 结果。

#### 应该看到什么
URL 变 `/documents?openDocument=<id>`，文档详情打开。

#### 失败意味着什么
`HomePage.tsx::choose` 的 document 分支没加。

---

### F.6 QuickSearch 也能命中 document

重复 F.3 + F.4 的组合：`Cmd+Shift+K` → 搜同一词 → 看到 document 条目 → Enter 跳转。

#### 失败意味着什么
`useQuickSearchNavigation.ts` 的 `kind === "document"` 分支没加。

---

### F.7 中文单字/双字短查询兜底

#### 背景
trigram 索引至少要 3 字。短于 3 字（比如"爸爸"2 字）走 LIKE 兜底。

#### 在哪里做
主页。

#### 怎么操作
1. 输入 1 字 CJK（如"声"或"好"）—— 如果库里有含这个字的内容
2. 再输入 2 字 CJK（如"爸爸"）

#### 应该看到什么
都有结果（不是空列表）。

#### 失败意味着什么
空结果 → LIKE 兜底路径挂了，4 种 kind 都应该兜底。

---

### F.8 同屏能看到 4 种 kind

#### 背景
`unified_search` 是四路 UNION：clip + media + document + book。

#### 在哪里做
主页。

#### 怎么操作
搜一个通用词（如"系统"或"笔记"），最好这个词在 4 种内容里都能命中。

#### 应该看到什么
同一屏里能看到 clip / media / document / book 四种图标的条目（颜色各异：蓝 / 口色 / 绿 / 金）。

#### 失败意味着什么
某一类缺：那一路的搜索函数或 scope 判定出问题。

---

## G. 详情页编辑（三种 kind 都要测，因为是共用组件 ClipDetail）

> ClipDetail 是 900 行的共享组件，通过 `kind` prop 区分是 web / media / document。每种 kind 对应一套命令名字映射。

### G.1 标题编辑

#### 背景
最常用的编辑动作之一。三种 kind 都走 `update` 命令但 payload 形状略有不同（web 是扁平 `{summary: ...}`，media/document 是嵌套 `{patch: {summary: ...}}`）。

#### 在哪里做
任一 kind 的详情页。

#### 怎么操作
1. 点标题旁边的铅笔图标
2. 改几个字
3. 点确认（或按 Enter）

#### 应该看到什么
- 标题立即显示新内容
- 左侧列表里对应的条目也更新（刷新了列表）
- `sqlite3 notes.db "SELECT title FROM <表> WHERE id=?"` 对得上

#### 失败意味着什么
- 没保存：`cmds.update` 映射错了
- 保存但列表没更新：前端的 `loadXXX` 回调没被触发

---

### G.2 摘要编辑

同 G.1，只是改摘要（summary）字段。

---

### G.3 加标签 / 删标签

#### 在哪里做
详情页标签区。

#### 怎么操作
1. 点"+"或类似的加号按钮
2. 输入新标签
3. 点现有标签旁的 X 删除

#### 应该看到什么
- 加：标签卡片出现
- 删：消失
- sqlite `tags` 列是合法 JSON 数组（`["a","b"]`）

#### 失败意味着什么
- 重复标签没去重：后端的 dedup 挂了
- 标签 > 200 字符没被截断：`update_media_item` / `update_document` 的 sanitize 漏了

---

### G.4 点"让 AI 重新归类"按钮

#### 背景
如果你觉得 AI 自动生成的 summary/tags 不对，可以手动触发重跑。

#### 在哪里做
详情页摘要右侧的旋转箭头图标（RotateCcw）。

#### 怎么操作
点它，等几秒。

#### 应该看到什么
summary 和 tags 被替换为新生成的（内容会变化）。

#### 失败意味着什么
- 点了没反应：AI 调用挂（检查 API Key）
- 报错：看 toast 内容

---

### G.5 点"AI 翻译"按钮（仅 web / media，不出现在 document）

#### 背景
翻译需要 `source_language` + `translated_content` 字段。web_clips 和 media_items 有这两列，documents 的 v1 schema 没有，所以 document 的详情页**不显示**这个按钮。

#### 在哪里做
- web clip 或 media 详情页：正文上方右侧"AI 翻译"按钮
- document 详情页：**这里不该有这个按钮**

#### 怎么操作
- web/media：点按钮，等待
- document：对比两种详情页，确认按钮确实没出现

#### 应该看到什么
- web/media：toast 显示"已生成 XX → 中文译文"；视图切换多了"中文译文"选项
- document：**完全不出现**翻译按钮

#### 失败意味着什么
- document 上出现按钮：`cmds.aiTranslate` 门控失效
- 按钮可点但无效：后端 `ai_translate_clip_inner` 对 Document target 没早返回

---

### G.6 首次打开详情自动标为已读

#### 背景
KnoYoo 有"已读/未读"管理。首次打开详情应该自动把未读置为已读。

#### 在哪里做
一个处于"未读"状态的任意 kind 条目。

#### 怎么操作
点进详情。

#### 应该看到什么
- 列表卡片上的未读指示（小红点/蓝点）消失
- sqlite `is_read = 1`

#### 失败意味着什么
- `mark_*_read` 命令没触发
- document 还有 `last_opened_at` 字段也该更新

---

### G.7 手动切换已读/未读

#### 在哪里做
详情页顶部操作栏的"已读"按钮。

#### 怎么操作
点一下 → 再点一下。

#### 应该看到什么
状态在"已读 ↔ 未读"间翻转，列表同步。

#### 失败意味着什么
`cmds.toggleRead` 分支错了。

---

### G.8 写笔记保存

#### 背景
笔记的存储方式因 kind 不同：
- web：独立表 `clip_notes`
- media / document：同一行的 `notes` 内联字段

#### 在哪里做
详情页底部"我的笔记"区域。

#### 怎么操作
1. 点"添加笔记"（如果没笔记）或现有笔记的铅笔
2. 写几行
3. 保存

#### 应该看到什么
- 笔记区显示你写的内容（绿色边框卡片）
- sqlite 对应字段非空：
  - web：`SELECT content FROM clip_notes WHERE clip_id=?`
  - media：`SELECT notes FROM media_items WHERE id=?`
  - document：`SELECT notes FROM documents WHERE id=?`

#### 失败意味着什么
写了但没保存：三种 kind 对应不同的保存命令路由错了。

---

### G.9 编辑笔记

G.8 之后，点笔记卡右上的铅笔，改内容，再保存。应该看到新内容。

---

### G.10 删除笔记

#### 在哪里做
笔记卡右上的 🗑 图标。

#### 怎么操作
点它。

#### 应该看到什么
- 笔记卡消失
- web：clip_notes 行被物理删除
- media/document：`notes = ''`（空字符串，不是 NULL）

#### 失败意味着什么
- 点了没反应：删除命令没 invoke
- sqlite 依然有值：删除写回的是 null 而非空串（对于 media/document 会违反 NOT NULL 约束）

---

### G.11 原始 / 可读版 / 译文 三视图切换

#### 在哪里做
正文上方右侧的视图切换按钮（有"可读版 / 原始 / 中文译文"三个选项，根据数据动态显示）。

#### 怎么操作
点不同视图按钮。

#### 应该看到什么
正文内容切换，三个视图对应不同的数据字段（content / raw_content / translated_content）。

#### 失败意味着什么
切了没换：前端 `viewMode` state 或数据字段读错。

---

## H. AI 对话 + 引用（Phase B.7 + C.9 扩展）

> **前置**：设置 → AI → 配好一个 provider（DeepSeek / OpenAI / Ollama 都行）。不配这个 H 段跑不了。

### H.1 AI Chat Drawer 正常打开

#### 在哪里做
主窗口右下角悬浮的 💬 图标。

#### 怎么操作
点它。

#### 应该看到什么
从右侧滑出 Chat Drawer，顶部有"新对话 / 会话列表"切换。

#### 失败意味着什么
打不开：组件挂载报错，看 Console。

---

### H.2 问网页剪藏相关问题，AI 用 [CLIP:N] 引用

#### 背景
AI 对话会把最近 20 条 web_clips 装到系统 prompt 里。AI 被指示："引用时用 `[CLIP:数字]`"。后端解析所有 `[CLIP:N]` 片段，验证 id 在白名单（防止 AI 瞎编），返回 `referenced_clip_ids`。

#### 在哪里做
Chat Drawer 输入框。

#### 怎么操作
问一个和某网页剪藏相关的问题（比如你刚剪藏了一篇文章，就问"那篇讲 XX 的文章关键观点是什么"）。

#### 应该看到什么
- AI 回答里有 `[CLIP:123]` 格式的引用标记（数字不一定是 123，是实际 id）
- 回答下方出现"引用来源"卡片，里面一行 "剪藏 · 〈文章标题〉"

#### 失败意味着什么
- 回答里没 `[CLIP:N]`：AI 没理解 prompt 指令，或 provider 不配合（换个 provider 试）
- 有 `[CLIP:N]` 但引用卡不显示：`ChatDrawer` 的渲染分支挂了

---

### H.3 问影音相关问题，AI 用 [MEDIA:N] 引用

同 H.2 但内容是 media。引用卡显示 "影音 · 〈标题〉"。

---

### H.4 问文档相关问题，AI 用 [DOC:N] 引用（Phase C.9 核心）

#### 在哪里做
Chat Drawer。

#### 怎么操作
问一个某 document 的内容相关的问题。

#### 应该看到什么
- AI 回答含 `[DOC:数字]`
- 引用卡显示 "文档 · 〈标题〉"

#### 失败意味着什么
- 回答没 `[DOC:N]`：Phase C.9 的 prompt 指令没生效（`ai.rs::ai_chat_with_context` 里改过的字符串）
- 引用卡没"文档"分类：`ChatDrawer` 的 `referencedDocuments` 渲染没加

---

### H.5 同时涉及三种来源的问题，引用卡一起列出

#### 在哪里做
Chat Drawer。

#### 怎么操作
问一个能跨类型命中的问题（比如你的剪藏、影音、文档都讨论过"分布式系统"，就问"我收藏过哪些讨论分布式系统的内容"）。

#### 应该看到什么
引用卡片里**并列**出现三种：
- 剪藏 · 〈标题〉
- 影音 · 〈标题〉
- 文档 · 〈标题〉

#### 失败意味着什么
缺某一类 → 该类的 state 或渲染分支缺失。

---

### H.6 新对话清掉旧引用

#### 在哪里做
Chat Drawer 顶部"+"按钮。

#### 怎么操作
点它开新会话，发一条新消息。

#### 应该看到什么
- 上一会话的引用卡消失
- 新消息的引用独立

#### 失败意味着什么
引用串到新会话 → 三个 setReferenced* state 的清空没调齐。

---

### H.7 切换旧会话

#### 背景
会话会持久化到数据库（chat_sessions 表）。切换能看到旧消息但引用卡**不重新拉**（引用只在对应回复当场生成那一刻显示，不存持久化）。

#### 在哪里做
Chat Drawer 顶部会话下拉。

#### 怎么操作
选一个历史会话。

#### 应该看到什么
- 老消息重现
- 老消息下方的引用卡**不显示**（这个是正常的，因为引用数据是即时的）

#### 失败意味着什么
老消息都没显示 → `chat_sessions` 表查询挂了。

---

### H.8 抗幻觉（AI 不瞎编 id）

#### 背景
防止 AI 编 `[DOC:9999]` 这种不存在的 id，后端会拿 `referenced_*_ids` 对照当次上下文的白名单，白名单外的 id 直接过滤掉。

#### 在哪里做
Chat Drawer。

#### 怎么操作
问一个智库肯定没有的话题（如"阿波罗 17 号月面着陆的详细数据"）。

#### 应该看到什么
- AI 要么不给引用
- 要么明确说"你的智库里没有相关内容"
- 绝对不编一个看起来像真的的 `[DOC:42]`

#### 失败意味着什么
出现伪引用：`extract_referenced_ids` 的白名单过滤失效，点击会跳到不存在的条目。

---

### H.9 老 [ID:N] 格式兼容（v2.0.8 之前的会话）

#### 背景
v2.0.8 之前的 AI 引用格式是 `[ID:数字]`，v2.0.8+ 改为 `[CLIP:数字]`。为了老聊天记录不失效，后端把 `[ID:N]` 解析为 CLIP。

#### 在哪里做
如果你有 v2.0.8 之前的聊天记录，打开一个看看。

#### 怎么操作
切回老会话，看 AI 回答里 `[ID:42]` 的地方。

#### 应该看到什么
引用卡能显示（而不是忽略这条 legacy 引用）。

#### 失败意味着什么
老会话引用丢失 → `extract_referenced_ids(content, "ID", ...)` 的 legacy 分支没跑。

---

## I. 乐色（删除 / 恢复 / 永久清除）

### I.1 从影音页删一条

#### 在哪里做
影音页某个条目卡片。

#### 怎么操作
卡片右上"..."菜单或悬浮按钮 → 删除。

#### 应该看到什么
条目从影音页消失。

#### 失败意味着什么
`delete_media_item` 命令挂了或前端 state 没同步。

---

### I.2 乐色页有**四个** tab（Phase B + C 扩到四个）

#### 背景
乐色（回收站）用 segmented control 分 tab。v2.0.7 是 2 个（剪藏 + 书籍），Phase B 加了"影音"，Phase C 又加了"文档"。

#### 在哪里做
左侧导航 → 乐色。

#### 怎么操作
看顶部 tab。

#### 应该看到什么
四个 tab 从左到右：剪藏 / 书籍 / 影音 / 文档。每个 tab 标签后带计数（如 `影音 · 1`）。

#### 失败意味着什么
少 tab → `TrashPage.tsx` 的 tab 配置没扩；计数错 → `count_*_trash` 命令返回有问题。

---

### I.3 影音 tab 能看到刚删的，恢复回来

#### 在哪里做
乐色 → 影音 tab。

#### 怎么操作
找到刚 I.1 删的那条，点"恢复"。

#### 应该看到什么
- toast "已恢复"
- 该条回到影音页主列表
- 乐色里该 tab 计数 -1

#### 失败意味着什么
恢复失败 → `restore_media_item` 命令挂了。

---

### I.4 影音 tab 永久删除

#### 在哪里做
乐色 → 影音 tab。

#### 怎么操作
再删一条进乐色，然后在乐色里点这条的"永久删除"。

#### 应该看到什么
- 从乐色列表消失
- sqlite `SELECT * FROM media_items WHERE id=?` 完全没了

#### 失败意味着什么
sqlite 里还有 → `purge_media_item` 命令挂了。

---

### I.5 清空影音乐色

#### 在哪里做
乐色 → 影音 tab（有条目时）→ 右上"清空影音乐色"按钮。

#### 怎么操作
点它 → 确认对话框 → 确认。

#### 应该看到什么
所有该 tab 的条目一次清光。

#### 失败意味着什么
部分没清 → `empty_media_trash` 只删了一部分。

---

### I.6 文档 tab 恢复（Phase C 核心）

先从文档页删一条 → 乐色 → 文档 tab → 恢复 → 回文档页。同 I.3 逻辑，只是换成 document 命令路径。

---

### I.7 文档 tab 永久删除（含物理文件清理）

#### 背景
文档和音频/视频不同：音频/视频不把文件拷贝到 app 目录（只记 hash），文档会把文件**拷到** `documents/` 目录，所以永久删时要**同时删物理文件**。

#### 在哪里做
乐色 → 文档 tab → 某条 → 永久删除。

#### 怎么操作
记住该文档的 file_path（sqlite 查），点永久删除后检查文件是否被删。

#### 应该看到什么
- sqlite 行消失
- 对应的 `~/Library/Application Support/knoyoo.desktop/data/documents/<hash>.<ext>` 文件**也被删**

#### 失败意味着什么
- sqlite 没了但文件还在：磁盘慢慢堆积"孤儿文件"，几年后占几个 GB
- 文件没了但 sqlite 还有：下次访问会报"文件不存在"

---

### I.8 清空文档乐色

同 I.5，但是对 documents。额外要验：所有物理文件都被清理。

---

### I.9 剪藏 / 书籍 tab 行为不变

Phase B/C 不该影响原有的 tab。进剪藏、书籍 tab 各自删一条、恢复、清空，确认流程和 v2.0.7 一样。

---

## J. 导出 Markdown

### J.1 web clip 导出（旧功能回归）

#### 在哪里做
任一 web clip（智库里的文章）的详情页顶部工具栏 → 下载图标。

#### 怎么操作
点下载 → 选保存位置。

#### 应该看到什么
生成 .md 文件；YAML frontmatter 有 title / url / tags / source_type；正文是清洗后的 Markdown。

#### 失败意味着什么
`export_clip_to_file` 命令挂了。

---

### J.2 media 导出（Phase B.7 新命令，用 Console 跑）

#### 背景
UI 的"下载"按钮目前走 `export_clip_to_file`（web 版本），因为 MediaPage 用了"把 MediaItem 伪装成 WebClip 喂给 ClipDetail"的适配策略。真正的 media-specific 导出命令只能从 DevTools Console 调。这是已知的简化（后续可以加 UI）。

#### 在哪里做
主窗口 DevTools → Console 面板。

#### 怎么操作
```js
await window.__TAURI__.core.invoke("export_media_item_to_file", {
  id: <某个 media id>,
  path: "/tmp/knoyoo-media.md"
})
```

（把 `<某个 media id>` 换成真 id，sqlite 查一下）

#### 应该看到什么
- 返回 `null`，没异常
- `/tmp/knoyoo-media.md` 生成
- frontmatter 有 `media_type` / `file_hash` / `file_path` / `tags`

#### 失败意味着什么
- 命令 not found：`main.rs` 没注册
- 写文件失败：`/tmp` 权限问题（罕见）

---

### J.3 document 导出（Phase C.9 新命令，也从 Console 跑）

#### 在哪里做
DevTools Console。

#### 怎么操作
```js
await window.__TAURI__.core.invoke("export_document_to_file", {
  id: <某个 document id>,
  path: "/tmp/knoyoo-doc.md"
})
```

#### 应该看到什么
- 返回 `null`
- `/tmp/knoyoo-doc.md` 生成
- frontmatter 有 `file_format` / `file_hash` / `file_path` / `word_count` / `tags`
- 正文有 AI 摘要 → 笔记（如果有）→ 分隔线 → 原文内容

#### 失败意味着什么
命令挂了或 YAML 字段缺。

---

### J.4 整库备份 / 恢复往返（最关键的底线功能）

#### 背景
"设置 → 数据 → 导出备份"用的是 SQLite Backup API，生成一致性快照。恢复会替换当前库。Phase B/C 新表要能正常被备份和恢复。

#### 在哪里做
设置 → 数据。

#### 怎么操作
1. 点"导出备份"，保存到桌面（命名 `knoyoo-test-backup.db`）
2. 点"导入备份"，选刚导出的文件
3. 应用会自动弹框问要不要重启

#### 应该看到什么
- 导出：生成 .db 文件
- 导入：弹确认 → 点"重启" → 应用重启 → 所有数据完整（包括影音、文档、迁移过的内容）

#### 失败意味着什么
**这条必须通过**——备份恢复是最终防线。如果恢复后数据不完整，说明 schema 的某些变更破坏了备份兼容性，非常严重。

---

## K. 回归测试（旧功能不能被 Phase B/C 误伤）

### K.1 智库（ClipsPage）所有操作

#### 在哪里做
左侧导航 → 智库。

#### 怎么操作
浏览列表 / 打开详情 / 编辑标题和摘要和标签 / 搜索 / AI 重归类 / AI 翻译 / 写笔记 / 删除恢复。

#### 应该看到什么
全部和 v2.0.7 一致，没有新 bug。

#### 失败意味着什么
Phase B/C 的 ClipTarget 重构误伤了 web_clips 路径。

---

### K.2 书籍（BooksPage）所有操作

#### 在哪里做
左侧 → 书籍。

#### 怎么操作
拖 epub 进来 / 打开详情 / 点"让 AI 分析"提取元数据 / 看封面。

#### 应该看到什么
都正常。

#### 失败意味着什么
书籍模块是独立的；不太可能被误伤。但验一下就安心。

---

### K.3 浏览器扩展保存

#### 背景
浏览器扩展通过 HTTP 往 `127.0.0.1:19836` 发 POST，走 `clip_server.rs`。这条路径不涉及 Phase B/C，但用户流量最大，必须稳。

#### 在哪里做
已装了 KnoYoo 扩展的 Chrome/Firefox/Edge。

#### 怎么操作
1. 访问任意网页（比如 Wikipedia）
2. 点扩展图标 → "保存"

#### 应该看到什么
KnoYoo 智库里出现新条目，几秒后 AI 清洗 + 摘要 + 标签都到位。

#### 失败意味着什么
如果失败，很可能是后端 `open_db()` 级联挂了（参考 v2.0.8 事故）。

---

### K.4 导入 YouTube / Bilibili 链接

#### 在哪里做
智库 → "..." 菜单或类似 → 导入视频。

#### 怎么操作
粘贴一个 YouTube 或 B 站 URL。

#### 应该看到什么
走字幕优先 + ASR 兜底的管道，完成后写入 `web_clips`（**不是** media_items），source_type='video'。

#### 失败意味着什么
这条路径是 `run_pipeline` 而不是 `run_audio_pipeline`；Phase B 的 ClipTarget 应该让它写 web_clips。

---

### K.5 发现页统计

#### 在哪里做
左侧 → 发现。

#### 怎么操作
看标签词云 / 来源 Top5 / 28 天趋势 / AI 周报。

#### 应该看到什么
正常渲染（数据限 web_clips，不包括 media/document，这是已知范围）。

#### 失败意味着什么
某个统计崩了 → 通常是 schema 改动破坏了 SQL。

---

### K.6 QuickSearch 快捷键基础

#### 在哪里做
任意位置 `Cmd+Shift+K`（或 Windows 的 `Ctrl+Shift+K`）。

#### 怎么操作
打开 → 搜索 → 选择 → Enter → Esc 关闭。

#### 应该看到什么
- 浮窗响应快（< 100ms）
- macOS 下有磨砂透明
- Esc 关闭回原前台应用

#### 失败意味着什么
全局快捷键或窗口生命周期坏了。

---

### K.7 设置 → AI 配置

#### 在哪里做
左侧 → 设置 → AI。

#### 怎么操作
看每个已配置 provider 的"已配置 · 尾号 XXXX"显示。

#### 应该看到什么
显示正确。不会弹 macOS 系统的 Keychain 授权（Phase B 加了 key_hint 缓存）。

#### 失败意味着什么
每次进设置都弹授权 → `ai_configured__<provider>` / `ai_key_hint__<provider>` 的 app_kv 缓存失效。

---

### K.8 设置 → 其他配置

#### 在哪里做
设置页的其他 tab（主题、快捷键、视频转录）。

#### 怎么操作
- 主题：切换几个主题，看是否立即应用
- 快捷键：修改 QuickSearch 快捷键，保存，测试新快捷键
- 视频转录：切 provider，保存

#### 应该看到什么
都正常。

#### 失败意味着什么
Phase B/C 不改这些模块，理应不坏；一旦坏了说明有意想不到的耦合。

---

### K.9 书签批量导入

#### 在哪里做
设置 → 导入。

#### 怎么操作
选一个 Chrome 导出的书签 HTML 文件。

#### 应该看到什么
解析出书签数量 → 确认 → 批量创建剪藏。

#### 失败意味着什么
`import.rs` 模块不受影响；这是低频但有用的回归。

---

### K.10 里程碑横幅

#### 在哪里做
发现页顶部（如果有未 ack 的新里程碑）。

#### 怎么操作
看有没有横幅；有就点"已知道"。

#### 应该看到什么
横幅归档消失。

#### 失败意味着什么
`milestones.rs` 不受 Phase B/C 影响；极少坏。

---

## L. 风险路径（破坏性但能恢复）

### L.1 转录中途强退应用

#### 在哪里做
正在转录一个较长的音频时的主窗口。

#### 怎么操作
`Cmd+Q` 退出。

#### 应该看到什么
- 重开 app 后，该 media 的 `transcription_status` 是 `pending` 或 `failed`（不是某个中间态卡死）
- 详情页能看到"失败"提示，可以点"重试"

#### 失败意味着什么
如果 status 卡成奇怪字符串，UI 会一直转圈圈假死。

---

### L.2 重试转录

#### 在哪里做
L.1 后的那条 media 的详情页。

#### 怎么操作
点"重试转录"或等 UI 提供的重试按钮。

#### 应该看到什么
重新走完整管道。

#### 失败意味着什么
`retry_media_transcription` 命令挂了。

---

### L.3 物理文件丢失时的友好报错

#### 背景
用户可能移动或删除原文件。KnoYoo 记的 `file_path` 就失效了。

#### 在哪里做
终端（模拟） + 文档详情页。

#### 怎么操作
1. `sqlite3 ... "SELECT id, file_path FROM documents LIMIT 1"` 找一个 document
2. 把对应文件移走：`mv ~/Library/Application\ Support/knoyoo.desktop/data/documents/<hash>.pdf /tmp/`
3. 在 UI 里对这个 document 点"让 AI 重新归类"或类似操作

#### 应该看到什么
给友好错误提示（toast），不崩溃。

#### 失败意味着什么
后端 panic → 整个应用崩溃。代码需要处理 `std::fs::read` 的 Err 路径。

---

### L.4 跨类型移动后还能反悔

#### 在哪里做
做完一次 document → book 转换（见 O.3）后的乐色页。

#### 怎么操作
乐色 → 文档 tab → 找到被移走的原 document → 恢复。

#### 应该看到什么
- 原 document 回到 DocumentsPage
- **同时** 目标 book 也还在 BooksPage（两份独立，不互相影响）
- 两个对应的物理文件都在各自目录

#### 失败意味着什么
如果恢复后 book 消失了 → 跨类型移动用了 move 而不是 copy，设计错误。

---

### L.5 破损 pdf 的友好报错

#### 背景
用户可能拖一个损坏的 pdf（下载没完成、加密、扫描版无文字层）。

#### 在哪里做
文档页。

#### 怎么操作
准备一个确实坏的 pdf（比如把一张 jpg 改名成 .pdf），拖进去。

#### 应该看到什么
toast 给出"PDF 文本抽取失败..."类似的错误；不崩溃。

#### 失败意味着什么
`extract_pdf` 用 `catch_unwind` 包住了 pdf-extract 和 lopdf 的 panic，应当不崩。如果崩了说明 panic 漏网了。

---

## M. 文档导入（Phase C 核心路径，慢慢跑一遍）

### M.1 pdf 拖入文档页

#### 背景
pdf 是所有格式里最复杂的。`extract_pdf` 优先用 pdf-extract（处理各种字体的 ToUnicode CMap），失败 fallback 到 lopdf 逐页抽取，panic 时 catch。

#### 在哪里做
KnoYoo 左侧 → 文档。

#### 怎么操作
拖一个正常的、能文字提取的 pdf。

#### 应该看到什么
- 详情打开
- 几秒后（pdf 较大会十几秒）content 显示纯文本
- summary + tags 生成
- **没有**"目录"收缩条（pdf 提取后是纯文本，无 markdown 标题）

#### 失败意味着什么
- content 为空：pdf 是扫描版或加密的
- 崩溃：catch_unwind 漏了

---

### M.2 docx 拖入 + TOC 自动出现（Phase C.12 关键）

#### 背景
这是 Phase C 里最复杂的链路，测三件事一起工作：
1. `doc_extract::parse_docx_xml` 能解析 docx ZIP 里的 XML
2. Heading 样式的段落被转成 Markdown `#` / `##` 语法
3. ClipDetail 现有的 TOC 抽取能识别这些 `#` 标题

#### 在哪里做
文档页。

#### 怎么操作
拖一个**故意**带 3+ 个 Heading 样式段落的 docx（用 Word / Pages 写时，标题段落记得套 Heading1/2/3 样式，不是只改字号）。

#### 应该看到什么
- 详情打开
- content 显示为 Markdown，开头有 `# 一级标题`、`## 二级标题` 等
- 正文上方出现"目录 (N)"收缩条

#### 失败意味着什么
- content 是纯文本没 `#`：`parse_docx_xml` 的 Heading 识别 + Markdown 发射逻辑坏了
- 有 `#` 但没 TOC：ClipDetail 的 `extractHeadings` 正则匹配失败（很少见，除非标题只有 1-2 个）

---

### M.3 md 拖入

#### 在哪里做
文档页。

#### 怎么操作
拖一个带 `#` 标题的 md。

#### 应该看到什么
- content 原样保留 Markdown
- 有 3+ 个标题时"目录"出现

#### 失败意味着什么
content 被修改或乱码 → `extract_md` 读文件时编码处理错。

---

### M.4 txt 拖入

#### 在哪里做
文档页。

#### 怎么操作
拖一个 txt。

#### 应该看到什么
- 纯文本显示
- **没有** TOC（txt 没标题结构）

#### 失败意味着什么
出现 TOC → `extractHeadings` 误判；或者 content 乱加了 `#`。

---

### M.5 同文件重拖 → 拒绝

#### 在哪里做
文档页。

#### 怎么操作
再次拖 M.1 那个 pdf。

#### 应该看到什么
toast 报"《X》已在文档"。

#### 失败意味着什么
允许重复插 → `file_hash` UNIQUE 索引失效或 dedup check 挂了。

---

### M.6 软删后重拖 → 仍然拒绝（但提示不同）

#### 在哪里做
文档页。

#### 怎么操作
1. 删除一条（进乐色）
2. 再次拖该文件

#### 应该看到什么
toast 报"《X》在乐色中，请先恢复或彻底清除后再导入"。

#### 失败意味着什么
允许导入 → 会在 documents 里出现两行同 hash（partial UNIQUE 只对活跃行，软删行被排除），造成逻辑混乱。

---

### M.7 彻底清除后重拖 → 允许

#### 在哪里做
文档页。

#### 怎么操作
1. 乐色里永久删除那条
2. 回文档页再拖该文件

#### 应该看到什么
正常入库，全新行。

#### 失败意味着什么
仍然报"已在"→ purge 没清干净（sqlite 检查一下是不是真删了）。

---

### M.8 非法扩展名拒绝

#### 在哪里做
文档页。

#### 怎么操作
拖 .xlsx / .zip / .rtf。

#### 应该看到什么
toast "不支持的文档格式 .xlsx（仅支持 pdf / docx / md / txt）"。

#### 失败意味着什么
允许入库或静默失败 → `ALLOWED_EXTS` 检查没到位。

---

### M.9 导入的 sqlite 字段齐全

#### 在哪里做
终端。

#### 怎么操作
```bash
sqlite3 ~/Library/Application\ Support/knoyoo.desktop/data/notes.db \
  "SELECT file_format,file_path,file_hash,file_size,word_count FROM documents ORDER BY id DESC LIMIT 1"
```

#### 应该看到什么
5 个字段全有值。对 CJK 文档 `word_count > 0`。

#### 失败意味着什么
某字段空 → `import_document` 参数绑定漏。

---

### M.10 大文件边界（~500 MB）

#### 背景
`MAX_FILE_SIZE = 500 MB`。到边界的表现：要么正常工作、要么给清晰拒绝，不能卡死。

#### 在哪里做
文档页。

#### 怎么操作
拖一个接近 500 MB 的 pdf（如果你有的话）。

#### 应该看到什么
- < 500 MB：正常处理（但会很慢，pdf 文本抽取是 CPU 密集）
- > 500 MB：toast "文件过大（XXX MB），上限 500 MB"

#### 失败意味着什么
接近上限时 OOM（内存溢出）→ 流式读取没生效；超过时无提示 → 边界检查漏了。

---

## N. 文档页 UI

### N.1 左侧导航有"文档"入口

#### 在哪里做
主窗口左侧导航栏。

#### 怎么操作
看顺序。

#### 应该看到什么
主页 / 智库 / 书籍 / 影音 / **文档**（📄 FileText 图标） / 发现 / 乐色 / 设置。

#### 失败意味着什么
入口缺失或位置错 → `NavSidebar.tsx` 的配置没更新。

---

### N.2 按格式分 4 栏

#### 在哪里做
文档页。

#### 怎么操作
看主列表布局。

#### 应该看到什么
有内容的格式会分别显示为 PDF / Word / Markdown / 纯文本 四栏，每栏右上显示条数。

#### 失败意味着什么
没分栏 → `DocumentsPage.tsx` 的 `byFormat` 分组逻辑坏了。

---

### N.3 空状态引导

#### 在哪里做
文档页（如果 documents 表是空的）。

#### 怎么操作
查看。

#### 应该看到什么
中间大图标 + 提示"拖入文档文件，或使用右上角按钮"。

#### 失败意味着什么
白屏 → 空状态 UI 缺失，用户以为坏了。

---

### N.4 窄窗口响应式

#### 在哪里做
把主窗口宽度拖到 < 1024px。

#### 怎么操作
进文档页 → 点一条。

#### 应该看到什么
详情抽屉**占满整个页面**，顶部有"返回列表"按钮。

#### 失败意味着什么
详情挤成一小条：`useMediaQuery` 分支错。

---

### N.5 宽窗口 split view

主窗口 ≥ 1024px 时：点详情 → 左 2/5 列表 + 右 3/5 详情。

---

### N.6 Deep-link

#### 在哪里做
（假设你知道某个 document 的 id）主窗口的地址栏（如果是 Chrome DevTools 的话）或者通过 QuickSearch 的跳转验证。

#### 怎么操作
手动改 URL 到 `/documents?openDocument=<id>`。

#### 应该看到什么
详情自动打开；URL 参数被消费后移除。

#### 失败意味着什么
`useSearchParams` 处理错。

---

### N.7 文档详情**没有** AI 翻译按钮

#### 背景
documents 表 v1 没有 source_language / translated_content 列，所以 ClipDetail 的翻译按钮通过 `cmds.aiTranslate` 门控自动隐藏。

#### 在哪里做
任一文档详情页正文上方的操作按钮区。

#### 怎么操作
对比同等位置 web clip 或 media 的详情。

#### 应该看到什么
- web/media：有"AI 翻译"按钮
- document：**没有**

#### 失败意味着什么
document 上出现按钮且点了无效 → 门控失效，用户会困惑。

---

### N.8 文档笔记走内联

同 G.8-G.10，但对 document。sqlite 验证字段是 `documents.notes`，不是 clip_notes 表。

---

### N.9 word_count 正确

#### 背景
`count_words` 对 CJK 按字算，Latin 按 whitespace split。混合正确。

#### 在哪里做
终端 + UI。

#### 怎么操作
- 对一个纯中文文档：`sqlite3 ... "SELECT word_count FROM documents WHERE id=?"` 应该接近 CJK 字数
- 对一个混合文档：也应该合理

#### 应该看到什么
数字合理（不是 0，不是离谱大的数）。

#### 失败意味着什么
`doc_extract::count_words` 的 CJK + Latin 混合逻辑坏了（我们修过一次 bug）。

---

## O. 跨类型移动 pdf（Phase C.11）

> 只有 pdf 能互转；其他格式都拒绝。

### O.1 pdf 文档详情显示"移到书籍"按钮

#### 在哪里做
打开一个 `file_format='pdf'` 的 document 详情，看顶部操作栏。

#### 应该看到什么
`BookMarked` 图标 + 文字"移到书籍"的按钮。

#### 失败意味着什么
按钮没出现 → `canConvertToBook = kind === "document" && clip.source_type === "pdf"` 这个门控条件挂了。

---

### O.2 docx/md/txt 文档**不**显示"移到书籍"

对照 O.1：打开 docx/md/txt 文档的详情，按钮**不出现**。

---

### O.3 执行 document → book 转换

#### 在哪里做
O.1 的详情页。

#### 怎么操作
点"移到书籍"按钮。

#### 应该看到什么
- toast "已移动到书籍，AI 正在补齐作者 / 出版社"
- URL 跳 `/books?openBook=<新 id>`
- 书籍页打开，新条目进入"AI 正在分析"状态
- 原文档从文档页消失（进入乐色 → 文档 tab）
- 终端：
  - `books/` 目录有新增 `<hash>.pdf`
  - `documents/` 目录原文件**仍在**（copy 不是 move）

#### 失败意味着什么
- 没跳转：`convert_document_to_book` 命令挂了
- 原文件被删（documents/ 目录空了）：用了 move 而不是 copy，**破坏反悔能力**

---

### O.4 pdf 书籍详情显示"移到文档"

#### 在哪里做
打开一个 `fileFormat='pdf'` 的 book 的详情抽屉，看底部 footer。

#### 应该看到什么
在"在系统中打开"右边出现"移到文档"按钮（FileText 图标）。

#### 失败意味着什么
按钮没出现 → `canConvertToDocument = book.fileFormat === "pdf"` 错。

---

### O.5 epub 书籍**不**显示"移到文档"

对照 O.4。

---

### O.6 执行 book → document

#### 在哪里做
O.4 的详情。

#### 怎么操作
点"移到文档"。

#### 应该看到什么
- toast "已移动到文档，AI 正在清洗与打标签"
- 跳 `/documents?openDocument=<新 id>`
- 新 document 进入 AI 管道
- 原 book 进入乐色 → 书籍 tab
- documents/ 和 books/ 两个目录各有一份文件

#### 失败意味着什么
同 O.3。

---

### O.7 已存在 hash 被拒绝

#### 背景
A.6 做完后，把那条 document 从乐色里恢复，再点"移到书籍"。这时候 books 已经有同 hash 行了，应该拒绝。

#### 在哪里做
执行过 O.3 的那条 document（从乐色恢复回来后）。

#### 怎么操作
点"移到书籍"。

#### 应该看到什么
toast "《X》已在书籍"。

#### 失败意味着什么
允许重复 → `file_hash` 冲突检查没做，books 里会有两份同内容。

---

## P. TOC 目录

### P.1 md 文档 ≥ 3 标题 → TOC 出现

#### 在哪里做
文档页 → 准备的那个 md 详情。

#### 应该看到什么
正文上方出现"目录 (N)"收缩条。

#### 失败意味着什么
收缩条不出现 → `headings.length >= 3` 条件没满足（标题数少，或 `extractHeadings` 正则没命中）。

---

### P.2 docx 文档 ≥ 3 Heading → TOC 出现（Phase C.12 重点）

#### 在哪里做
文档页 → 准备的那个 docx 详情。

#### 应该看到什么
同 P.1，出现"目录 (N)"。

#### 失败意味着什么
**这条如果挂了**说明 `parse_docx_xml` 发射 Markdown `#` 语法的改动没生效（C.12 修复点）。

---

### P.3 点击目录条目滚动

#### 在哪里做
P.1 或 P.2 打开的"目录"收缩条。

#### 怎么操作
点开它 → 点任一标题。

#### 应该看到什么
正文平滑滚动到对应标题（不是生硬跳）。

#### 失败意味着什么
- 不滚动：`scrollIntoView` 没找到锚点（id 没正确注入到 DOM）
- 生硬跳：`behavior: "smooth"` 没生效（浏览器兼容问题，Webkit 一般都支持）

---

### P.4 txt / pdf / 短 md 文档**不**显示 TOC

分别打开 txt / pdf / 只有 1-2 个 `#` 的 md 的详情。正文上方**不**出现"目录"。

---

### P.5 CJK 标题点击

#### 背景
中文标题的锚点 id 使用 slugify 规则，CJK 字符保留、标点变 `-`。前后端规则一致。

#### 在哪里做
中文标题的 md 或 docx 的详情。

#### 怎么操作
展开目录，点"第一章：开始"这类的条目。

#### 应该看到什么
滚到对应位置。

#### 失败意味着什么
不滚 → 前后端 slugify 规则不一致，id 不匹配。

---

## 全部跑完要多久？

根据节奏不同：

| 模式 | 跳过的部分 | 估计时间 |
|---|---|---|
| **极速**（只跑最关键 14 条） | 其余全跳 | 15-25 分钟 |
| **标准**（所有非 AI 段） | H 段（需要配 AI 等响应） | 40-60 分钟 |
| **完整**（所有 113 条） | 无 | 90-120 分钟 |

## 最关键 14 条（时间紧只跑这些覆盖 ≈ 85% 风险）

| 编号 | 一句话描述 |
|---|---|
| **A.1** | 应用能启动没报错 |
| **A.3** | 迁移标志已设 |
| **A.4** | media_items / documents 都有 notes 列（v2.0.8 事故防线） |
| **A.6** | 老数据迁出且数量一致 |
| **B.3** | 老笔记没丢 |
| **C.4** | media 全管道跑通（AI 生成摘要标签） |
| **E.4** | pdf 默认进文档（Phase C 核心决策） |
| **F.4** | 文档能被搜索命中 |
| **H.4** | AI 对话 `[DOC:N]` 引用工作 |
| **I.2** | 乐色页 4 个 tab |
| **J.4** | 备份 / 恢复往返完整 |
| **M.2** | docx 导入 + TOC 一气呵成 |
| **O.3** | 跨类型 document → book 完整 |
| **K.3** | 浏览器扩展保存没坏（最容易被误伤） |

---

## 遇到问题时怎么报

请给我这四样：
1. **编号**（如 "M.2 挂了"）
2. **期望 vs 实际**（哪里不符合标准描述）
3. **DevTools Console 的完整错误**（选中报错右键 → "Copy object" 最全）
4. 如果和数据有关，**相关的 sqlite 查询结果**

有这四样我能直接定位到代码位置修。

---

*基线：v2.0.9（含 fix commit 4a8cf5a） · 完整大白话版 · 重写于 2026-04-22*
*本清单覆盖 v2.0.7 → v2.0.9 的 33 个文件 / 6723 行代码变动。共 113 条测试点。*
