// Unified type definitions for KnoYoo frontend

export type Note = {
  id: number;
  title: string;
  content: string;
  created_at: string;
  is_favorite: boolean;
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
  group_id: number | null;
  parent_id: number | null;
  sort_order: number;
  description: string | null;
};

export type PlanGroup = {
  id: number;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: string;
};

export type AIConfig = {
  provider?: string;
  api_base?: string;
  api_key?: string;
  model?: string;
};

export type WeekReport = {
  start: string;
  end: string;
  tasks_done: number;
  minutes_done: number;
  new_notes: number;
};

export type DateCount = {
  date: string;
  count: number;
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
