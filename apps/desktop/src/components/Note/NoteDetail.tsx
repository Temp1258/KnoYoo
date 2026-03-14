import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/Toast";
import type { Note, ClassifyHit } from "../../types";

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
  const [skillHits, setSkillHits] = useState<ClassifyHit[]>([]);

  // Load skill associations for this note
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

  const autoClassify = async () => {
    try {
      const hits = await tauriInvoke<ClassifyHit[]>("classify_note_embed", { noteId: note.id });
      if (hits && hits.length > 0) {
        setSkillHits(hits);
        const msg = hits.map((h) => `${h.name} +${h.delta} → ${h.new_mastery}`).join("，");
        showToast(`已归类：${msg}`);
      } else {
        showToast("未命中任何技能", "info");
      }
    } catch {
      try {
        const hits = await tauriInvoke<ClassifyHit[]>("classify_and_update", { noteId: note.id });
        if (hits && hits.length > 0) {
          setSkillHits(hits);
          const msg = hits.map((h) => `${h.name} +${h.delta} → ${h.new_mastery}`).join("，");
          showToast(`已归类：${msg}`);
        } else {
          showToast("未命中任何技能", "info");
        }
      } catch (e) {
        showToast("归类失败", "error");
      }
    }
    onChanged();
  };

  return (
    <div className="card" style={{ position: "relative" }}>
      <button className="btn" onClick={onBack} style={{ position: "absolute", top: 0, left: 0, margin: 8 }}>
        <FontAwesomeIcon icon={faArrowLeft} /> 返回
      </button>
      <div style={{ paddingTop: 32 }}>
        {editing ? (
          <>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="标题"
            />
            <textarea
              className="textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="正文内容..."
              rows={8}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? "保存中..." : "保存"}
              </button>
              <button className="btn" onClick={() => setEditing(false)}>取消</button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>{note.title}</h3>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{note.content}</div>
          </>
        )}
        {!editing && (
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn" onClick={() => setEditing(true)}>编辑</button>
            <button className="btn" onClick={autoClassify}>自动归类</button>
            <button className="btn" onClick={del}>删除</button>
          </div>
        )}
        {/* Skill association display */}
        {skillHits.length > 0 && (
          <div className="skill-hits-section">
            <h4>关联技能</h4>
            <div className="skill-hits-list">
              {skillHits.map((h) => (
                <span key={h.skill_id} className="skill-tag">
                  {h.name}
                  <span className="skill-delta">+{h.delta}</span>
                  <span className="skill-mastery">→ {h.new_mastery}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
