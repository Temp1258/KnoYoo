# KnoYoo 产品转型路线图

## 核心转型方向

**从"手动记录学习的工具"转型为"一键收藏 + 自动整理 + 智能检索的第二大脑"**

解决的核心痛点：用户在浏览器中看到有价值的内容（文章、视频、文档），收藏后再也找不到，最终在收藏夹吃灰。

### 产品形态

```
┌─────────────────────┐      自动入库       ┌──────────────────────────┐
│   浏览器插件          │  ──────────────→   │   桌面端 App（现有）        │
│   - 一键收藏按钮       │                    │   - 本地数据库存储          │
│   - 自动抓取网页内容    │                    │   - AI 自动整理/打标签      │
│   - 零操作成本         │                    │   - 全文检索              │
│                       │                    │   - 知识关联 & 技能树      │
└─────────────────────┘                     └──────────────────────────┘
```

---

## Phase 0：桌面端适配（1-2 周）

> 目标：让现有桌面端从"手动笔记工具"变成"内容收纳箱"，为插件入库做好接收端准备。

### 0.1 新增 `web_clips` 数据表

现有 `notes` 表是手动笔记，新建独立的 `web_clips` 表存储网页抓取内容，职责分离。

**文件：** `apps/desktop/src-tauri/src/db.rs`

```sql
CREATE TABLE IF NOT EXISTS web_clips (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url         TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',       -- 正文 markdown
    summary     TEXT NOT NULL DEFAULT '',       -- AI 生成的摘要
    tags        TEXT NOT NULL DEFAULT '[]',     -- JSON 数组，AI 自动打标
    source_type TEXT NOT NULL DEFAULT 'article', -- article / video / doc / tweet
    favicon     TEXT NOT NULL DEFAULT '',
    screenshot  BLOB,                           -- 可选：网页缩略图
    is_read     INTEGER NOT NULL DEFAULT 0,
    is_starred  INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE IF NOT EXISTS web_clips_fts
USING fts5(title, content, summary, tags, tokenize='unicode61');
```

### 0.2 新增后端命令

**文件：** 新建 `apps/desktop/src-tauri/src/clips.rs`

| 命令 | 用途 |
|---|---|
| `add_web_clip` | 插件发送内容 → 存入本地库 |
| `list_web_clips` | 分页列表，支持筛选（标签、来源类型、星标） |
| `search_web_clips` | 全文搜索（标题 + 正文 + 摘要 + 标签） |
| `delete_web_clip` | 删除 |
| `toggle_star_clip` | 星标/取消星标 |
| `ai_auto_tag_clip` | AI 自动生成摘要 + 标签 |
| `bulk_import_clips` | 批量导入（从浏览器书签导入用） |

### 0.3 本地 HTTP Server 用于插件通信

浏览器插件无法直接调用 Tauri 命令，需要桌面端启动一个本地 HTTP 服务接收数据。

**文件：** 新建 `apps/desktop/src-tauri/src/clip_server.rs`

```
POST http://localhost:19836/api/clip
Content-Type: application/json

{
    "url": "https://...",
    "title": "文章标题",
    "content": "正文 markdown",
    "source_type": "article"
}
```

- 端口固定 `19836`（KnoYoo 的谐音）
- 仅监听 `127.0.0.1`，不暴露到外网
- 请求带一个本地 token 做简单鉴权（防止恶意网页调用）
- Token 在应用首次启动时生成，存入 `app_kv` 表，插件配置时读取

### 0.4 桌面端新增"收藏库"页面

**文件：** 新建 `apps/desktop/src/pages/ClipsPage.tsx`

- 路由：`/clips`
- 功能：卡片式瀑布流展示所有收藏
- 搜索栏（全文检索）
- 筛选：标签、来源类型、时间范围、星标
- 每个卡片显示：标题、摘要、标签、来源网站 favicon、收藏时间
- 点击卡片 → 展开正文（markdown 渲染）
- 一键跳转原始 URL

---

## Phase 1：浏览器插件 MVP（2-3 周）

> 目标：实现"一键入库"核心功能。用户在浏览器中看到有用的内容，点一下就存到本地。

### 1.1 项目结构

```
apps/
  desktop/          # 现有桌面端
  browser-extension/ # 新增浏览器插件
    manifest.json    # Chrome Manifest V3
    src/
      popup/         # 点击插件图标的弹窗
        Popup.tsx
        Popup.css
      content/       # 注入到网页的脚本
        extractor.ts # 正文提取逻辑
      background/    # Service Worker
        index.ts     # 监听消息、发送到本地服务
      utils/
        api.ts       # 与桌面端 HTTP Server 通信
        readability.ts # 正文提取（基于 Readability.js）
    package.json
    tsconfig.json
    vite.config.ts
```

同时在 `pnpm-workspace.yaml` 中追加：

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 1.2 核心流程

```
用户点击插件图标
       │
       ▼
  Popup 显示当前页面信息
  [标题] [预览摘要] [一键收藏按钮]
       │
       ▼ 用户点击"收藏"
       │
  content script 提取正文
  (使用 @mozilla/readability 解析 DOM → markdown)
       │
       ▼
  background service worker
  POST → http://localhost:19836/api/clip
       │
       ▼
  桌面端接收 → 存入 SQLite
  → 异步调用 AI 生成摘要 + 标签
       │
       ▼
  Popup 显示 ✓ 已收藏
```

### 1.3 Popup 界面设计

```
┌──────────────────────────────┐
│  KnoYoo                   ✕  │
├──────────────────────────────┤
│                              │
│  📄 如何理解 Rust 的所有权机制  │  ← 自动读取页面标题
│  juejin.cn                   │  ← 域名
│                              │
│  [正文已提取，约 2300 字]       │  ← 预览
│                              │
│  ┌──────────────────────────┐│
│  │      ⚡ 一键收藏          ││  ← 主按钮
│  └──────────────────────────┘│
│                              │
│  连接状态: ● 桌面端已连接      │  ← 实时检测桌面端是否运行
│                              │
└──────────────────────────────┘
```

### 1.4 正文提取策略

按内容类型采用不同策略：

| 类型 | 检测方式 | 提取方法 |
|---|---|---|
| 普通文章 | 默认 | `@mozilla/readability` 提取正文 → turndown 转 markdown |
| YouTube 视频 | URL 匹配 `youtube.com/watch` | 提取标题 + 描述 + 字幕（如有） |
| B站视频 | URL 匹配 `bilibili.com/video` | 提取标题 + 简介 + 评论精选 |
| Twitter/X | URL 匹配 `x.com` | 提取推文全文 + 图片链接 |
| GitHub Repo | URL 匹配 `github.com` | 提取 README 内容 |
| PDF | Content-Type 检测 | 提示用户使用桌面端文件导入 |

### 1.5 离线容错

桌面端未运行时的处理：
- 插件本地用 `chrome.storage.local` 缓存未发送的 clips
- 检测到桌面端上线后自动同步
- Popup 显示"桌面端离线，已暂存 3 条，上线后自动同步"

---

## Phase 2：AI 自动整理（1-2 周）

> 目标：收藏入库后，AI 自动完成所有整理工作，用户无需手动打标签、写摘要、分类。

### 2.1 入库后自动处理流水线

**文件：** 修改 `apps/desktop/src-tauri/src/clips.rs`

```
新 clip 入库
    │
    ▼
异步任务触发 ai_process_clip(clip_id)
    │
    ├─→ 生成 3 句话摘要
    ├─→ 提取 3-5 个标签（从内容中推断，非用户手动）
    ├─→ 判断 source_type（article/video/doc/tweet）
    └─→ 关联到现有技能树节点（如果匹配）
    │
    ▼
更新 web_clips 行（summary, tags, source_type）
```

### 2.2 AI Prompt 设计

```
你是一个知识整理助手。用户收藏了一篇网页内容，请你：

1. 用中文生成 2-3 句话的摘要，提炼核心要点
2. 提取 3-5 个关键词标签（用 JSON 数组格式）
3. 判断内容类型：article / video / doc / tweet / code

用户已有的技能标签：{existing_tags}
如果内容与已有标签相关，优先使用已有标签保持一致性。

网页标题：{title}
网页正文：
{content}
```

### 2.3 智能去重

检测相同 URL 或高度相似内容，避免重复收藏：
- URL 完全相同 → 提示"已收藏过"，可选择更新
- 内容相似度 > 80%（基于摘要对比）→ 提示"存在类似内容"

---

## Phase 3：智能检索体验优化（1-2 周）

> 目标：让用户用"模糊记忆"也能找到收藏过的内容。

### 3.1 多维度搜索

在现有 FTS5 全文搜索基础上增强：

- **关键词搜索**：标题 + 正文 + 摘要 + 标签（已有 FTS5 能力）
- **标签筛选**：点击标签快速过滤
- **时间范围**：最近一周 / 一月 / 自定义
- **来源筛选**：按网站域名过滤

### 3.2 "我记得看过..."模糊搜索

新增命令 `ai_fuzzy_search_clips`：

用户输入模糊描述（如"之前看过一个关于 Rust 生命周期的文章，好像是掘金上的"），AI 在所有收藏的摘要 + 标签中匹配最相关的结果。

```
用户输入模糊描述
       │
       ▼
将描述 + 所有 clips 的 (id, title, summary, tags, url) 发送给 AI
       │
       ▼
AI 返回最匹配的 clip IDs（ranked）
       │
       ▼
展示搜索结果
```

### 3.3 收藏库首页改为"智能信息流"

不只是列表，而是：
- 顶部：搜索栏 + 快捷标签筛选
- 最近收藏（时间线）
- "你可能忘了"推荐（超过 30 天未查看的收藏，随机浮现）
- 每周自动生成"本周收藏摘要"

---

## Phase 4：与现有功能打通（1 周）

> 目标：让"收藏库"和现有的"笔记 + 技能树 + 计划"形成闭环。

### 4.1 Clip → Note 转化

收藏内容可以一键转为笔记，并附带个人批注：

```
web_clip（原始收藏）  ──→  note（加上自己的理解和笔记）
                               │
                               ▼
                        自动关联到技能树节点
```

### 4.2 AI 教练感知收藏数据

修改 `ai_chat_with_context`（`apps/desktop/src-tauri/src/ai.rs`），在 RAG 上下文中加入最近的 web_clips：

```
现有上下文：最近笔记 + 当前计划 + 技能树
新增上下文：最近收藏的 web_clips 摘要
```

这样 AI 教练能说："我看到你最近收藏了 3 篇关于 Kubernetes 的文章，要不要把 K8s 加入你的学习计划？"

### 4.3 技能树自动更新建议

当某个标签的收藏量超过阈值（如 5 篇），AI 主动建议：
- "你已经收藏了 7 篇关于 TypeScript 类型体操的内容，是否要在技能树中添加这个节点？"

---

## 技术决策记录

| 决策点 | 选择 | 原因 |
|---|---|---|
| 插件与桌面端通信 | 本地 HTTP Server | Tauri 无原生插件通信协议，HTTP 是最通用的方式 |
| 正文提取 | Readability.js + Turndown | Mozilla 成熟方案，覆盖 95% 网页 |
| 插件框架 | Chrome Manifest V3 | 标准规范，后续可适配 Firefox/Edge |
| 存储与笔记分离 | 独立 `web_clips` 表 | 收藏 ≠ 笔记，职责不同，避免污染现有数据 |
| AI 处理时机 | 入库后异步 | 不阻塞收藏动作，保证"一键"的速度感 |
| 插件构建工具 | Vite | 与桌面端保持一致，团队熟悉 |

---

## 里程碑与优先级

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
桌面端适配    插件 MVP     AI 自动整理   检索增强     功能打通
(1-2周)      (2-3周)      (1-2周)      (1-2周)      (1周)
  │            │            │            │            │
  │            │            │            │            │
  ▼            ▼            ▼            ▼            ▼
 能接收数据    能一键收藏    零手动整理    找得到东西    形成闭环
```

**最小可用产品（MVP）= Phase 0 + Phase 1**
完成后即可自己日常使用，验证产品假设。

---

## 文件变更清单（预计）

### 新增文件

```
apps/browser-extension/           # 整个插件项目（新增）
  manifest.json
  src/popup/Popup.tsx
  src/content/extractor.ts
  src/background/index.ts
  src/utils/api.ts
  src/utils/readability.ts
  package.json
  vite.config.ts
  tsconfig.json

apps/desktop/src-tauri/src/
  clips.rs                        # 收藏库后端逻辑（新增）
  clip_server.rs                  # 本地 HTTP 服务（新增）

apps/desktop/src/pages/
  ClipsPage.tsx                   # 收藏库页面（新增）

apps/desktop/src/components/Clips/
  ClipCard.tsx                    # 收藏卡片组件（新增）
  ClipDetail.tsx                  # 收藏详情（新增）
  ClipSearchBar.tsx               # 搜索栏（新增）
  TagFilter.tsx                   # 标签筛选（新增）
```

### 修改文件

```
apps/desktop/src-tauri/src/db.rs          # 新增 web_clips 表
apps/desktop/src-tauri/src/main.rs        # 注册新命令 + 启动 HTTP Server
apps/desktop/src-tauri/src/ai.rs          # RAG 上下文加入 clips
apps/desktop/src/router.tsx               # 新增 /clips 路由
apps/desktop/src/components/Layout/NavSidebar.tsx  # 新增"收藏库"导航项
pnpm-workspace.yaml                       # 确认 apps/* 已包含插件
```
