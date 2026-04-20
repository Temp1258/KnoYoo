import { save } from "@tauri-apps/plugin-dialog";
import { tauriInvoke } from "./useTauriInvoke";

export function useExport() {
  const exportClip = async (clipId: number, title: string) => {
    const path = await save({
      defaultPath: `${title.slice(0, 60)}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    await tauriInvoke("export_clip_to_file", { id: clipId, path });
  };

  return { exportClip };
}
