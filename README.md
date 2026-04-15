# KnoYoo — 本地优先的 AI 知识管理助手

> 一键收藏网页，拖入电子书，AI 自动整理，再也找不回的内容从此成为过去。

KnoYoo 是一个 **本地优先** 的个人知识管理工具，由 Tauri 桌面端 + 浏览器扩展组成。它要解决的问题很具体：**你在网上读到的好内容、下载过的电子书，很快就忘了在哪、叫什么。**

浏览器扩展一键收藏网页 / 拖入 EPUB、PDF → AI 自动清洗正文、提炼摘要、标记分类 → 全文搜索 + AI 语义搜索帮你找回。**所有数据 100% 存储在本地 SQLite，永远不会上传到云端。**

---

## 📥 下载

最新版本从 GitHub Release 下载：

| 平台 | 文件 |
|---|---|
| **macOS** (Apple Silicon) | `KnoYoo_*_aarch64.dmg` |
| **Windows** (x64) | `KnoYoo_*_x64_zh-CN.msi` |

👉 **[最新 Release](https://github.com/Temp1258/KnoYoo/releases/latest)**

浏览器扩展需要配合桌面端使用，首次启动按引导装一下即可。

> macOS Intel 与 Linux 构建暂未包含——Intel Mac runner 在 GitHub Actions 上已陆续下线；Linux AppImage / deb 需求较低，优先保证两大主流平台。如有需要可从源码自行构建（`pnpm tauri:build`）。

---

## 核心特性

### 📎 网页收藏 · 三阶段 AI 管道

浏览器里一键保存，后端按三阶段处理：

1. **Raw** — 同时保留 content script（浏览器渲染后可见文本）+ 服务端 SSRF-safe 抓取两路原文，互相兜底。SPA 站点（SpaceX、React 类）不会只留标题
2. **Readable** — AI 清洗成可读 Markdown 正文，严禁概括。带 size guard：清洗结果不能压缩原文超过 66%，否则拒绝覆盖
3. **Summary + Tags** — 基于清洗后的正文生成精炼中文摘要和关键词标签，复用已有标签保持体系一致

详情页支持「**可读版 / 原始**」切换，两边都可查。AI 摘要可手动编辑或一键重跑。

### 📚 书籍 · EPUB / PDF 知识入库

拖入书籍文件，AI 通读正文前万字，自动填充：

- 真实标题（忽略 "Microsoft Word - xxx.doc" 这类残留）
- 作者、出版社、年份
- 2-4 句中文简介
- 3-5 个关键词标签

**PDF 双路抽取**：先用 `pdf-extract`（高层库，兼容 ToUnicode CMap），失败才降级到 `lopdf` 逐页，中文/子集字体 PDF 也能吃下。纯扫描版 PDF 无法抽文字时自动以 **文件名** 作为占位标题，tile 上显示 `⚠` 角标，抽屉里弹出错误与重试按钮。

其他能力：

- 封面自动提取（EPUB）或生成色块封面
- 书架按 想读 / 正在读 / 已读 / 弃读 分组
- 阅读进度、评分、标签、私人笔记
- 系统默认阅读器一键打开
- 软删除 + 图书专用乐色

### 🎬 视频收藏

- **YouTube**：解析 `ytInitialPlayerResponse`，优先抓 publisher 字幕，没有则用 ASR 自动字幕，逐字入库（≤ 80K 字符）
- **Bilibili**：通过公开 `x/web-interface/view` API 拿标题、UP 主、简介、时长。支持 BV 号、`b23.tv` 短链、`/video/...?spm_id_from=...` 追踪链接（自动清洗去重）
- 右键菜单支持直接导入链接对应页面，SPA 站点无法抓取时给出明确提示

### 🤖 AI 智能

- 多服务商兼容：DeepSeek / OpenAI / Ollama（本地零成本）/ 通义千问 / GLM / Moonshot / SiliconCloud / Anthropic
- 收藏自动打标签 + 摘要；批量重跑支持
- **AI JSON 解析健壮**：能从 "好的，这是结果：{...}" 这种带前后缀的回复里找出平衡括号 JSON，配 1 次失败重试
- **AI 语义搜索**：全文搜索无结果时自动兜底，用自然语言描述找回内容
- **AI 知识助手**：基于你的智库对话问答，回答 **附带引用来源**，聊天会话持久化
- 每周学习总结：AI 分析你一周收藏的内容

### 🔍 搜索与发现

- SQLite FTS5 全文搜索，毫秒级响应
- 多维度筛选：标签、域名、时间范围、星标、已读/未读
- 集合归类：主题 + 颜色 + 描述
- 个人笔记：为任意剪藏/图书添加批注
- 相关推荐：打开一条收藏时自动推荐相关内容
- 发现页：标签词云 / 来源 Top5 / 28 天趋势 / 遗忘内容提醒

### 🛡️ 安全与隐私

- **本地 HTTP 服务** 仅监听 `127.0.0.1:19836`，其它设备无法访问
- **Bearer Token 鉴权**：OS 随机数生成，32 字节 hex，常量时间比较
- **专用 `/api/auth-check` 端点**：扩展能区分"桌面端离线" vs "Token 不匹配"，popup 支持一键重新握手
- **Handshake 速率限制**（3 秒冷却）
- **SSRF 防护**：URL 抓取阻断 localhost / 私有 IP / link-local / `.internal` / `.local`
- **严格 CSP**，`connect-src` 白名单限定 AI 供应商域名
- **输入长度限制**：URL 4KB / 内容 500KB / 聊天 5MB / 书籍 500MB
- 错误信息不泄露内部路径或数据库细节

### 💾 数据

- 软删除 + 独立乐色（30 天自动清理）
- 数据库一键备份/恢复，走 SQLite Backup API 保证一致性
- 设置页显示数据库位置和占用空间
- 所有文件路径可见，你拥有完全控制权

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

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) ≥ 18.18
- [pnpm](https://pnpm.io/) ≥ 10.15
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
5. 扩展会自动与桌面端握手，无需手动配置 Token。如 Token 失效，popup 内置「🔄 一键重新握手」按钮

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

## 隐私承诺

- 🔒 所有剪藏、图书、笔记 **100% 存储在本地 SQLite**，永远不会上传到云端
- 🔒 AI 功能仅在你主动使用时，将必要内容发送给你配置的 AI 供应商（可全换成本地 Ollama）
- 🔒 KnoYoo 不收集任何用户数据，不使用遥测、埋点、分析
- 🔒 本地 HTTP 服务仅监听 `127.0.0.1`，其它设备无法访问
- 🔒 浏览器扩展与桌面端通信使用 Bearer token 鉴权 + 常量时间比较

---

## 路线图

### 已完成（v2.x）

- [x] 本地优先架构
- [x] Tauri 桌面端 + 浏览器扩展
- [x] AI 自动标签 + 语义搜索 + 对话助手（附引用）
- [x] 集合 / 笔记 / 书签导入 / Markdown + DB 导出
- [x] 发现页知识画像
- [x] 软删除 + 统一乐色 + 数据库备份/恢复
- [x] 扩展自动握手连接 + token 鉴权
- [x] 安全加固（CSP / 常量时间比较 / SSRF / 速率限制 / 输入验证）
- [x] **书籍**：EPUB / PDF 拖入 + AI 元数据抽取 + 封面展示
- [x] **三阶段网页管道**：raw → AI 清洗 → 摘要，带 size guard 不吞原文
- [x] YouTube 字幕 + Bilibili 公共 API
- [x] PDF 双路抽取（pdf-extract + lopdf）
- [x] AI JSON 解析健壮化 + 失败重试
- [x] **v2.0.2**：主题感知 SVG Logo（9 套配色自动跟随）/ 搜索历史逐条删除 / Dock 图标 HIG 内边距

### 规划中

- [ ] 订阅制（免配置 API Key，走云端代理）
- [ ] 端到端加密多端同步（可选）
- [ ] 全局快捷键（Cmd+K 搜索）
- [ ] 智能集合（规则自动归类）
- [ ] 扫描 PDF OCR 支持
- [ ] Bilibili 字幕抓取
- [ ] 上架 Chrome Web Store
- [ ] 分发 macOS DMG / Windows NSIS

---

## 贡献

Issue 和 PR 欢迎。开发约定：

- Rust 后端：遵循 `clippy pedantic`
- 前端：ESLint + Prettier（已配置 lint-staged，commit 自动修复）
- Commit：Conventional Commits（`feat:` / `fix:` / `chore:` / `docs:`）

## License

MIT
