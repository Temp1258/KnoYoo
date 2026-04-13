import { useState } from "react";
import { Upload, FileText, Loader2, Check, AlertTriangle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Button from "../ui/Button";

type BookmarkEntry = {
  url: string;
  title: string;
  folder: string;
};

type ImportResult = {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
};

export default function BookmarkImportDialog() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [entries, setEntries] = useState<BookmarkEntry[]>([]);
  const [fetchContent, setFetchContent] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleSelectFile = async () => {
    const path = await open({
      title: "选择书签 HTML 文件",
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });
    if (!path) return;
    setFilePath(path as string);
    setResult(null);
    const parsed = await tauriInvoke<BookmarkEntry[]>("parse_bookmark_file", { path });
    setEntries(parsed);
  };

  const handleImport = async () => {
    if (!filePath) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await tauriInvoke<ImportResult>("import_bookmarks", {
        path: filePath,
        fetchContent,
      });
      setResult(res);
    } catch (e) {
      console.error(e);
    }
    setImporting(false);
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-bg-secondary border border-border">
        <div className="text-[14px] font-medium text-text mb-1">浏览器书签导入</div>
        <div className="text-[12px] text-text-tertiary mb-3">
          从 Chrome、Firefox 或 Edge 导出的书签 HTML 文件导入收藏
        </div>

        <Button variant="primary" size="sm" onClick={handleSelectFile}>
          <Upload size={14} />
          选择书签文件
        </Button>

        {entries.length > 0 && (
          <div className="mt-3 p-3 rounded-lg bg-bg-tertiary">
            <div className="flex items-center gap-2 text-[13px] text-text">
              <FileText size={14} />
              解析到 {entries.length} 个书签
            </div>
            <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
              {entries.slice(0, 20).map((e, i) => (
                <div key={i} className="text-[11px] text-text-tertiary truncate">
                  {e.folder && <span className="text-text-secondary">[{e.folder}] </span>}
                  {e.title}
                </div>
              ))}
              {entries.length > 20 && (
                <div className="text-[11px] text-text-tertiary">
                  ...还有 {entries.length - 20} 个
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-3">
          <label className="flex items-center gap-2 text-[13px] text-text cursor-pointer">
            <input
              type="checkbox"
              checked={fetchContent}
              onChange={(e) => setFetchContent(e.target.checked)}
              className="rounded"
            />
            抓取网页全文内容
            <span className="text-[11px] text-text-tertiary">（较慢，每秒处理 1 个 URL）</span>
          </label>

          <Button variant="primary" onClick={handleImport} disabled={importing}>
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {importing ? "导入中..." : `导入 ${entries.length} 个书签`}
          </Button>
        </div>
      )}

      {result && (
        <div className="p-4 rounded-xl bg-success-light border border-success/20">
          <div className="flex items-center gap-2 text-[14px] font-medium text-success mb-2">
            <Check size={16} />
            导入完成
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="text-text-secondary">总计: {result.total}</div>
            <div className="text-success">导入: {result.imported}</div>
            <div className="text-text-tertiary">跳过（已存在）: {result.skipped}</div>
            {result.failed > 0 && (
              <div className="text-danger flex items-center gap-1">
                <AlertTriangle size={11} />
                失败: {result.failed}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
