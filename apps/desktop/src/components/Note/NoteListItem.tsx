import { useState, useEffect, useRef } from "react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/Toast";
import type { Note } from "../../types";

interface Props {
  note: Note;
  onChanged: () => void;
  onSelect?: () => void;
  isActive?: boolean;
}

export default function NoteListItem({ note, onChanged, onSelect, isActive = false }: Props) {
  const { showToast, showConfirm } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const save = async () => {
    await tauriInvoke("update_note", { id: note.id, title, content });
    setEditing(false);
    onChanged();
    showToast("笔记已更新");
  };

  const del = async () => {
    const ok = await showConfirm("确认删除这条笔记？");
    if (!ok) return;
    await tauriInvoke("delete_note", { id: note.id });
    onChanged();
    showToast("笔记已删除");
  };

  const autoClassify = async () => {
    try {
      await tauriInvoke("classify_note_embed", { noteId: note.id });
      showToast("归类完成");
    } catch {
      try {
        await tauriInvoke("classify_and_update", { noteId: note.id });
        showToast("归类完成");
      } catch (e) {
        showToast("归类失败", "error");
      }
    }
    onChanged();
  };

  const handleSelect = () => {
    if (!editing && !menuOpen) {
      onSelect?.();
    }
  };

  return (
    <li className={"note-row" + (isActive ? " active" : "")} onClick={handleSelect} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="note-title" style={{ flex: 1, fontWeight: 600 }}>
          {note.title}
        </span>
        <button
          className="menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          title="更多"
        >
          &#x22EF;
        </button>
        {menuOpen && (
          <div ref={menuRef} className="menu" onClick={(e) => e.stopPropagation()}>
            {!editing && (
              <>
                <button onClick={() => setEditing(true)}>编辑</button>
                <button onClick={del}>删除</button>
                <button onClick={autoClassify}>自动归类</button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="note-date">{note.created_at}</div>
      {editing && (
        <div className="note-editor-inline" onClick={(e) => e.stopPropagation()}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" onClick={save}>保存</button>
            <button className="btn" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}
    </li>
  );
}
