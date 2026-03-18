import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { AIConfig, ChatMessage, Note } from "../types";

const CMD = {
  GET_CONFIG: "get_ai_config",
  SET_CONFIG: "set_ai_config",
  SMOKETEST: "ai_smoketest",
  CHAT: "ai_chat",
  CHAT_CONTEXT: "ai_chat_with_context",
  GENERATE_NOTES: "ai_generate_notes_from_file",
} as const;

export async function getAIConfig(): Promise<AIConfig> {
  return tauriInvoke<AIConfig>(CMD.GET_CONFIG);
}

export async function setAIConfig(cfg: AIConfig): Promise<void> {
  return tauriInvoke<void>(CMD.SET_CONFIG, { cfg });
}

export async function aiSmoketest(): Promise<string> {
  return tauriInvoke<string>(CMD.SMOKETEST);
}

export async function aiChat(messages: ChatMessage[]): Promise<string> {
  return tauriInvoke<string>(CMD.CHAT, { messages });
}

export async function aiChatWithContext(
  messages: ChatMessage[],
  selectedNoteId?: number | null,
): Promise<string> {
  return tauriInvoke<string>(CMD.CHAT_CONTEXT, { messages, selectedNoteId });
}

export async function aiGenerateNotesFromFile(filePath: string): Promise<Note[]> {
  return tauriInvoke<Note[]>(CMD.GENERATE_NOTES, { filePath });
}
