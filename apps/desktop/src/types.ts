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

// === Onboarding & Coach types ===

export type CareerTemplate = {
  id: string;
  name: string;
  description: string;
  skills: TemplateSkill[];
};

export type TemplateSkill = {
  name: string;
  importance: number;
  children: string[];
};

export type SkillProgress = {
  skill_id: number;
  skill_name: string;
  total_tasks: number;
  done_tasks: number;
  note_count: number;
  progress: number; // 0.0 ~ 1.0
};

// === Coach Enhancement types ===

export type StreakInfo = {
  current_streak: number;
  best_streak: number;
  total_active_days: number;
  active_today: boolean;
};

export type OllamaStatus = {
  running: boolean;
  models: string[];
};

export type SkillRadarItem = {
  name: string;
  progress: number;
  importance: number;
};

export type LearningStats = {
  radar: SkillRadarItem[];
  total_skills: number;
  active_skills: number;
  mastered_skills: number;
  avg_progress: number;
  monthly_minutes: number;
  total_notes: number;
  completion_pct: number;
};

export type ShareCardData = {
  career_goal: string;
  current_streak: number;
  best_streak: number;
  total_skills: number;
  mastered_skills: number;
  total_notes: number;
  total_tasks_done: number;
  total_minutes: number;
  avg_progress: number;
  top_skills: string[];
  date: string;
};

export type MarkdownExport = {
  content: string;
  filename: string;
};

export type GalleryTemplate = {
  id: string;
  name: string;
  description: string;
  skill_count: number;
  sub_skill_count: number;
  category: string;
};
