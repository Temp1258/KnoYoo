/** Per-provider AI state surfaced by `get_ai_config`. Keys live in the OS
 *  keychain and never reach the frontend; `key_hint` is the last 4 chars,
 *  computed live on each read so backups never carry it. */
export type AiProviderState = {
  configured: boolean;
  api_base: string;
  model: string;
  /** Last 4 chars of the stored key. Empty when not configured. */
  key_hint: string;
};

/** Full shape returned by `get_ai_config`. Top-level `api_base` / `model`
 *  mirror the currently selected provider's stored values. */
export type AiFullConfig = {
  provider: string;
  api_base: string;
  model: string;
  providers: Record<string, AiProviderState>;
};

/** Partial update accepted by `set_ai_config`. `api_key` semantics:
 *  `undefined` don't touch, `""` delete, `"sk-…"` write to keychain. */
export type AiSetConfig = {
  provider?: string;
  api_base?: string;
  model?: string;
  api_key?: string;
};

/** @deprecated — use {@link AiFullConfig}. Kept as an alias for any
 *  external consumer; the shape is now keychain-aware. */
export type AIConfig = AiFullConfig;

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  error?: boolean;
};

export type AiChatResponse = {
  content: string;
  referenced_clip_ids: number[];
};

export type TranscriptionStatus =
  | ""
  | "pending"
  | "downloading"
  | "transcribing"
  | "cleaning"
  | "completed"
  | "failed";

export type WebClip = {
  id: number;
  url: string;
  title: string;
  /** Readable version of the page — first-pass extract at insert time,
   *  replaced by the AI-cleaned version once the background pipeline runs. */
  content: string;
  /** Full-body text dump, preserved for the "查看原始" toggle. Empty for
   *  clips imported before the 3-stage pipeline existed. */
  raw_content: string;
  summary: string;
  tags: string[];
  source_type: string;
  favicon: string;
  og_image: string;
  is_read: boolean;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Empty string for non-video clips. Video pipeline state machine. */
  transcription_status?: TranscriptionStatus;
  /** Human-readable error when `transcription_status === "failed"`. */
  transcription_error?: string;
  /** Provenance: `subtitle` / `asr:openai` / `asr:deepgram` / `asr:siliconflow`. */
  transcription_source?: string;
  /** Video duration in seconds; 0 for non-video clips. */
  audio_duration_sec?: number;
};

// ── Video transcription ────────────────────────────────────────────────────

export type AsrProvider = "openai" | "deepgram" | "siliconflow";

/** Mirrors `transcribe::Stage` in Rust. Keep in sync with snake_case serde. */
export type TranscribeStage =
  | "metadata"
  | "subtitle_probe"
  | "download"
  | "split"
  | "asr"
  | "clean"
  | "summarize";

export type TranscribeProgress = {
  clip_id: number;
  stage: TranscribeStage;
  /** 0-100 overall progress. NOT per-stage. */
  percent: number;
  detail?: string;
};

/** Per-provider state surfaced by `get_asr_config`. API keys live in the
 *  OS keychain; `key_hint` is the last 4 chars, recomputed on each read. */
export type AsrProviderState = {
  configured: boolean;
  api_base: string;
  model: string;
  /** Last 4 chars of the stored key. Empty when not configured. */
  key_hint: string;
};

/** Full config shape returned by `get_asr_config`. The top-level
 *  `asr_api_base` / `asr_model` mirror the currently selected provider's
 *  non-secret stored state so the edit form can bind directly. */
export type AsrFullConfig = {
  asr_provider: string;
  asr_language: string;
  asr_api_base: string;
  asr_model: string;
  providers: Record<string, AsrProviderState>;
};

/** Partial config accepted by `set_asr_config`. Any field omitted leaves
 *  the stored value untouched. `asr_api_key = ""` is an explicit delete
 *  (keychain entry removed); `asr_api_key = undefined` means "don't
 *  touch the stored key". */
export type AsrSetConfig = {
  asr_provider?: AsrProvider | string;
  asr_language?: string;
  asr_api_key?: string;
  asr_api_base?: string;
  asr_model?: string;
};

export type ClipNote = {
  id: number;
  clip_id: number;
  content: string;
  created_at: string;
  updated_at: string;
};

export type ChatSession = {
  id: number;
  title: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
};

/** Unified search scope. `all` searches every indexed content type;
 *  narrowed scopes map to the `parse_scope` switch on the Rust side.
 *  - `clips` — article-type web clips
 *  - `videos` — online videos (YouTube / Bilibili)
 *  - `books` — library entries
 *  - `media` — local audio + local video */
export type SearchScope = "all" | "clips" | "videos" | "books" | "media";

/** Result kinds returned by `unified_search`. Frontend uses this to pick
 *  which card component to render and which route to navigate to.
 *  `media` covers local audio + local video (the Media page). */
export type SearchHitKind = "clip" | "book" | "video" | "media";

/** Unified cross-content search result. Fields that don't apply to a given
 *  kind are returned as empty strings (never null) so React code can treat
 *  the list uniformly. `score` is already normalized to [0, 1]; higher is
 *  better. `id` references the primary key of the source table
 *  (web_clips.id / books.id). */
export type SearchHit = {
  kind: SearchHitKind;
  id: number;
  title: string;
  snippet: string;
  score: number;
  /** For clip/video: canonical URL. Empty for books. */
  url: string;
  /** For clip/video: favicon URL. Empty for books. */
  favicon: string;
  /** For books: relative cover path. Empty for clip/video. */
  cover_path: string;
  /** ISO timestamp (clips: created_at, books: added_at). */
  created_at: string;
};

/** Milestone kinds. Kept as a string union so Rust can add new kinds
 *  without breaking compilation — the default branch in formatMilestone()
 *  renders a safe fallback. */
export type MilestoneKind =
  | "clip_count"
  | "consecutive_days"
  | "tag_depth"
  | "books_read"
  | (string & {});

export type Milestone = {
  id: number;
  kind: MilestoneKind;
  value: number;
  /** Structured JSON payload. `tag_depth` carries `{"tag": "rust"}`;
   *  other kinds use `{}`. */
  meta_json: string;
  achieved_at: string;
  acknowledged: boolean;
};
