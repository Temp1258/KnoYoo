// Unified type definitions for KnoYoo frontend

export type Note = {
  id: number;
  title: string;
  content: string;
  created_at: string;
};

export type Hit = {
  id: number;
  title: string;
  snippet: string;
};

export type IndustryNode = {
  id: number;
  name: string;
  required_level: number;
  importance: number;
  mastery?: number | null;
  children: IndustryNode[];
};

export type SkillNote = {
  id: number;
  title: string;
  created_at: string;
  snippet?: string | null;
};

export type PlanTask = {
  id: number;
  skill_id: number | null;
  title: string;
  minutes: number;
  due: string | null;
  status: "TODO" | "DONE";
  horizon: "WEEK" | "QTR";
};

export type AIConfig = {
  provider?: string;
  api_base?: string;
  api_key?: string;
  model?: string;
};

export type SkillGapRow = {
  name: string;
  required_level: number;
  mastery: number;
  gap: number;
};

export type WeekReport = {
  start: string;
  end: string;
  tasks_done: number;
  minutes_done: number;
  new_notes: number;
  avg_mastery: number;
  top_gaps: [string, number, number, number][];
};

export type DateCount = {
  date: string;
  count: number;
};

export type ClassifyHit = {
  skill_id: number;
  name: string;
  delta: number;
  new_mastery: number;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SavedTree = {
  id: number;
  name: string;
  created_at: string;
};

export type Point = {
  x: number;
  y: number;
};

export type AiTopicOut = {
  name: string;
  score: number;
};
