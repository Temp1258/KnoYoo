# KnoYoo - 本地优先的 AI 知识管理助手

> 一键收藏，AI 自动整理，再也不丢失你读过的好内容。

KnoYoo 是一个**本地优先**的个人知识管理工具，由 Tauri 桌面应用 + 浏览器扩展组成。它解决的核心问题是：**你在网上读到了好内容，收藏了，然后再也找不到了。**

KnoYoo 通过浏览器扩展一键收藏网页，AI 自动生成摘要和标签，全文搜索 + 语义搜索帮你快速找回，所有数据存储在本地 SQLite，不经过任何云端。

## 功能特性

### 收藏
- 浏览器扩展一键收藏（支持 Chrome / Edge / Firefox）
- 自动提取正文、标题、favicon、Open Graph 图片
- YouTube 视频字幕自动提取
- 右键菜单快捷导入文章/视频
- 离线队列：桌面端未运行时自动缓存，上线后同步
- 支持导入 Netscape 书签文件（Chrome / Firefox / Edge 导出格式）

### AI 智能整理
- 收藏时自动生成中文摘要 + 关键词标签
- 已有标签复用，保持标签体系一致性
- 支持多种 AI 服务商：DeepSeek、OpenAI、Ollama（本地）、通义千问、GLM、Moonshot、SiliconCloud、Anthropic
- 批量标签：一键为所有未处理内容生成摘要和标签
- AI 语义搜索：用自然语言描述，找到记忆中的内容
- AI 知识助手：基于你的知识库进行对话问答
- 每周学习总结：AI 分析你一周的收藏，生成洞察报告

### 组织与检索
- 全文搜索（基于 SQLite FTS5，毫秒级响应）
- 多维度筛选：标签、域名、时间范围、星标、已读/未读
- 集合管理：将相关内容整理到主题集合中
- 个人笔记：为任意收藏添加自己的笔记和批注
- 相关推荐：打开一条收藏时，自动推荐相关内容
- "你可能忘了"：随机推荐 30 天前的收藏，唤醒遗忘的知识

### 导出与分享
- 单条导出为 Markdown（含 YAML frontmatter）
- 整个集合导出为目录结构
- 数据完全在本地，随时可迁移

## 技术架构

```
┌─────────────────────────────────────────────────────┐
│                   桌面应用 (Tauri)                     │
│  ┌────────────────────┐  ┌────────────────────────┐  │
│  │   React 前端        │  │   Rust 后端             │  │
│  │   React 19          │  │   SQLite + FTS5        │  │
│  │   React Router 7    │◄►│   AI Client (OpenAI)   │  │
│  │   Tailwind CSS 4    │  │   HTML Extractor       │  │
│  │   Lucide Icons      │  │   Local HTTP Server    │  │
│  └────────────────────┘  └──────────┬─────────────┘  │
│                                     │ :19836          │
└─────────────────────────────────────┼─────────────────┘
                                      │ HTTP + Token
┌─────────────────────────────────────┼─────────────────┐
│              浏览器扩展 (Manifest V3)  │                 │
│  ┌──────────┐ ┌──────────┐ ┌───────┴──────┐          │
│  │ Content  │ │  Popup   │ │  Background  │          │
│  │ Script   │ │   UI     │ │  Worker      │          │
│  │ 内容提取  │ │ 一键收藏  │ │ 离线队列     │          │
│  └──────────┘ └──────────┘ └──────────────┘          │
└───────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | [Tauri 2](https://v2.tauri.app/) (Rust + WebView) |
| 前端 | React 19 + TypeScript + Vite 7 |
| 样式 | Tailwind CSS 4 |
| 路由 | React Router 7 |
| 数据库 | SQLite (rusqlite, bundled) + FTS5 全文搜索 |
| AI 客户端 | OpenAI 兼容 API (ureq HTTP) |
| HTML 解析 | scraper (CSS 选择器) |
| 浏览器扩展 | Chrome Manifest V3 + Vanilla TypeScript |
| 包管理 | pnpm (monorepo) |
| 代码质量 | ESLint + Prettier + Husky + lint-staged |

### 项目结构

```
KnoYoo/
├── apps/
│   ├── desktop/                  # Tauri 桌面应用
│   │   ├── src/                  # React 前端
│   │   │   ├── pages/            # 页面组件 (5 个)
│   │   │   ├── components/       # UI 组件库
│   │   │   ├── hooks/            # 自定义 Hooks
│   │   │   └── types.ts          # 类型定义
│   │   ├── src-tauri/            # Rust 后端
│   │   │   └── src/
│   │   │       ├── main.rs       # 应用入口 + 系统托盘
│   │   │       ├── db.rs         # SQLite 连接 + Schema
│   │   │       ├── clips.rs      # Clip CRUD + 搜索 + AI
│   │   │       ├── collections.rs# 集合管理
│   │   │       ├── ai.rs         # AI 配置 + 对话
│   │   │       ├── ai_client.rs  # OpenAI API 客户端
│   │   │       ├── clip_server.rs# 本地 HTTP 服务器
│   │   │       ├── html_extract.rs# 网页内容提取
│   │   │       ├── import.rs     # 书签导入
│   │   │       └── export.rs     # Markdown 导出
│   │   └── package.json
│   │
│   └── browser-extension/        # 浏览器扩展
│       ├── src/
│       │   ├── background/       # Service Worker
│       │   ├── content/          # 内容脚本 + 字幕提取
│       │   ├── popup/            # 弹窗 UI
│       │   └── utils/            # API 通信
│       └── manifest.json
│
├── package.json                  # Monorepo 根配置
└── pnpm-workspace.yaml
```

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18.18
- [pnpm](https://pnpm.io/) >= 10.15
- [Rust](https://rustup.rs/) (stable)
- Tauri 2 系统依赖：参考 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/)

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/Temp1258/KnoYoo.git
cd KnoYoo

# 安装依赖
pnpm install

# 启动桌面应用（开发模式）
cd apps/desktop
pnpm tauri:dev
```

### 构建

```bash
# 构建桌面应用
cd apps/desktop
pnpm tauri:build

# 构建浏览器扩展
cd apps/browser-extension
pnpm build
# 产物在 dist/，在浏览器中加载未打包的扩展
```

### 配置浏览器扩展

1. 启动桌面应用
2. 打开浏览器，进入 `chrome://extensions/`（或对应浏览器的扩展页面）
3. 开启「开发者模式」，点击「加载已解压的扩展程序」
4. 选择 `apps/browser-extension/dist/` 目录
5. 点击扩展图标，在设置中填入桌面应用提供的 Token（在知识库页面的 `⋯` 菜单中复制）

### 配置 AI

在桌面应用的「设置」页面中配置 AI 服务商：

| 服务商 | API Base | 推荐模型 |
|--------|----------|---------|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| OpenAI | `https://api.openai.com` | `gpt-4o-mini` |
| Ollama (本地) | `http://localhost:11434` | 自动检测 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode` | `qwen-plus` |
| Moonshot | `https://api.moonshot.cn` | `moonshot-v1-8k` |

也支持任何 OpenAI 兼容的 API 端点。

## 数据存储

所有数据存储在本地 SQLite 数据库中：

- **macOS**: `~/Library/Application Support/KnoYoo/Desktop/data/notes.db`
- **Windows**: `%APPDATA%/KnoYoo/Desktop/data/notes.db`
- **Linux**: `~/.local/share/KnoYoo/Desktop/data/notes.db`

数据库包含以下表：

| 表 | 用途 |
|----|------|
| `web_clips` | 收藏内容（URL、标题、正文、摘要、标签） |
| `web_clips_fts` | 全文搜索索引（FTS5 虚拟表） |
| `collections` | 集合 |
| `collection_clips` | 集合-收藏多对多关系 |
| `clip_notes` | 用户笔记 |
| `weekly_reports` | 每周学习报告 |
| `app_kv` | 应用配置（AI 设置、Token 等） |

## 安全设计

- **本地优先**：所有数据存储在本地，不经过任何云端服务器
- **Token 认证**：浏览器扩展与桌面应用之间使用随机 Token 认证
- **SSRF 防护**：服务端 URL 抓取会校验每一跳重定向，拒绝内网/私有 IP
- **API Key 遮蔽**：前端永远不会看到完整的 API Key
- **仅监听本地**：HTTP 服务器绑定 `127.0.0.1`，不对外暴露

## 开发

```bash
# 类型检查
cd apps/desktop && pnpm typecheck

# Lint
pnpm lint

# 格式化
pnpm format

# Rust 测试
cd apps/desktop/src-tauri && cargo test

# 前端测试
cd apps/desktop && pnpm test
```

## License

[ISC](LICENSE)
