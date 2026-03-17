import { useState, useEffect } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/Toast";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Textarea from "../ui/Textarea";
import type { Note } from "../../types";

interface Props {
  note: Note;
  onBack: () => void;
  onChanged: () => void;
}

export default function NoteDetail({ note, onBack, onChanged }: Props) {
  const { showToast, showConfirm } = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
    setEditing(false);
  }, [note.id]);

  const save = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await tauriInvoke("update_note", { id: note.id, title, content });
      setEditing(false);
      onChanged();
      showToast("笔记已保存");
    } catch (e) {
      console.error(e);
      showToast("保存失败：" + e, "error");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    const ok = await showConfirm("确认删除这条笔记？");
    if (!ok) return;
    try {
      await tauriInvoke("delete_note", { id: note.id });
      onChanged();
      onBack();
      showToast("笔记已删除");
    } catch (e) {
      console.error(e);
      showToast("删除失败：" + e, "error");
    }
  };

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={15} />
          返回
        </Button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题"
            className="text-[15px] font-semibold"
          />
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="正文内容..."
            rows={10}
          />
          <div className="flex gap-2">
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
            <Button onClick={() => setEditing(false)}>取消</Button>
          </div>
        </div>
      ) : (
        <>
          <h3 className="text-[17px] font-semibold text-text m-0 mb-2">{note.title}</h3>
          <div className="text-[13px] text-text-secondary whitespace-pre-wrap leading-relaxed">
            {note.content}
          </div>
        </>
      )}

      {/* Action bar */}
      {!editing && (
        <div className="flex gap-2 mt-5 pt-4 border-t border-border">
          <Button size="sm" onClick={() => setEditing(true)}>
            <Pencil size={13} /> 编辑
          </Button>
          <Button variant="danger" size="sm" onClick={del}>
            <Trash2 size={13} /> 删除
          </Button>
        </div>
      )}
    </Card>
  );
}
