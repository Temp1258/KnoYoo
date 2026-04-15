# 视频 → 文字 实施计划

将 YouTube / Bilibili 视频导入为可检索的文字知识，核心策略：**字幕优先，ASR 兜底**。

---

## 目标与非目标

**做：**
- YouTube / Bilibili 视频导入时，自动产出"可读版"文字 + 摘要 + 标签
- 有字幕用字幕；没字幕走云端 ASR（OpenAI Whisper / Deepgram / SiliconFlow 任选）
- 7 段式进度事件，颗粒度精细到 ASR 逐片完成

**不做（本轮）：**
- 本地 whisper.cpp（体积和 UX 成本暂时不值）
- 直播流、加密付费内容
- 说话人分离（diarization）—— 先出文本，说话人后续迭代

---

## 用户路径

```
扩展 / 抽屉里点 "Import video to KnoYoo"
    │
    ▼
后端创建 web_clip，source_type=video，transcription_status=pending
    │
    ▼
异步任务拉起 pipeline，前端订阅进度事件
    │
    ▼
处理中：详情抽屉显示分阶段进度条 + 当前动作文案
    │
    ▼
完成：content (可读版) + summary + tags 就绪，和普通剪藏一致
```

**异常：** 任一阶段失败 → 写入 `transcription_status='failed'` + `transcription_error`，UI 展示原因 + 重试按钮（复用 Books 的 `ai_status` 模式）。

---

## 后端模块

### 新增

| 文件 | 职责 |
|---|---|
| `transcribe.rs` | 管道编排：下载 → 字幕/ASR 分流 → 清洗入库；发进度事件 |
| `ytdlp.rs` | yt-dlp sidecar 调用封装（信息查询、字幕拉取、音频下载、进度解析） |
| `asr_client.rs` | 三家 ASR 供应商的 OpenAI 兼容封装（`/v1/audio/transcriptions`） |
| `media.rs` | ffmpeg sidecar：音频转码、按时长分片（给 OpenAI 25MB 限制用） |

### 修改

| 文件 | 改动 |
|---|---|
| `db.rs` | `web_clips` 新增列：`transcription_status` / `transcription_error` / `transcription_source`（`subtitle` / `asr:openai` / `asr:deepgram` / `asr:siliconflow`）/ `audio_duration_sec` |
| `clips.rs` | 新命令 `import_video_clip(url)` + `retry_transcription(clip_id)` |
| `youtube.rs` / `bilibili.rs` | 改为仅返回元数据；字幕/音频下载统一走 `ytdlp.rs` |
| `main.rs` | 注册新命令，注册 sidecar 二进制 |
| `ai.rs` | 转录文本走现有清洗管道（raw → 可读版 Markdown），复用 prompt |

### Sidecar 打包（已落地）

- 声明于 `tauri.conf.json > bundle.externalBin`：`binaries/yt-dlp`、`binaries/ffmpeg`
- 权限走 `tauri-plugin-shell`，`capabilities/default.json` 限定 `sidecar: true`
- 二进制**不入 git**（单平台 ~110MB），由脚本按需拉取：
    - macOS：`scripts/fetch-sidecars.sh [target-triple]`（yt-dlp 官方 release + evermeet.cx ffmpeg 静态构建）
    - Windows：`scripts\fetch-sidecars.ps1 -Target ...`（yt-dlp.exe + gyan.dev ffmpeg essentials）
    - 两个脚本顶部 `YT_DLP_VERSION` 常量锁版本，升级需同步改
- CI `release.yml` 在 `tauri build` 前按平台运行对应脚本
- 开发者首次 clone 后执行一次 `pnpm tauri:dev` 前需先跑 fetch 脚本

---

## 数据模型

```sql
ALTER TABLE web_clips ADD COLUMN transcription_status TEXT NOT NULL DEFAULT '';
-- '' | pending | downloading | transcribing | cleaning | completed | failed
ALTER TABLE web_clips ADD COLUMN transcription_error  TEXT NOT NULL DEFAULT '';
ALTER TABLE web_clips ADD COLUMN transcription_source TEXT NOT NULL DEFAULT '';
-- subtitle | asr:openai | asr:deepgram | asr:siliconflow
ALTER TABLE web_clips ADD COLUMN audio_duration_sec   INTEGER NOT NULL DEFAULT 0;
```

`raw_content` 存转录原始文本（带时间戳标记），`content` 存 AI 清洗后的可读版 Markdown —— 和现有三阶段管道的语义一致。

---

## 进度事件契约

Tauri `emit` 事件名：`transcribe://progress`

```ts
type TranscribeProgress = {
  clip_id: number;
  stage:
    | "metadata"       // 0-5
    | "subtitle_probe" // 5-10
    | "download"       // 10-40  (字幕路径此阶段很短)
    | "split"          // 40-45  (仅长音频分片)
    | "asr"            // 45-80  (字幕路径跳过)
    | "clean"          // 80-95
    | "summarize";     // 95-100
  percent: number;     // 0-100 整体进度
  detail?: string;     // "切成 3 段" / "转录第 2/3 片" / yt-dlp 原始行等
};
```

**ASR 阶段颗粒度（重点）：**
- OpenAI：N 片串行上传，每完成一片 `percent = 45 + 35 * i/N`
- Deepgram：支持 pre-recorded webhook 回调不划算，走同步接口 + 分片同 OpenAI
- SiliconFlow：同 OpenAI 协议，同策略

**下载阶段颗粒度：**
- 解析 `yt-dlp --newline --progress-template '%(progress._percent_str)s'` 逐行输出，节流 200ms 推送一次

---

## ASR 供应商抽象

```rust
trait AsrProvider {
    fn max_file_bytes(&self) -> usize;        // OpenAI=25MB, Deepgram=2GB, SiliconFlow=按模型
    fn transcribe(&self, audio_path: &Path, lang: Option<&str>) -> Result<String>;
}
```

三家统一 OpenAI 兼容 multipart `/v1/audio/transcriptions`。配置走 `app_kv`，和现有 AI 供应商面板同一套机制。

**默认音频格式：** m4a 单声道 16kHz 64kbps ——三家都支持，体积最小，ASR 质量足够。

---

## 前端改动

### 新增

- `components/Clips/VideoImportDialog.tsx`：粘贴 URL → 预览元数据 → 选择 ASR 供应商 → 开始
- `components/Clips/TranscribeProgress.tsx`：7 段进度条 + 当前阶段文案 + 预计剩余时间
- `components/Settings/AsrSettingsPanel.tsx`：ASR 供应商 Key、默认供应商、默认语言

### 修改

- `ClipDetail.tsx`：处理中时显示 `<TranscribeProgress/>`；失败时显示错误 + 重试
- `SettingsPage.tsx`：加一个 "ASR 转录" tab
- 浏览器扩展 popup / 右键菜单：视频页面增加 "Import video to KnoYoo" 条目

---

## 成本与限制提示

在 UI 上明确告知用户（设置页 + 首次使用弹窗）：
- 有字幕的视频**完全免费**
- 走 ASR 需要云端 API，各家定价差异大（SiliconFlow 最便宜，Deepgram nova-2 次之，Whisper 最贵）
- 承诺：**转录结果只存本地**，不做任何遥测/上传

---

## 里程碑

1. **M1 — 后端管道跑通**：`transcribe.rs` + `ytdlp.rs` + `asr_client.rs`，单元测试覆盖三家 ASR mock；DB 迁移 + 进度事件
2. **M2 — UI 接入**：VideoImportDialog + TranscribeProgress + SettingsPanel
3. **M3 — 扩展接入**：扩展加视频页识别 + "Import video" 菜单
4. **M4 — 打磨**：失败重试、分片边界平滑、长视频 UX、文案

每个里程碑独立可发，M1 + M2 即可自用 dogfooding。
