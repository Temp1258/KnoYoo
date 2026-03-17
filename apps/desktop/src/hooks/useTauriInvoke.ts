import { invoke } from "@tauri-apps/api/core";

/**
 * Unified Tauri invoke wrapper.
 * Replaces both `invoke()` from App.tsx and `tauriInvoke()` from MindMapPage.tsx.
 */
export async function tauriInvoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(cmd, args);
}
