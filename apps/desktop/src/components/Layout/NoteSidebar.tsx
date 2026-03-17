import { useState } from "react";
import {
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Download,
  Upload,
  Star,
} from "lucide-react";
import NoteListItem from "../Note/NoteListItem";
import NoteForm from "../Note/NoteForm";
import FileUploadButton from "../Note/FileUploadButton";
import { useToast } from "../common/Toast";
import type { Note } from "../../types";

interface Props {
  list: Note[];
  page: number;
  totalPages: number;
  setPage: (p: number | ((prev: number) => number)) => void;
  q: string;
  setQ: (q: string) => void;
  onSearch: () => void;
  refresh: () => void;
  onExport: () => Promise<{ path: string; count: number }>;
  onImport: () => Promise<[number, number]>;
  selectedNoteId: number | null;
  onSelectNote: (note: Note) => void;
}

export default function NoteSidebar({
  list,
  page,
  totalPages,
  setPage,
  q,
  setQ,
  onSearch,
  refresh,
  onExport,
  onImport,
  selectedNoteId,
  onSelectNote,
}: Props) {
  const { showToast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [showFavOnly, setShowFavOnly] = useState(false);
  const filteredList = showFavOnly ? list.filter((n) => n.is_favorite) : list;

  const handleExport = async () => {
    try {
      const res = await onExport();
      showToast(`已导出 ${res.count} 条到：${res.path}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("导出失败: " + message, "error");
    }
  };

  const handleImport = async () => {
    try {
      const [inserted, ignored] = await onImport();
      showToast(`已导入：${inserted} 条；忽略：${ignored} 条`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("导入失败: " + message, "error");
    }
  };

  if (collapsed) {
    return (
      <aside className="flex flex-col items-center justify-center w-10 shrink-0 border-r border-border bg-bg-secondary">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors duration-200 cursor-pointer"
          title="展开笔记栏"
        >
          <PanelLeftOpen size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col w-[280px] shrink-0 border-r border-border bg-bg-secondary">
      {/* Header: Search + Actions */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border">
        <div className="flex-1 relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
          />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="搜索笔记..."
            className="w-full h-8 pl-8 pr-3 rounded-md border border-border bg-bg-tertiary text-[13px] text-text placeholder:text-text-tertiary outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors duration-200"
          />
        </div>
        <button
          onClick={() => setShowFavOnly((v) => !v)}
          className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors duration-200 cursor-pointer ${
            showFavOnly
              ? "text-amber-400"
              : "text-text-secondary hover:bg-bg-tertiary hover:text-text"
          }`}
          title={showFavOnly ? "显示全部" : "仅收藏"}
        >
          <Star size={16} className={showFavOnly ? "fill-amber-400" : ""} />
        </button>
        <button
          onClick={() => setShowAddNote((v) => !v)}
          className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors duration-200 cursor-pointer ${
            showAddNote
              ? "bg-accent text-white"
              : "text-text-secondary hover:bg-bg-tertiary hover:text-text"
          }`}
          title="新增笔记"
        >
          <Plus size={16} />
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="flex items-center justify-center w-8 h-8 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors duration-200 cursor-pointer"
          title="折叠笔记栏"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* Add Note Form */}
      {showAddNote && (
        <div className="border-b border-border">
          <NoteForm onSaved={refresh} />
        </div>
      )}

      {/* Note List */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {filteredList.map((n) => (
          <NoteListItem
            key={n.id}
            note={n}
            onChanged={refresh}
            onSelect={() => onSelectNote(n)}
            isActive={selectedNoteId === n.id}
          />
        ))}
        {filteredList.length === 0 && (
          <div className="text-center text-text-tertiary text-[13px] py-8">
            {showFavOnly ? "暂无收藏笔记" : "暂无笔记"}
          </div>
        )}
      </div>

      {/* Footer: Pagination + Export/Import */}
      <div className="flex flex-col gap-2 px-3 py-3 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={handleExport}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors duration-200 cursor-pointer"
              title="导出笔记"
            >
              <Download size={12} />
              导出
            </button>
            <button
              onClick={handleImport}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors duration-200 cursor-pointer"
              title="导入笔记"
            >
              <Upload size={12} />
              导入
            </button>
            <FileUploadButton onGenerated={refresh} />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p: number) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-default transition-colors duration-200 cursor-pointer"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[12px] text-text-secondary min-w-[40px] text-center">
              {page}/{totalPages}
            </span>
            <button
              onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-default transition-colors duration-200 cursor-pointer"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
