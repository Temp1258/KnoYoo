# KnoYoo — 本地优先的 AI 私人智库

> 以零摩擦的方式将你消费的一切信息自动转化为结构化知识，在你需要时精准找回，并让你看见自己知识体系的生长。所有数据 100% 存储在本地，永远属于你自己。

**[产品蓝图](BLUEPRINT.md)** — 产品初衷、核心定位、四大支柱、用户画像、竞品分析与演进路线图

---

## 下载安装

直接下载安装即可使用，无需任何开发环境：

| 平台 | 文件 |
|---|---|
| **macOS** (Apple Silicon) | `KnoYoo_*_aarch64.dmg` |
| **Windows** (x64) | `KnoYoo_*_x64_zh-CN.msi` |

**[最新 Release](https://github.com/Temp1258/KnoYoo/releases/latest)**

浏览器扩展配合桌面端使用，首次启动按引导安装。扩展与桌面端自动握手，无需手动配置 Token。

> macOS Intel 与 Linux 构建暂未包含。如有需要可参考下方 [从源码构建](#从源码构建) 自行编译。

---

## v2.0.5 亮点

- 🎙️ **长音频自动分片**：超过 ASR 供应商单次上传上限（Whisper 25MB / Deepgram 100MB / SiliconFlow 20MB）时 ffmpeg 按时长切片、串行上传、拼接转写；分片时长在设置里可调（60–900 秒，默认 300）
- 🌐 **双语字幕**：视频/音频转录完成后 AI 一次调用同时识别源语言并生成简体中文译文，详情页一键切换「可读版 / 原始 / 中文译文」；源语言已是中文时 AI 短路节省 tokens
- 📱 **窄窗口友好**：AI Chat Drawer 在 <768px 窗口（iPad Slide Over / Tauri 分屏）改为全宽 overlay

完整更新日志详见 [v2.0.5 Release](https://github.com/Temp1258/KnoYoo/releases/tag/v2.0.5)。

---

## 核心特性速览

### 无痛输入 + 自动结构化

- **网页**：浏览器扩展一键收藏，三阶段 AI 管道 → 原文保留 → 清洗为可读 Markdown → 生成摘要和标签
- **书籍**：拖入 EPUB / PDF，AI 通读正文自动填充书名、作者、简介、标签
- **在线视频**：YouTube / Bilibili 链接导入，字幕优先 + ASR 兜底；非中文内容 AI 自动生成简体中文译文
- **本地音频**：拖入 mp3 / m4a / wav / flac / opus 等，ASR 直接转写；超过供应商单次上限时按时长分片串行转写
- **本地视频**：拖入 mp4 / mov / mkv 等，ffmpeg 抽音频后走 ASR 管道（同样支持长视频自动分片）
- **书签批量导入**：Chrome / Firefox / Edge 的 Netscape 格式书签

### 智能检索 + AI 对话

- **主页统一搜索**：居中大搜索框 + 快捷入口卡片，输入即时跨内容混合结果（剪藏 / 书籍 / 视频 / 影音）
- **全局快捷键**：`Cmd+Shift+K`（macOS）/ `Ctrl+Shift+K` 在任意位置召唤搜索浮窗，可在 **设置 → 显示 → 快捷键** 录制自定义组合
- **FTS5 trigram 全文搜索**：毫秒级响应，中文单字 / 双字短查询同样命中
- **LIKE 兜底**：<3 字符查询自动走子串匹配
- **AI 语义搜索**：FTS 无结果时 AI 自动兜底，用自然语言描述找内容
- **知识对话**：向你的智库提问，AI 回答附带引用来源
- **多维筛选**：标签、域名、时间、星标、已读/未读

### 知识生长可视化

- **发现页**：标签词云 / 来源 Top5 / 28 天趋势 / AI 周报 / 遗忘内容提醒
- **成就页**：四类里程碑按 kind 分组陈列（收藏量 / 连续输入 / 话题深度 / 阅读完成），斐波那契阶梯让每一步积累都被看见
- **里程碑横幅**：新成就达成时在发现页顶部浮现，用户确认后归档
- **书架**：想读 / 正在读 / 已读 / 弃读分组，阅读进度与评分

### 本地 + 数据主权

- 100% 本地 SQLite 存储，零云端上传，零遥测
- AI 调用走用户自配 API Key，可全部换成本地 Ollama
- API Key 存 OS Keychain（macOS Keychain / Windows Credential Manager），不进数据库
- Bearer Token 鉴权 + `subtle::ConstantTimeEq` 常量时间比较
- SSRF 防护（IP 级校验 + RFC 2606 保留 TLD 黑名单）
- DNS Rebinding 防御（resolver 二次 IP 验证）
- 严格 CSP + Tauri 2 capabilities 最小权限
- 一键备份（SQLite Backup API）/ 恢复 / Markdown 导出
- 备份不带任何 API Key，用户换机后需重新配置

> 各特性的设计理念、实现细节与未来演进方向，详见 **[产品蓝图](BLUEPRINT.md)**。

---

## 技术架构

```
┌────────────────────────────────────────────────────────────┐
│                      桌面端 (Tauri 2)                      │
│  ┌──────────────────────────┐  ┌────────────────────────┐  │
│  │  Main Window             │  │  Quick-Search Window   │  │
│  │  React 19 + Router 7     │  │  浮窗 · 透明 · 置顶    │  │
│  │  HomePage / ClipsPage    │  │  Cmd+Shift+K 触发      │  │
│  │  BooksPage / MediaPage   │  │  共享同一 bundle       │  │
│  │  AchievementsPage / ...  │  │  (按 window label 分流)│  │
│  └────────────────┬─────────┘  └──────────┬─────────────┘  │
│                   │ Tauri invoke          │                │
│                   ▼                       ▼                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Rust 后端                                           │  │
│  │  SQLite + FTS5 (trigram) + Backup API                │  │
│  │  OpenAI-兼容 AI 客户端                               │  │
│  │  ASR 管道 (OpenAI Whisper / Deepgram / SiliconFlow)  │  │
│  │  SSRF-safe HTML 抓取 · PDF/EPUB 双路抽取             │  │
│  │  YouTube / Bilibili 元数据 + 字幕                    │  │
│  │  Milestones · 全局快捷键 · Keychain 密钥             │  │
│  └──────────────────┬───────────────────┬───────────────┘  │
│                     │ sidecar           │ HTTP+Bearer      │
│                     ▼                   │ 127.0.0.1:19836  │
│  ┌──────────────────────────────┐       │                  │
│  │  External Binaries           │       │                  │
│  │  · yt-dlp  (视频下载+字幕)   │       │                  │
│  │  · ffmpeg  (本地视频抽音频)  │       │                  │
│  └──────────────────────────────┘       │                  │
└─────────────────────────────────────────┼──────────────────┘
                                          │
┌─────────────────────────────────────────┼──────────────────┐
│           浏览器扩展 (Manifest V3)      │                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┴──┐               │
│  │ Content  │  │  Popup   │  │ Background  │               │
│  │ Script   │  │    UI    │  │   Worker    │               │
│  │ DOM 提取 │  │ 一键收藏 │  │ 离线队列    │               │
│  │ innerText│  │ 重新握手 │  │ auth-check  │               │
│  └──────────┘  └──────────┘  └─────────────┘               │
└────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | [Tauri 2](https://v2.tauri.app/)（Rust + WebView，启用 `macos-private-api` 以支持浮窗透明） |
| 前端 | React 19 + TypeScript 5 + Vite 7（manualChunks 拆 vendor） |
| 样式 | Tailwind CSS 4 |
| 路由 | React Router 7 |
| Markdown | `react-markdown` + `remark-gfm` |
| 数据库 | SQLite (`rusqlite` bundled) + FTS5 trigram + Backup API |
| AI 客户端 | OpenAI 兼容 API (`ureq`) |
| ASR | OpenAI Whisper / Deepgram / SiliconFlow（共用 `AsrProvider` trait 抽象） |
| HTML 解析 | `scraper`（CSS 选择器）|
| PDF 抽取 | `pdf-extract`（主）+ `lopdf`（兜底 + 封面 + 页数） |
| EPUB 解析 | `epub` crate |
| 外部二进制 | `yt-dlp` + `ffmpeg`（通过 `tauri-plugin-shell` sidecar 调用） |
| 全局快捷键 | `tauri-plugin-global-shortcut` 2 |
| 密钥存储 | `keyring` 3（macOS Keychain / Windows Credential Manager） |
| 安全随机数 | `getrandom`（跨平台 OS 熵源） |
| 常量时间比较 | `subtle::ConstantTimeEq` |
| 浏览器扩展 | Chrome Manifest V3 + Vanilla TypeScript |
| 包管理 | pnpm monorepo |
| 代码质量 | ESLint + Prettier + Husky + lint-staged · clippy pedantic |

### 后端模块（`apps/desktop/src-tauri/src/`）

| 文件 | 职责 |
|---|---|
| `main.rs` | Tauri 入口 + 系统托盘 + 命令注册 + quick-search 窗口创建 + 快捷键注册 |
| `db.rs` | Schema + 迁移 + FTS5 trigram 触发器 + Backup/Restore + `restart_app` |
| `clips.rs` | 网页剪藏 CRUD + 三阶段 AI 管道 + AI_BACKGROUND_TASKS RAII 槽位管理 |
| `books.rs` | 图书 CRUD + 封面/页数 + AI 元数据抽取（带 `ai_status` 状态机） |
| `audio.rs` | 本地音频/视频导入（流式 sha256 + ffmpeg 抽音频 + TempFileGuard） |
| `audio_split.rs` | ffmpeg 按时长切片长音频（解决 ASR 单次上传上限） |
| `transcribe.rs` | ASR 管道编排（字幕优先 → 音频下载 → 按需分片 → 云 ASR → AI 清洗 → 摘要标签 → 双语翻译） |
| `asr_client.rs` | `AsrProvider` trait + OpenAI Whisper / Deepgram / SiliconFlow 实现 |
| `search.rs` | 跨内容统一搜索（FTS trigram + LIKE 兜底 + bm25 归一化 + 分页） |
| `milestones.rs` | 斐波那契里程碑阶梯（clip_count / consecutive_days / tag_depth / books_read） |
| `shortcut.rs` | 全局快捷键注册 + 用户自定义持久化（`app_kv`） |
| `ai.rs` | AI 对话命令 + 引用追踪 + 建议生成 |
| `ai_client.rs` | OpenAI 兼容 HTTP 客户端 |
| `clip_server.rs` | 本地 HTTP 服务（127.0.0.1:19836，ping / handshake / auth-check / clip / clip-url） |
| `html_extract.rs` | SSRF-safe 抓取 + 首屏 + 原始 body 双路 + 视频站点分流 |
| `youtube.rs` / `bilibili.rs` / `ytdlp.rs` | 视频元数据 + 字幕 + yt-dlp sidecar 封装 |
| `import.rs` | 浏览器书签批量导入 |
| `export.rs` | Markdown 导出 + 数据库备份 |
| `secrets.rs` | OS Keychain 读写（测试用内存 fake） |
| `error.rs` | 统一错误类型 |

### 前端结构（`apps/desktop/src/`）

```
pages/
├── HomePage.tsx            # 主页 Google 风格搜索 + 拖入分发
├── ClipsPage.tsx           # 智库（article + 在线视频）
├── BooksPage.tsx           # 书籍 + 拖入 + 轮询 AI 状态
├── MediaPage.tsx           # 影音（本地音频 + 本地视频）
├── DiscoverPage.tsx        # 发现页 + 周报 + 里程碑横幅
├── AchievementsPage.tsx    # 成就陈列墙
├── SettingsPage.tsx        # AI / 主题 / 快捷键 / 数据 / 导入
└── TrashPage.tsx           # 乐色（剪藏 + 图书两个 tab）

components/
├── AI/                     # ChatDrawer
├── Books/                  # BookShelf / BookTile / BookCover / BookDetailDrawer
├── Clips/                  # ClipCard / ClipDetail / VideoImportDialog
├── Import/                 # BookmarkImportDialog
├── Layout/                 # AppShell / NavSidebar / KnoYooLogo
├── Milestones/             # MilestoneBanner
├── Onboarding/             # 2 步简化引导
├── Settings/               # ApiConfigPanel / ShortcutSettings / ThemePicker / ResetApiKeysCard
├── Trash/                  # ClipsTrashPanel / BooksTrashPanel
├── common/                 # Toast / ErrorBoundary
└── ui/                     # Button / Dialog / SegmentedControl / Skeleton / ...

QuickSearchApp.tsx          # 浮窗独立根组件（按 window label 分流）
hooks/
├── useTauriInvoke.ts
├── useQuickSearchNavigation.ts   # 浮窗选中后主窗口导航
├── useBooks.ts · useTheme.ts · useMediaQuery.ts · useSearchHistory.ts
utils/url.ts                # isSafeUrl / formatClipDomain
```

### Schema 概览

| 表 | 作用 |
|---|---|
| `web_clips` | 剪藏主表（`content` = 清洗可读版；`raw_content` = 原始 body；`source_type` 含 article/video/audio/local_video；`transcription_status` 状态机；`source_language` + `translated_content` 承载双语字幕；软删除 `deleted_at`） |
| `web_clips_fts` | FTS5 trigram 全文索引 |
| `books` | 图书（`ai_status` / `ai_error` 状态追踪 · `file_hash` 唯一去重） |
| `books_fts` | 书籍 FTS5 trigram 索引 |
| `clip_notes` | 用户笔记（1:1 关联 clip） |
| `milestones` | 里程碑记录（kind + value + meta_json + acknowledged） |
| `chat_sessions` | AI 对话历史（持久化） |
| `weekly_reports` | 周报缓存 |
| `app_kv` | 应用配置（AI 供应商选择、server token、主题、快捷键、里程碑 backfill 标志等） |

> Collections 表已在 v2.0.4 移除。原集合分组功能被主页 + QuickSearch + 新影音页替代；老用户数据库升级时会自动执行 `DROP TABLE IF EXISTS`。

---

## 从源码构建

> 以下内容面向开发者和贡献者。普通用户请直接 [下载安装](#下载安装)。

### 环境要求

- [Node.js](https://nodejs.org/) >= 18.18
- [pnpm](https://pnpm.io/) >= 10.15
- [Rust](https://rustup.rs/) stable >= 1.82（`Duration::from_mins` 要求）
- Tauri 2 系统依赖：参考 [官方文档](https://v2.tauri.app/start/prerequisites/)
- macOS Intel / Linux 构建还需自行准备 `yt-dlp` + `ffmpeg` sidecar（arm64 版已在 `apps/desktop/src-tauri/binaries/` 内）

### 安装运行

```bash
# 克隆项目
git clone https://github.com/Temp1258/KnoYoo.git
cd KnoYoo

# 安装依赖
pnpm install

# 桌面端（开发模式）
cd apps/desktop
pnpm tauri:dev

# 构建浏览器扩展
cd apps/browser-extension
pnpm build
```

### 安装浏览器扩展

1. 打开 `chrome://extensions`
2. 启用右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `apps/browser-extension/dist`
5. 扩展自动与桌面端握手，无需手动配置 Token。失效时 popup 内置「一键重新握手」

### 构建发布版

```bash
# 桌面端
cd apps/desktop && pnpm tauri:build
# 产物：apps/desktop/src-tauri/target/release/bundle/
```

### 开发验证命令

```bash
# Rust
cd apps/desktop/src-tauri
cargo test
cargo clippy --all-targets -- -D warnings

# 前端
cd apps/desktop
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

---

## 使用流程

### 1. 首次启动

打开桌面端 → 2 步引导（欢迎页 + 扩展安装提示）→ 进入主页。

### 2. 配置 AI（可选但强烈建议）

**设置 → AI 配置** → 填写 API Key。支持 DeepSeek、OpenAI、Ollama、通义千问、GLM、Moonshot、SiliconCloud、Anthropic 等。没有 AI 也能用基础收藏/搜索，但摘要、标签、图书元数据抽取、语义搜索、AI 对话都需要。

配置 ASR 则在 **设置 → 视频转录**，支持 OpenAI Whisper / Deepgram / SiliconFlow。

### 3. 开始收藏

| 方式 | 操作 |
|---|---|
| **网页** | 浏览时点扩展图标一键保存；或启用「自动弹窗」在每个页面主动提示 |
| **书籍** | 拖 EPUB / PDF 进桌面端「书籍」页（或首页） |
| **在线视频** | 「智库」→「…」菜单→「导入视频」，粘贴 YouTube / Bilibili 链接 |
| **本地音频** | 拖 mp3 / m4a / wav / flac / opus 进「影音」页（或首页） |
| **本地视频** | 拖 mp4 / mov / mkv 等进「影音」页，ffmpeg 自动抽音频 |
| **书签** | 设置 → 导入 → 选择 Chrome/Firefox/Edge 导出的 HTML 书签文件 |

### 4. 随时召唤搜索

- 任意位置按 **`Cmd+Shift+K`**（macOS）/ **`Ctrl+Shift+K`**（Windows）唤出 Spotlight 风格浮窗
- ↑↓ 选择，Enter 跳转到对应详情；点击浮窗外或 ESC 关闭
- 快捷键冲突时可在 **设置 → 显示 → 快捷键** 录制新组合

### 5. 查找内容

- 主页搜索框：跨内容统一搜索（剪藏 / 书籍 / 视频 / 影音）
- 各页顶部搜索框：限定该页类型
- 无结果 → 自动切换到 AI 语义搜索
- 左侧导航：主页 / 智库 / 书籍 / 影音 / 发现 / 成就 / 乐色 / 设置
- 发现页看标签云、来源 Top5、28 天趋势、AI 周报、遗忘内容
- 成就页看所有已达成的里程碑

### 6. 数据管理

- 删除进乐色，30 天内可恢复
- **设置 → 数据** → 一键备份整个 SQLite 数据库，或从备份恢复（恢复后自动弹窗引导重启）
- 数据库路径在设置页可见
- API Key 存 OS Keychain，**不随备份迁移**；换机后需重新配置

---

## 数据存储

### 本地路径

| 系统 | 路径 |
|---|---|
| macOS | `~/Library/Application Support/knoyoo.desktop/data/notes.db` |
| Windows | `%APPDATA%\KnoYoo\Desktop\data\notes.db` |
| Linux | `~/.local/share/knoyoo-desktop/data/notes.db` |

EPUB / PDF 原始文件存放于同目录下 `books/`，封面在 `book_covers/`，视频转录临时音频在 `temp_media/`（用完自动清理）。

### 备份与恢复

- `Settings → 数据 → 导出备份`：调 SQLite Backup API 生成一致性快照 `.db` 文件
- `Settings → 数据 → 导入备份`：替换当前数据库，导入成功后弹阻塞 Dialog 强制引导重启
- **Keychain 里的 API Key 不随备份迁移**，是设计选择（保证备份文件在网络传输中无敏感数据）

---

## 项目结构

```
KnoYoo/
├── apps/
│   ├── desktop/              # Tauri 2 桌面端主工程
│   │   ├── src/              # React 前端（main window + quick-search 共享）
│   │   ├── src-tauri/        # Rust 后端 + sidecar 二进制
│   │   ├── package.json
│   │   └── vite.config.ts
│   ├── browser-extension/    # Chrome Manifest V3 扩展
│   └── cloud/                # 可选 Supabase 脚手架（尚未启用）
├── docs/
│   └── VIDEO_TRANSCRIPTION.md  # 视频转录管道设计笔记
├── scripts/
│   └── fetch-sidecars.ps1    # Windows 平台 yt-dlp/ffmpeg 抓取脚本
├── BLUEPRINT.md              # 产品蓝图
├── README.md                 # 本文件
└── pnpm-workspace.yaml
```

---

## 贡献

Issue 和 PR 欢迎。开发约定：

- **Rust 后端**：遵循 `clippy pedantic`；`cargo test` 需通过；关键模块附带 `#[cfg(test)]` 单元测试
- **前端**：ESLint + Prettier（已配置 lint-staged，commit 时自动修复）；TypeScript strict；避免在 useEffect 里同步 setState
- **Commit**：[Conventional Commits](https://www.conventionalcommits.org/)（`feat:` / `fix:` / `chore:` / `docs:` / `refactor:` / `test:`）
- **数据库迁移**：永远 additive（`ALTER TABLE ... ADD COLUMN` + `.ok()` 容忍重复），禁止改现有列语义
- **风险操作**：任何涉及文件系统、Keychain、网络出口的改动，提交前用 `cargo clippy` + 完整 `pnpm build` 二次验证

## License

MIT
