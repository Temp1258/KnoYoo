# KnoYoo

**本地优先的个人智库**。把浏览器里值得记的网页、读过的书、刷过的视频，变成可搜索、可关联、AI 能帮你翻的知识。

数据 100% 存在本机 SQLite 里，不上云。

---

## 📥 下载

最新版本直接从 GitHub Release 拿：

| 平台 | 文件 |
|---|---|
| **macOS** (Apple Silicon) | `KnoYoo_*_aarch64.dmg` |
| **macOS** (Intel) | `KnoYoo_*_x64.dmg` |
| **Windows** (x64) | `KnoYoo_*_x64_en-US.msi` |
| **Linux** (x64) | `KnoYoo_*_amd64.AppImage` · `.deb` |

👉 **[最新 Release](https://github.com/Temp1258/KnoYoo/releases/latest)**

浏览器扩展需要配合桌面端使用，首次启动按引导装一下即可。

---

## ✨ 核心能力

### 📝 智库 · 网页剪藏
浏览器点一下收藏整页内容。AI 自动补摘要、打标签、抽取结构化字段。详情页支持「可读版 / 原始」切换。

**三阶段管道**：raw → AI 清洗 → 摘要，带 size guard 避免吞原文。

### 📚 书籍 · EPUB / PDF 入库
拖书进桌面端，AI 读前万字自动填：

- 真实标题（忽略 `Microsoft Word - xxx.doc` 这类残留）
- 作者、出版社、出版年份
- 中文简介 + 标签

**PDF 双路抽取**：先 `pdf-extract`（处理 ToUnicode CMap），降级到 `lopdf`。中文/子集字体 PDF 也能吃。扫描版 PDF 落到文件名占位，tile 上有 `⚠` 角标。

书架按 *想读 / 正在读 / 已读 / 弃读* 分组，记录进度、评分、私人笔记。

### 🎬 视频收藏
- **YouTube**：解析 `ytInitialPlayerResponse`，抓 publisher 字幕，没有退化到 ASR
- **Bilibili**：通过 `x/web-interface/view` API 拿标题、UP 主、简介。支持 BV 号、`b23.tv`、`/video/...` 追踪链接

### 🤖 AI 助手
- 兼容 **DeepSeek / OpenAI / Ollama（本地零成本）/ 通义千问 / GLM / Moonshot / SiliconCloud / Anthropic**
- **AI 语义搜索**：全文搜索空结果时自动兜底，自然语言描述找回内容
- **AI 聊天助手**：基于智库问答，**附引用来源**，聊天持久化
- **每周学习总结**：AI 分析 7 天收藏轨迹

### 🔍 搜索与发现
SQLite FTS5 全文搜索，毫秒响应。标签、域名、时间、星标多维筛选。

- **搜索历史**：按条删除 × 或一键清空
- **集合**：主题 + 颜色分组
- **发现页**：标签词云 / Top 来源 / 28 天趋势 / 遗忘提醒

### 🎨 9 套主题 + 主题感知 Logo
极简亮、深夜灰、羊皮纸、深海蓝、森岭绿、黄昏紫、极夜黑、薄荷青、摩卡棕。内联 SVG Logo 自动跟随主题色重上色。

### 🛡️ 安全与隐私
- 本地 HTTP 服务只绑 `127.0.0.1:19836`
- Bearer Token 鉴权（32 字节 hex，常量时间比较）
- SSRF 防护：URL 抓取阻断 localhost / 私有 IP / `.internal` / `.local`
- 严格 CSP，`connect-src` 白名单
- 输入长度限制（URL 4 KB / 内容 500 KB / 聊天 5 MB / 书籍 500 MB）
- 错误信息不泄露内部路径或数据库细节

### 💾 数据主权
- 软删除 + 独立乐色（30 天自动清理）
- 一键备份/恢复整个 SQLite（走 Backup API 保证一致性）
- 数据库路径在设置页可见，想挪想删完全自由

---

## 🚀 从源码开发

**环境要求**：Node.js ≥ 18.18、pnpm ≥ 10.15、Rust stable，加 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/Temp1258/KnoYoo.git
cd KnoYoo
pnpm install

# 桌面端开发模式（Vite HMR + Tauri 窗口）
cd apps/desktop && pnpm tauri:dev

# 构建发布版
pnpm tauri:build
# 产物：apps/desktop/src-tauri/target/release/bundle/

# 浏览器扩展
cd apps/browser-extension && pnpm build
```

**装浏览器扩展**：`chrome://extensions` → 开发者模式 → 加载已解压 → 选 `apps/browser-extension/dist`。扩展会自动和桌面端握手，无需手动配 Token。

---

## 🗂️ 项目结构

```
apps/
├── desktop/                    # Tauri 2 桌面端
│   ├── src/                    # React 19 + TypeScript + Tailwind 4
│   │   ├── pages/              # 智库 / 书籍 / 集合 / 发现 / 乐色 / 设置
│   │   ├── components/         # Layout / Books / Clips / Trash / AI / ...
│   │   └── hooks/              # useTheme / useBooks / useSearchHistory / ...
│   └── src-tauri/              # Rust 核心
│       └── src/                # ai / books / clips / server / db / ...
└── browser-extension/          # Chrome / Edge MV3 扩展
```

### Rust 模块要点

| 文件 | 职责 |
|---|---|
| `server.rs` | 本地 HTTP (`127.0.0.1:19836`)，扩展握手 + 鉴权 |
| `clips.rs` | 网页剪藏 CRUD + 三阶段 AI 管道 |
| `books.rs` | EPUB / PDF 入库，AI 元数据抽取，书架分组 |
| `ai.rs` | 多厂商 AI 适配 + JSON 解析健壮化 |
| `search.rs` | FTS5 全文检索 + AI 语义兜底 |
| `db.rs` | SQLite schema + 迁移 + FTS 触发器 |

---

## 🗺️ 数据存储路径

| 系统 | 路径 |
|---|---|
| macOS | `~/Library/Application Support/KnoYoo.Desktop/data/notes.db` |
| Windows | `%APPDATA%\KnoYoo.Desktop\data\notes.db` |
| Linux | `~/.local/share/KnoYoo.Desktop/data/notes.db` |

删除数据走软删除 → 乐色 → 30 天自动清除。想全量重置？删上面的目录即可。

---

## 🛣️ 路线图

**已完成（v2.x）**
- [x] 本地优先架构，Tauri 2 桌面 + 浏览器扩展
- [x] 三阶段网页管道（raw → AI 清洗 → 摘要）
- [x] 书籍 EPUB / PDF 双路抽取 + AI 元数据
- [x] 9 套主题 + 主题感知 SVG Logo
- [x] AI 对话（带引用）+ 语义搜索 + 周报
- [x] 统一乐色 + 数据库备份/恢复
- [x] YouTube 字幕 + Bilibili 公共 API
- [x] 搜索历史按条删除

**规划中**
- [ ] 订阅制（免配 API Key，走云端代理）
- [ ] 端到端加密多端同步（可选）
- [ ] 全文 OCR（扫描版 PDF 兜底）

---

## 📄 License

MIT
