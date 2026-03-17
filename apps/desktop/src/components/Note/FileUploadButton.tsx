import { useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/Toast";
import type { Note } from "../../types";

interface Props {
  onGenerated: () => void;
}

export default function FileUploadButton({ onGenerated }: Props) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "文本文件", extensions: ["txt", "md", "markdown"] }],
      });
      if (!selected) return;

      setLoading(true);
      const notes = await tauriInvoke<Note[]>("ai_generate_notes_from_file", {
        filePath: selected,
      });
      showToast(`已从文件生成 ${notes.length} 条笔记`);
      onGenerated();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("文件生成笔记失败: " + message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleUpload}
      disabled={loading}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-text-secondary hover:bg-bg-tertiary hover:text-text disabled:opacity-50 transition-colors duration-200 cursor-pointer"
      title="上传文件生成笔记"
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
      AI生成
    </button>
  );
}
