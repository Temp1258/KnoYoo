import { useState, useEffect, useRef } from "react";
import { MoreHorizontal, Pencil, Trash2, Star } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/Toast";
import Input from "../ui/Input";
import Textarea from "../ui/Textarea";
import Button from "../ui/Button";
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
  const [favorite, setFavorite] = useState(note.is_favorite);
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

  const toggleFav = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const isFav = await tauriInvoke<boolean>("toggle_note_favorite", { id: note.id });
      setFavorite(isFav);
    } catch {
      /* ignore */
    }
  };

  const handleSelect = () => {
    if (!editing && !menuOpen) {
      onSelect?.();
    }
  };

  return (
    <div
      className={`px-3 py-2.5 cursor-pointer transition-colors duration-150 ${
        isActive
          ? "bg-accent-light border-l-2 border-l-accent"
          : "hover:bg-bg-tertiary border-l-2 border-l-transparent"
      }`}
      onClick={handleSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <button
              onClick={toggleFav}
              className="shrink-0 cursor-pointer"
              title={favorite ? "取消收藏" : "收藏"}
            >
              <Star
                size={12}
                className={favorite ? "fill-amber-400 text-amber-400" : "text-text-tertiary"}
              />
            </button>
            <span className="text-[13px] font-medium text-text truncate leading-snug">
              {note.title}
            </span>
          </div>
          <div className="text-[11px] text-text-tertiary mt-0.5">{note.created_at}</div>
        </div>

        {/* Menu trigger */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            className="p-1 rounded-md text-text-tertiary hover:text-text hover:bg-bg-tertiary transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <MoreHorizontal size={14} />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-20 bg-bg-secondary border border-border rounded-lg shadow-md py-1 min-w-[120px]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text hover:bg-bg-tertiary transition-colors cursor-pointer"
                onClick={() => {
                  setEditing(true);
                  setMenuOpen(false);
                }}
              >
                <Pencil size={12} /> 编辑
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-danger hover:bg-danger-light transition-colors cursor-pointer"
                onClick={() => {
                  del();
                  setMenuOpen(false);
                }}
              >
                <Trash2 size={12} /> 删除
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline editing */}
      {editing && (
        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
          <Textarea
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="内容..."
          />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={save}>
              保存
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
