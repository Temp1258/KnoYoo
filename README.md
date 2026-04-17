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

浏览器扩展需要配合桌面端使用，首次启动按引导装一下即可。

> macOS Intel 与 Linux 构建暂未包含。如有需要可参考下方 [从源码构建](#从源码构建) 自行编译。

---

## 核心特性速览

### 无痛输入 + 自动结构化

- **网页**：浏览器扩展一键收藏，三阶段 AI 管道自动完成原文保留 → 清洗为可读 Markdown → 生成摘要和标签
- **书籍**：拖入 EPUB / PDF，AI 通读正文自动填充书名、作者、简介、标签
- **视频**：YouTube / Bilibili 链接导入，字幕优先 + ASR 兜底，自动转为可搜索文字
- **书签**：浏览器书签批量导入

### 智能检索 + AI 对话

- **全文搜索**：SQLite FTS5，毫秒级响应
- **语义搜索**：全文搜索无结果时 AI 自动兜底，用自然语言描述找内容
- **知识对话**：向你的智库提问，AI 回答附带引用来源
- **多维筛选**：标签、域名、时间、星标、已读/未读、集合

### 知识生长可视化

- **发现页**：标签词云、来源 Top5、28 天趋势、AI 周报、遗忘内容提醒
- **书架**：想读 / 正在读 / 已读 / 弃读分组，阅读进度与评分

### 本地 + 数据主权

- 100% 本地 SQLite 存储，零云端上传，零遥测
- AI 调用走用户自配 API Key，可全部换成本地 Ollama
- API Key 存 OS Keychain，Bearer Token 鉴权 + 常量时间比较
- SSRF 防护 + DNS Rebinding 防御 + 严格 CSP
- 一键备份/恢复，Markdown 导出，用户拥有完全控制权

> 各特性的设计理念、实现细节与未来演进方向，详见 **[产品蓝图](BLUEPRINT.md)**。

---

## 技术架构

```
┌──────────────────────────────────────────────────────┐
│                  桌面端 (Tauri 2)                    │
│  ┌────────────────────┐  ┌─────────────────────────┐ │
│  │   React 19 前端    │  │   Rust 后端             │ │
│  │   TypeScript 5     │◄►│   SQLite + FTS5         │ │
│  │   Tailwind CSS 4   │  │   OpenAI-兼容 AI 客户端 │ │
│  │   React Router 7   │  │   SSRF-safe HTML 抓取   │ │
│  └────────────────────┘  │   PDF/EPUB 双路抽取     │ │
│                          │   YouTube / Bilibili    │ │
│                          └──────────┬──────────────┘ │
│                                     │ 127.0.0.1:19836│
└─────────────────────────────────────┼────────────────┘
                                      │ HTTP + Bearer
┌─────────────────────────────────────┼────────────────┐
│           浏览器扩展 (Manifest V3)  │                │
│  ┌──────────┐ ┌──────────┐ ┌───────┴─────┐          │
│  │ Content  │ │  Popup   │ │ Background  │          │
│  │ Script   │ │   UI     │ │   Worker    │          │
│  │ DOM 提取 │ │ 一键收藏 │ │ 离线队列    │          │
│  │ innerText│ │ 重新握手 │ │ auth-check  │          │
│  └──────────┘ └──────────┘ └─────────────┘          │
└─────────────────────────────────────────────────────┘

          (可选) apps/cloud/ — Supabase 订阅脚手架，尚未启用
```

### 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | [Tauri 2](https://v2.tauri.app/)（Rust + WebView） |
| 前端 | React 19 + TypeScript + Vite 7 |
| 样式 | Tailwind CSS 4 |
| 路由 | React Router 7 |
| Markdown | `react-markdown` + `remark-gfm` |
| 数据库 | SQLite (`rusqlite` bundled) + FTS5 + Backup API |
| AI 客户端 | OpenAI 兼容 API (`ureq`) |
| HTML 解析 | `scraper`（CSS 选择器）|
| PDF 抽取 | `pdf-extract`（主路径）+ `lopdf`（兜底 + 封面/页数）|
| EPUB 解析 | `epub` crate |
| 安全随机数 | `getrandom`（跨平台 OS 熵源）|
| 浏览器扩展 | Chrome Manifest V3 + Vanilla TypeScript |
| 包管理 | pnpm monorepo |
| 代码质量 | ESLint + Prettier + Husky + lint-staged |

### 后端模块

| 文件 | 职责 |
|---|---|
| `main.rs` | 入口 + 系统托盘 + Tauri 命令注册 + 启动时自愈（`resume_pending_ai_extraction`）|
| `db.rs` | Schema + 迁移 + FTS 触发器 + 备份/恢复 |
| `clips.rs` | 网页剪藏 CRUD + 三阶段 AI 管道（`enrich_raw_content_if_thin` → `ai_clean_clip_inner` → `auto_tag_clip_inner`） |
| `books.rs` | 图书 CRUD + 封面/页数提取 + AI 元数据抽取（带失败重试 + 文件名兜底） |
| `collections.rs` | 集合管理 |
| `ai.rs` | AI 对话命令 + 引用追踪 + 平衡括号 JSON 提取 |
| `ai_client.rs` | OpenAI 兼容 HTTP 客户端 |
| `clip_server.rs` | 本地 HTTP 服务（ping / handshake / auth-check / clip / clip-url）|
| `html_extract.rs` | SSRF-safe 抓取 + 首屏 + 原始 body 双路提取 + 视频站点分流 |
| `youtube.rs` | YouTube 视频信息 + 字幕提取 |
| `bilibili.rs` | Bilibili 视频信息 + URL 清洗 |
| `import.rs` | 浏览器书签批量导入 |
| `export.rs` | Markdown 导出 + 数据库备份 |
| `error.rs` | 统一错误类型 |

### 前端结构

```
apps/desktop/src/
├── pages/
│   ├── ClipsPage.tsx          # 剪藏列表 + 搜索 + 筛选
│   ├── BooksPage.tsx          # 书籍 + 拖入 + 轮询 AI 状态
│   ├── DiscoverPage.tsx       # 发现页 + 周报
│   ├── CollectionsPage.tsx    # 集合总览
│   ├── CollectionDetailPage.tsx
│   ├── SettingsPage.tsx       # AI / 主题 / 数据 / 导入
│   └── TrashPage.tsx          # 乐色（剪藏 + 图书两个 tab）
├── components/
│   ├── Books/                 # BookShelf / BookTile / BookCover / BookDetailDrawer / BookDropOverlay
│   ├── Clips/                 # ClipCard / ClipDetail（含可读版/原始切换）
│   ├── Collections/           # AddToCollectionDialog
│   ├── Import/                # BookmarkImportDialog
│   ├── Layout/                # AppShell / NavSidebar
│   ├── Onboarding/            # 2 步简化引导
│   ├── Settings/              # ThemePicker / AISettingsPanel
│   ├── Trash/                 # ClipsTrashPanel / BooksTrashPanel
│   ├── common/                # Toast / ErrorBoundary
│   └── ui/                    # Button / SegmentedControl / Skeleton / ...
└── hooks/                     # useTauriInvoke / useBooks / useTheme / useMediaQuery / ...
```

---

## 从源码构建

> 以下内容面向开发者和贡献者。普通用户请直接 [下载安装](#下载安装)。

### 环境要求

- [Node.js](https://nodejs.org/) >= 18.18
- [pnpm](https://pnpm.io/) >= 10.15
- [Rust](https://rustup.rs/) stable
- Tauri 2 系统依赖：参考 [官方文档](https://v2.tauri.app/start/prerequisites/)

### 安装运行

```bash
# 克隆项目
git clone https://github.com/Temp1258/KnoYoo.git
cd KnoYoo

# 安装依赖
pnpm install

# 桌面端（开发模式）
cd apps/desktop && pnpm tauri:dev

# 构建浏览器扩展
cd apps/browser-extension && pnpm build
```

### 安装浏览器扩展

1. 打开 `chrome://extensions`
2. 启用右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `apps/browser-extension/dist`
5. 扩展会自动与桌面端握手，无需手动配置 Token。如 Token 失效，popup 内置「一键重新握手」按钮

### 构建发布版

```bash
# 桌面端
cd apps/desktop && pnpm tauri:build
# 产物：apps/desktop/src-tauri/target/release/bundle/
```

---

## 使用流程

### 1. 首次启动

打开桌面端 → 2 步引导（欢迎页 + 扩展安装提示）→ 进入主界面。

### 2. 配置 AI（可选但强烈建议）

**设置 → AI 配置** → 填写 API Key。支持 DeepSeek、OpenAI、Ollama 等。没有 AI 也能用基础收藏/搜索，但摘要、标签、图书元数据抽取、AI 对话都需要。

### 3. 开始收藏

- **网页**：浏览时点扩展图标一键保存；或启用「自动弹窗」在每个页面自动提示
- **图书**：把 EPUB / PDF 直接拖入桌面端「书籍」，AI 在后台读正文、填字段；拖一次自动入库，重复文件自动去重
- **视频**：YouTube / Bilibili 链接复制到浏览器打开后收藏，或右键链接直接导入

### 4. 查找内容

- 顶部搜索框 → 关键词命中正文/标题/标签
- 搜索无结果 → 自动切换到 AI 语义搜索
- 侧边栏：智库 / 书籍 / 集合 / 发现 / 乐色 / 设置
- 发现页看标签云、来源 Top5、28 天趋势、AI 周报

### 5. 数据管理

- 删除进入乐色，30 天内可恢复
- **设置 → 数据** → 一键备份整个 SQLite 数据库，或从备份恢复
- 数据库路径在设置页可见

---

## 数据存储

### 本地路径

| 系统 | 路径 |
|---|---|
| macOS | `~/Library/Application Support/KnoYoo.Desktop/data/notes.db` |
| Windows | `%APPDATA%\KnoYoo.Desktop\data\notes.db` |
| Linux | `~/.local/share/KnoYoo.Desktop/data/notes.db` |

EPUB / PDF 文件存放于同目录下 `books/`，封面存放于 `book_covers/`。

### Schema 概览

| 表 | 作用 |
|---|---|
| `web_clips` | 剪藏主表（`content` = 清洗后可读版；`raw_content` = 原始 body 文本；软删除字段 `deleted_at`） |
| `web_clips_fts` | FTS5 全文索引 |
| `books` | 图书元数据（含 `ai_status` / `ai_error` 状态追踪、`file_hash` 唯一去重）|
| `collections` + `collection_clips` | 集合管理（含 `filter_rule` 智能集合字段）|
| `clip_notes` | 用户笔记（1:1 关联）|
| `chat_sessions` | AI 对话历史（持久化）|
| `weekly_reports` | 周报缓存 |
| `app_kv` | 应用配置（AI Key、server token、主题等）|

---

## 贡献

Issue 和 PR 欢迎。开发约定：

- Rust 后端：遵循 `clippy pedantic`
- 前端：ESLint + Prettier（已配置 lint-staged，commit 自动修复）
- Commit：Conventional Commits（`feat:` / `fix:` / `chore:` / `docs:`）

## License

MIT
