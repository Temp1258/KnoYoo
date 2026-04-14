# KnoYoo — 本地优先的 AI 知识管理助手

> 一键收藏，AI 自动整理，再也不丢失你读过的好内容。

KnoYoo 是一个 **本地优先** 的个人知识管理工具，由 Tauri 桌面端 + 浏览器扩展组成。它解决一个很具体的问题：**你在网上读到了好内容，收藏了，然后再也找不到了。**

浏览器扩展一键收藏网页 → AI 自动生成摘要和标签 → 全文搜索 + AI 语义搜索帮你找回。**所有剪藏数据 100% 存储在本地 SQLite，永远不会上传到云端。**

---

## 功能一览

### 收藏
- 浏览器扩展一键保存（Chrome / Edge / Firefox）
- 扩展安装后 **自动 handshake 连接** 桌面端，无需手动复制 Token
- 自动提取正文、标题、favicon、Open Graph 图片
- YouTube / Bilibili 视频字幕自动提取
- 右键菜单快捷导入文章/视频
- 离线队列：桌面端未运行时自动缓存，上线后同步
- 支持导入 Chrome / Firefox / Edge 书签（带文件夹筛选 + 勾选导入 + 失败重试）

### AI 智能整理
- 收藏时自动生成中文摘要 + 关键词标签
- 复用已有标签，保持标签体系一致
- 支持多种 AI 服务商：DeepSeek / OpenAI / Ollama（本地）/ 通义千问 / GLM / Moonshot / SiliconCloud / Anthropic
- 批量标签：一键处理所有未标注内容
- **AI 语义搜索**：普通搜索无结果时自动 fallback，用自然语言描述找回内容
- **AI 知识助手**：基于你的知识库对话问答，回答时 **附带引用来源**
- 聊天会话 **持久化保存**，支持历史记录切换
- 每周学习总结：AI 分析你一周收藏的内容

### 搜索与浏览
- 全文搜索（SQLite FTS5，毫秒级响应）**支持无限滚动分页**
- 多维度筛选：标签、域名、时间范围、星标、已读/未读
- 搜索无结果时自动切换到 AI 语义搜索
- 集合管理：主题归类，支持颜色和描述
- 个人笔记：为任意收藏添加批注
- 相关推荐：打开收藏时自动推荐相关内容
- 发现页：知识画像（标签词云 / 来源 Top5 / 28 天趋势）+ 遗忘内容提醒 + AI 周报

### 数据安全
- **软删除 + 回收站**：删除不会立即丢失，30 天内可恢复
- **数据库一键备份/恢复**：使用 SQLite Backup API，保证一致性快照
- 设置页显示数据库存储位置和占用空间
- 所有数据在本地，文件路径可见，你拥有完全控制权

### 安全加固
- 本地 HTTP 服务器仅监听 `127.0.0.1`
- Token 使用 OS 安全随机数（`getrandom`）生成，32 字节 hex
- Token 比较为 **常量时间比较**，防御时序攻击
- Handshake 端点 **速率限制**（3 秒冷却）防暴力破解
- 严格 CSP 策略，`connect-src` 白名单限定 AI 供应商域名
- SSRF 防护：URL 抓取阻止 localhost / 私有 IP / link-local
- 输入长度限制：URL 4KB / 内容 500KB / 聊天 5MB / 书签文件 50MB
- 错误信息不泄露内部路径或数据库细节

---

## 技术架构

```
┌──────────────────────────────────────────────────────┐
│                  桌面端 (Tauri 2)                      │
│  ┌────────────────────┐  ┌─────────────────────────┐  │
│  │   React 19 前端     │  │   Rust 后端              │  │
│  │   TypeScript 5      │◄►│   SQLite + FTS5         │  │
│  │   Tailwind CSS 4    │  │   AI Client (OpenAI 兼容) │  │
│  │   React Router 7    │  │   SSRF-safe HTML fetcher │  │
│  └────────────────────┘  └───────────┬─────────────┘  │
│                                      │ 127.0.0.1:19836│
└──────────────────────────────────────┼────────────────┘
                                       │ HTTP + Bearer token
┌──────────────────────────────────────┼────────────────┐
│              浏览器扩展 (Manifest V3)   │                │
│  ┌──────────┐ ┌──────────┐ ┌────────┴─────┐           │
│  │ Content  │ │  Popup   │ │  Background  │           │
│  │ Script   │ │   UI     │ │  Worker      │           │
│  │ 内容提取  │ │ 一键收藏 │ │ 离线队列     │           │
│  └──────────┘ └──────────┘ └──────────────┘           │
└───────────────────────────────────────────────────────┘

                (可选) 订阅服务 — 尚未启用
┌──────────────────────────────────────────────────────┐
│              apps/cloud/ Supabase 脚手架              │
│  Auth (Google/Apple/邮箱)  │  AI 代理 Edge Function    │
│  订阅管理 (LemonSqueezy)   │  License 验证             │
└──────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | [Tauri 2](https://v2.tauri.app/) (Rust + WebView) |
| 前端 | React 19 + TypeScript + Vite 7 |
| 样式 | Tailwind CSS 4 |
| 路由 | React Router 7 |
| 数据库 | SQLite (rusqlite bundled) + FTS5 全文搜索 + Backup API |
| AI 客户端 | OpenAI 兼容 API (`ureq`) |
| HTML 解析 | `scraper` (CSS 选择器) |
| 安全随机数 | `getrandom` (跨平台 OS 熵源) |
| 浏览器扩展 | Chrome Manifest V3 + Vanilla TypeScript |
| 包管理 | pnpm (monorepo) |
| 代码质量 | ESLint + Prettier + Husky + lint-staged |

### 项目结构

```
KnoYoo/
├── apps/
│   ├── desktop/                    # Tauri 桌面端
│   │   ├── src/
│   │   │   ├── pages/              # ClipsPage / DiscoverPage / CollectionsPage
│   │   │   │                       # CollectionDetailPage / SettingsPage / TrashPage
│   │   │   ├── components/
│   │   │   │   ├── AI/             # ChatDrawer / AISettingsPanel
│   │   │   │   ├── Clips/          # ClipCard / ClipDetail / EmptyState
│   │   │   │   ├── Collections/    # AddToCollectionDialog
│   │   │   │   ├── Import/         # BookmarkImportDialog
│   │   │   │   ├── Layout/         # AppShell / NavSidebar
│   │   │   │   ├── Onboarding/     # OnboardingFlow (2 步简化版)
│   │   │   │   ├── common/         # Toast / ErrorBoundary
│   │   │   │   └── ui/             # 通用 UI 组件
│   │   │   ├── hooks/              # useTauriInvoke / useMediaQuery / ...
│   │   │   └── types.ts
│   │   ├── src-tauri/              # Rust 后端
│   │   │   └── src/
│   │   │       ├── main.rs         # 入口 + 系统托盘 + 命令注册
│   │   │       ├── db.rs           # SQLite + Schema + FTS 触发器
│   │   │       ├── clips.rs        # Clip CRUD + 搜索 + 回收站 + 聊天会话
│   │   │       ├── collections.rs  # 集合管理
│   │   │       ├── ai.rs           # AI 对话 + 引用追踪
│   │   │       ├── ai_client.rs    # OpenAI API 客户端
│   │   │       ├── clip_server.rs  # 本地 HTTP 服务器 + handshake
│   │   │       ├── html_extract.rs # SSRF-safe 网页抓取
│   │   │       ├── import.rs       # 书签导入
│   │   │       ├── export.rs       # Markdown 导出 + 数据库备份
│   │   │       └── error.rs        # 统一错误类型
│   │   └── tauri.conf.json         # 含严格 CSP 配置
│   │
│   ├── browser-extension/          # 浏览器扩展
│   │   └── src/
│   │       ├── background/         # Service Worker + 离线队列
│   │       ├── content/            # 内容提取 + 字幕抓取
│   │       ├── popup/              # 弹窗 UI + 自动弹窗开关
│   │       └── utils/              # API 通信 + autoHandshake
│   │
│   └── cloud/                      # (可选) 云端脚手架，订阅功能用
│       └── supabase/
│           ├── migrations/         # users / subscriptions / usage_logs
│           └── functions/          # ai-proxy / license-check
│
├── package.json
└── pnpm-workspace.yaml
```

---

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) ≥ 18.18
- [pnpm](https://pnpm.io/) ≥ 10.15
- [Rust](https://rustup.rs/) stable
- Tauri 2 系统依赖：参考 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/)

### 安装运行

```bash
# 克隆项目
git clone https://github.com/Temp1258/KnoYoo.git
cd KnoYoo

# 安装依赖
pnpm install

# 开发模式
cd apps/desktop && pnpm tauri:dev

# 构建浏览器扩展
cd apps/browser-extension && pnpm build
```

### 安装浏览器扩展

1. 打开 `chrome://extensions`
2. 启用右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `apps/browser-extension/dist` 目录
5. 扩展会自动与桌面端握手，无需手动配置 Token

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

### 2. 配置 AI（可选）

设置 → AI 配置 → 填写 API Key（支持 DeepSeek、OpenAI、Ollama 等）。

> 未来的订阅版本可免配置直接使用 AI 功能（见「路线图」）。

### 3. 开始收藏

- 浏览任何网页时点击扩展图标一键保存
- 或启用扩展的「自动弹窗」在每个页面显示收藏浮窗
- 内容会自动同步到桌面端，AI 在后台生成摘要和标签

### 4. 查找内容

- 顶部搜索框支持关键词搜索
- 搜索无结果时自动切换到 AI 语义搜索
- 侧边栏按钮：知识库 / 集合 / 发现 / 回收站 / 设置
- 发现页查看标签词云、来源 Top5、28 天趋势

### 5. 数据管理

- 删除进入回收站，30 天内可恢复
- 设置 → 数据 → 备份整个数据库 / 从备份恢复
- 所有数据存储路径在设置页可见

---

## 数据存储

### 本地路径

| 系统 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/KnoYoo/Desktop/data/notes.db` |
| Windows | `%APPDATA%\KnoYoo\Desktop\data\notes.db` |
| Linux | `~/.local/share/KnoYoo/Desktop/data/notes.db` |

### Schema 概览

- `web_clips` — 剪藏主表（含 `deleted_at` 软删除字段）
- `web_clips_fts` — FTS5 全文索引（自动排除软删除的条目）
- `collections` + `collection_clips` — 集合管理（含 `filter_rule` 智能集合字段）
- `clip_notes` — 用户笔记（1:1 关联）
- `chat_sessions` — AI 对话历史
- `weekly_reports` — 周报缓存
- `app_kv` — 应用配置（含 server token、AI 配置等）

---

## 隐私承诺

- 🔒 剪藏数据 **100% 存储在本地 SQLite**，永远不会上传到云端
- 🔒 AI 功能仅在你主动使用时，将必要内容发送给 AI 供应商（可换成本地 Ollama）
- 🔒 KnoYoo 不收集任何用户数据，不使用遥测
- 🔒 本地 HTTP 服务仅监听 `127.0.0.1`，其它设备无法访问
- 🔒 浏览器扩展与桌面端通信使用 Bearer token 鉴权

---

## 路线图

### 已完成 (v2.x)
- [x] 本地优先架构
- [x] Tauri 桌面端 + 浏览器扩展
- [x] AI 自动标签 + 语义搜索 + 对话助手
- [x] 集合 / 笔记 / 导入 / 导出
- [x] 发现页知识画像
- [x] 软删除 + 回收站 + 数据库备份/恢复
- [x] 扩展自动握手连接
- [x] AI 聊天引用来源 + 会话持久化
- [x] 安全加固（CSP / 常量时间比较 / 速率限制 / 输入验证）

### 规划中
- [ ] 订阅制（免配置 API Key，走云端代理）
- [ ] 数据同步（端到端加密，可选）
- [ ] 全局快捷键 (Cmd+K 搜索)
- [ ] 智能集合（规则匹配自动归类）
- [ ] 上架 Chrome Web Store
- [ ] 上架 macOS DMG / Windows NSIS

---

## 贡献

Issue 和 PR 欢迎。开发前建议阅读：

- Rust 后端代码风格：遵循 clippy pedantic
- 前端代码风格：ESLint + Prettier (已配置 lint-staged)
- Commit 遵循 Conventional Commits（`feat:` / `fix:` / `chore:` / `docs:`）

## License

MIT
