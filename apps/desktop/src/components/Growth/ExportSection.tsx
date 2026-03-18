import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Card from "../ui/Card";
import Button from "../ui/Button";
import type { MarkdownExport } from "../../types";

export default function ExportSection() {
  const [loading, setLoading] = useState(false);

  const exportMarkdown = async () => {
    setLoading(true);
    try {
      const result = await tauriInvoke<MarkdownExport>("export_learning_markdown");
      const blob = new Blob([result.content], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[17px] font-semibold m-0">导出与分享</h3>
          <p className="text-[12px] text-text-tertiary m-0 mt-0.5">
            导出学习报告或生成分享卡片
          </p>
        </div>
        <Button size="sm" onClick={exportMarkdown} disabled={loading}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
          导出 Markdown 报告
        </Button>
      </div>
    </Card>
  );
}
