import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faPlus,
  faChevronLeft,
  faChevronRight,
} from "@fortawesome/free-solid-svg-icons";
import NoteListItem from "../Note/NoteListItem";
import NoteForm from "../Note/NoteForm";
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

export default function Sidebar({
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
  const [isCollapsed, setCollapsed] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);

  const handleExport = async () => {
    try {
      const res = await onExport();
      showToast(`已导出 ${res.count} 条到：${res.path}`);
    } catch (e: any) {
      showToast("导出失败: " + e, "error");
    }
  };

  const handleImport = async () => {
    try {
      const [inserted, ignored] = await onImport();
      showToast(`已导入：${inserted} 条；忽略：${ignored} 条`);
    } catch (e: any) {
      showToast("导入失败: " + e, "error");
    }
  };

  if (isCollapsed) {
    return (
      <aside className="sidebar collapsed">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
          <button className="expand-btn" onClick={() => setCollapsed(false)} title="展开笔记栏">
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索笔记..."
        />
        <button className="btn" onClick={onSearch} title="搜索">
          <FontAwesomeIcon icon={faSearch} />
        </button>
        <button className="btn" onClick={() => setShowAddNote((v) => !v)} title="新增笔记">
          <FontAwesomeIcon icon={faPlus} />
        </button>
      </div>
      {showAddNote && <NoteForm onSaved={refresh} />}
      <div className="note-list">
        {list.map((n) => (
          <NoteListItem
            key={n.id}
            note={n}
            onChanged={refresh}
            onSelect={() => onSelectNote(n)}
            isActive={selectedNoteId === n.id}
          />
        ))}
      </div>
      <div className="sidebar-footer">
        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
          <button className="btn" onClick={handleExport} title="导出笔记">导出</button>
          <button className="btn" onClick={handleImport} title="导入笔记">导入</button>
        </div>
        <div className="pagination">
          <button className="btn" onClick={() => setPage((p: number) => Math.max(1, p - 1))} disabled={page <= 1}>
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
          <span>{page} / {totalPages}</span>
          <button className="btn" onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
        </div>
        <button className="collapse-btn" onClick={() => setCollapsed(true)} title="折叠笔记栏">
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
      </div>
    </aside>
  );
}
