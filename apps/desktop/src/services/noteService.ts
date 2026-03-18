import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { Note, Hit, DateCount } from "../types";

// === Tauri command names (centralized) ===
const CMD = {
  ADD: "add_note",
  SEARCH: "search_notes",
  LIST: "list_notes",
  UPDATE: "update_note",
  DELETE: "delete_note",
  EXPORT: "export_notes_jsonl",
  IMPORT: "import_notes_jsonl",
  COUNT: "count_notes",
  CONTRIBUTIONS: "list_note_contributions",
  TOGGLE_FAVORITE: "toggle_note_favorite",
  LIST_FAVORITES: "list_favorite_notes",
} as const;

export async function addNote(title: string, content: string): Promise<number> {
  return tauriInvoke<number>(CMD.ADD, { title, content });
}

export async function searchNotes(query: string): Promise<Hit[]> {
  return tauriInvoke<Hit[]>(CMD.SEARCH, { query });
}

export async function listNotes(page: number, pageSize: number): Promise<Note[]> {
  return tauriInvoke<Note[]>(CMD.LIST, { page, pageSize });
}

export async function updateNote(id: number, title: string, content: string): Promise<void> {
  return tauriInvoke<void>(CMD.UPDATE, { id, title, content });
}

export async function deleteNote(id: number): Promise<void> {
  return tauriInvoke<void>(CMD.DELETE, { id });
}

export async function exportNotes(): Promise<{ path: string; count: number }> {
  return tauriInvoke<{ path: string; count: number }>(CMD.EXPORT);
}

export async function importNotes(): Promise<[number, number]> {
  return tauriInvoke<[number, number]>(CMD.IMPORT);
}

export async function countNotes(): Promise<number> {
  return tauriInvoke<number>(CMD.COUNT);
}

export async function listNoteContributions(days: number): Promise<DateCount[]> {
  return tauriInvoke<DateCount[]>(CMD.CONTRIBUTIONS, { days });
}

export async function toggleNoteFavorite(id: number): Promise<boolean> {
  return tauriInvoke<boolean>(CMD.TOGGLE_FAVORITE, { id });
}

export async function listFavoriteNotes(): Promise<Note[]> {
  return tauriInvoke<Note[]>(CMD.LIST_FAVORITES);
}
