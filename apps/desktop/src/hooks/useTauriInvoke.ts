import { invoke } from "@tauri-apps/api/core";

/** Unified Tauri invoke wrapper. */
export async function tauriInvoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(cmd, args);
}
