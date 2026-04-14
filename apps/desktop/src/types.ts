export type AIConfig = {
  provider?: string;
  api_base?: string;
  api_key?: string;
  model?: string;
};

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
};

export type Collection = {
  id: number;
  name: string;
  description: string;
  icon: string;
  color: string;
  filter_rule: string;
  clip_count: number;
  created_at: string;
  updated_at: string;
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
