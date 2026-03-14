import { invoke } from "@tauri-apps/api/core";

/**
 * Unified Tauri invoke wrapper.
 * Replaces both `invoke()` from App.tsx and `tauriInvoke()` from MindMapPage.tsx.
 */
export async function tauriInvoke<T = any>(
  cmd: string,
  args?: Record<string, any>
): Promise<T> {
  return invoke<T>(cmd, args);
}
