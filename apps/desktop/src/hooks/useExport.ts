import { save, open } from "@tauri-apps/plugin-dialog";
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

  const exportCollection = async (collectionId: number, name: string) => {
    const dir = await open({ directory: true, title: `导出集合: ${name}` });
    if (!dir) return;
    const count = await tauriInvoke<number>("export_collection_to_dir", {
      collectionId,
      dirPath: dir,
    });
    return count;
  };

  return { exportClip, exportCollection };
}
