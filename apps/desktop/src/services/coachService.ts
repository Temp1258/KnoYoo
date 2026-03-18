import { tauriInvoke } from "../hooks/useTauriInvoke";
import type {
  StreakInfo,
  OllamaStatus,
  LearningStats,
  MarkdownExport,
  ShareCardData,
  GalleryTemplate,
  IndustryNode,
} from "../types";

const CMD = {
  RECORD_ACTIVITY: "record_activity",
  GET_STREAK: "get_streak_info",
  DETECT_OLLAMA: "detect_ollama",
  AUTO_CONFIGURE_OLLAMA: "auto_configure_ollama",
  DAILY_TIP: "get_daily_tip",
  LEARNING_STATS: "get_learning_stats",
  EXPORT_TEMPLATE: "export_skill_template",
  IMPORT_TEMPLATE: "import_skill_template",
  EXPORT_MARKDOWN: "export_learning_markdown",
  SHARE_CARD: "get_share_card_data",
  GAP_ANALYSIS: "ai_skill_gap_analysis",
  LIST_GALLERY: "list_gallery_templates",
} as const;

export async function recordActivity(): Promise<void> {
  return tauriInvoke<void>(CMD.RECORD_ACTIVITY);
}

export async function getStreakInfo(): Promise<StreakInfo> {
  return tauriInvoke<StreakInfo>(CMD.GET_STREAK);
}

export async function detectOllama(): Promise<OllamaStatus> {
  return tauriInvoke<OllamaStatus>(CMD.DETECT_OLLAMA);
}

export async function autoConfigureOllama(model: string): Promise<void> {
  return tauriInvoke<void>(CMD.AUTO_CONFIGURE_OLLAMA, { model });
}

export async function getDailyTip(): Promise<string> {
  return tauriInvoke<string>(CMD.DAILY_TIP);
}

export async function getLearningStats(): Promise<LearningStats> {
  return tauriInvoke<LearningStats>(CMD.LEARNING_STATS);
}

export async function exportSkillTemplate(): Promise<string> {
  return tauriInvoke<string>(CMD.EXPORT_TEMPLATE);
}

export async function importSkillTemplate(jsonStr: string): Promise<IndustryNode[]> {
  return tauriInvoke<IndustryNode[]>(CMD.IMPORT_TEMPLATE, { jsonStr });
}

export async function exportLearningMarkdown(): Promise<MarkdownExport> {
  return tauriInvoke<MarkdownExport>(CMD.EXPORT_MARKDOWN);
}

export async function getShareCardData(): Promise<ShareCardData> {
  return tauriInvoke<ShareCardData>(CMD.SHARE_CARD);
}

export async function aiSkillGapAnalysis(): Promise<string> {
  return tauriInvoke<string>(CMD.GAP_ANALYSIS);
}

export async function listGalleryTemplates(): Promise<GalleryTemplate[]> {
  return tauriInvoke<GalleryTemplate[]>(CMD.LIST_GALLERY);
}
