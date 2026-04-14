import { useState, useMemo } from "react";
import {
  Upload,
  FileText,
  Loader2,
  Check,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FolderOpen,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Button from "../ui/Button";

type BookmarkEntry = {
  url: string;
  title: string;
  folder: string;
};

type ItemResult = {
  url: string;
  title: string;
  status: "imported" | "skipped" | "failed";
  reason?: string;
};

type DetailedResult = {
  imported: ItemResult[];
  skipped: ItemResult[];
  failed: ItemResult[];
};

export default function BookmarkImportDialog() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [entries, setEntries] = useState<BookmarkEntry[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fetchContent, setFetchContent] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<DetailedResult | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [activeFolders, setActiveFolders] = useState<Set<string>>(new Set());

  // Extract unique folders from entries
  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.folder) set.add(e.folder);
    }
    return Array.from(set).sort();
  }, [entries]);

  // Filtered entries based on active folder filters
  const filteredIndices = useMemo(() => {
    if (activeFolders.size === 0) return entries.map((_, i) => i);
    return entries.map((e, i) => (activeFolders.has(e.folder) ? i : -1)).filter((i) => i !== -1);
  }, [entries, activeFolders]);

  const selectedCount = selected.size;
  const allFilteredSelected =
    filteredIndices.length > 0 && filteredIndices.every((i) => selected.has(i));

  const handleSelectFile = async () => {
    const path = await open({
      title: "选择书签 HTML 文件",
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });
    if (!path) return;
    setFilePath(path as string);
    setResult(null);
    setExpandedSection(null);
    const parsed = await tauriInvoke<BookmarkEntry[]>("parse_bookmark_file", { path });
    setEntries(parsed);
    // Default: all checked
    setSelected(new Set(parsed.map((_, i) => i)));
    setActiveFolders(new Set());
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      // Deselect all filtered entries
      setSelected((prev) => {
        const next = new Set(prev);
        for (const i of filteredIndices) next.delete(i);
        return next;
      });
    } else {
      // Select all filtered entries
      setSelected((prev) => {
        const next = new Set(prev);
        for (const i of filteredIndices) next.add(i);
        return next;
      });
    }
  };

  const toggleEntry = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleFolder = (folder: string) => {
    setActiveFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const handleImport = async () => {
    if (!filePath || selectedCount === 0) return;
    setImporting(true);
    setResult(null);
    setExpandedSection(null);

    const selectedEntries = entries.filter((_, i) => selected.has(i));
    const total = selectedEntries.length;
    setProgress({ current: 0, total });

    const imported: ItemResult[] = [];
    const skipped: ItemResult[] = [];
    const failed: ItemResult[] = [];

    for (let i = 0; i < selectedEntries.length; i++) {
      const entry = selectedEntries[i];
      setProgress({ current: i + 1, total });

      try {
        // Check if URL already exists
        const existing = await tauriInvoke<unknown | null>("check_clip_exists", {
          url: entry.url,
        });

        if (existing) {
          skipped.push({ url: entry.url, title: entry.title, status: "skipped", reason: "已存在" });
          continue;
        }

        // Import the clip
        await tauriInvoke("add_web_clip", {
          clip: {
            url: entry.url,
            title: entry.title,
            content: "",
            source_type: "article",
            favicon: null,
            og_image: null,
          },
        });
        imported.push({ url: entry.url, title: entry.title, status: "imported" });

        // Rate limit when fetching content
        if (fetchContent && i < selectedEntries.length - 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (e) {
        failed.push({
          url: entry.url,
          title: entry.title,
          status: "failed",
          reason: String(e),
        });
      }
    }

    setResult({ imported, skipped, failed });
    setImporting(false);
  };

  const toggleSection = (section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  return (
    <div className="space-y-4">
      {/* File selection */}
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

            {/* Folder filter chips */}
            {folders.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {folders.map((folder) => (
                  <button
                    key={folder}
                    onClick={() => toggleFolder(folder)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] transition-colors cursor-pointer ${
                      activeFolders.has(folder)
                        ? "bg-accent text-white"
                        : "bg-bg-secondary text-text-secondary border border-border hover:bg-border"
                    }`}
                  >
                    <FolderOpen size={10} />
                    {folder}
                  </button>
                ))}
                {activeFolders.size > 0 && (
                  <button
                    onClick={() => setActiveFolders(new Set())}
                    className="px-2 py-0.5 rounded-full text-[11px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}

            {/* Select all toggle */}
            <div className="mt-2 flex items-center justify-between">
              <label className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  className="rounded accent-accent"
                />
                {activeFolders.size > 0 ? "全选当前筛选" : "全选"} / 取消全选
              </label>
              <span className="text-[11px] text-text-tertiary">
                已选 {selectedCount} / {entries.length}
              </span>
            </div>

            {/* Bookmark list with checkboxes */}
            <div className="mt-2 max-h-48 overflow-y-auto space-y-0.5">
              {filteredIndices.map((idx) => {
                const e = entries[idx];
                return (
                  <label
                    key={idx}
                    className="flex items-start gap-2 py-1 px-1 rounded hover:bg-bg-secondary cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(idx)}
                      onChange={() => toggleEntry(idx)}
                      className="mt-0.5 rounded accent-accent shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-text truncate">{e.title || e.url}</div>
                      <div className="text-[10px] text-text-tertiary truncate">{e.url}</div>
                    </div>
                    {e.folder && (
                      <span className="text-[10px] text-text-tertiary shrink-0">{e.folder}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Import options */}
      {entries.length > 0 && !result && (
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

          <Button
            variant="primary"
            onClick={handleImport}
            disabled={importing || selectedCount === 0}
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {importing
              ? `导入中 ${progress.current}/${progress.total}...`
              : `导入 ${selectedCount} 个书签`}
          </Button>

          {importing && (
            <div className="w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Detailed result report */}
      {result && (
        <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2">
          <div className="flex items-center gap-2 text-[14px] font-medium text-text mb-1">
            <Check size={16} className="text-success" />
            导入完成
          </div>

          {/* Imported section */}
          <ResultSection
            label={`成功 ${result.imported.length} 条`}
            colorClass="text-success"
            bgClass="bg-success-light"
            items={result.imported}
            expanded={expandedSection === "imported"}
            onToggle={() => toggleSection("imported")}
          />

          {/* Skipped section */}
          {result.skipped.length > 0 && (
            <ResultSection
              label={`跳过 ${result.skipped.length} 条（已存在）`}
              colorClass="text-amber-500"
              bgClass="bg-amber-500/10"
              items={result.skipped}
              expanded={expandedSection === "skipped"}
              onToggle={() => toggleSection("skipped")}
            />
          )}

          {/* Failed section */}
          {result.failed.length > 0 && (
            <ResultSection
              label={`失败 ${result.failed.length} 条`}
              colorClass="text-danger"
              bgClass="bg-danger-light"
              items={result.failed}
              expanded={expandedSection === "failed"}
              onToggle={() => toggleSection("failed")}
              showReason
            />
          )}
        </div>
      )}
    </div>
  );
}

function ResultSection({
  label,
  colorClass,
  bgClass,
  items,
  expanded,
  onToggle,
  showReason = false,
}: {
  label: string;
  colorClass: string;
  bgClass: string;
  items: ItemResult[];
  expanded: boolean;
  onToggle: () => void;
  showReason?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className={`rounded-lg overflow-hidden ${bgClass}`}>
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium ${colorClass} cursor-pointer transition-colors hover:opacity-80`}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {label}
      </button>
      {expanded && (
        <div className="px-3 pb-2 max-h-40 overflow-y-auto space-y-1 animate-fade-in">
          {items.map((item, i) => (
            <div key={i} className="text-[11px] text-text-secondary py-0.5">
              <div className="truncate">{item.title || item.url}</div>
              <div className="truncate text-[10px] text-text-tertiary">{item.url}</div>
              {showReason && item.reason && (
                <div className="text-[10px] text-danger/80 flex items-center gap-1 mt-0.5">
                  <AlertTriangle size={9} />
                  {item.reason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
