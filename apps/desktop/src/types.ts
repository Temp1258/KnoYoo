export type AIConfig = {
  provider?: string;
  api_base?: string;
  api_key?: string;
  model?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type WebClip = {
  id: number;
  url: string;
  title: string;
  content: string;
  summary: string;
  tags: string[];
  source_type: string;
  favicon: string;
  is_read: boolean;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
};
