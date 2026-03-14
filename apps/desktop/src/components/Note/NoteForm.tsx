import { useState, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMicrophone, faStop } from "@fortawesome/free-solid-svg-icons";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/Toast";
import type { ClassifyHit } from "../../types";

interface Props {
  onSaved: () => void;
}

export default function NoteForm({ onSaved }: Props) {
  const { showToast, showConfirm } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [speechLang, setSpeechLang] = useState("zh-CN");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const [voiceTarget, setVoiceTarget] = useState<"title" | "content" | null>(null);

  async function onSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      if (editingId == null) {
        const id = await tauriInvoke<number>("add_note", { title, content });
        const hits = await tauriInvoke<ClassifyHit[]>("classify_and_update", { noteId: id });
        if (Array.isArray(hits) && hits.length > 0) {
          const msg = hits.map((h) => `${h.name} +${h.delta} → ${h.new_mastery}`).join("，");
          showToast(`已自动归类：${msg}`);
        } else {
          showToast("未命中任何技能", "info");
        }
      } else {
        await tauriInvoke("update_note", { id: editingId, title, content });
        setEditingId(null);
      }
      setTitle("");
      setContent("");
      onSaved();
      showToast("已保存");
    } catch (e) {
      console.error(e);
      showToast("保存失败: " + e, "error");
    } finally {
      setSaving(false);
    }
  }

  function startVoiceInput() {
    try {
      const SpeechRecognition: any =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        showToast("当前浏览器不支持语音识别", "error");
        return;
      }
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      transcriptRef.current = "";
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = speechLang;
      recognition.onstart = () => setListening(true);
      recognition.onend = () => setListening(false);
      recognition.onerror = (e: any) => {
        console.error(e);
        showToast("语音识别出现错误，请重试", "error");
        setListening(false);
      };
      recognition.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t: string = e.results[i][0].transcript || "";
          transcriptRef.current += t;
        }
      };
      recognition.start();
    } catch (err) {
      console.error(err);
      showToast("无法启动语音识别", "error");
    }
  }

  async function stopVoiceInput() {
    const rec: any = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch (_) {}
    }
    setListening(false);
    const finalText = transcriptRef.current.trim();
    if (finalText) {
      if (voiceTarget === "title") {
        setTitle(finalText);
      } else if (voiceTarget === "content") {
        setContent(finalText);
      } else {
        setContent(finalText);
        setTitle(finalText.substring(0, Math.min(20, finalText.length)));
        const ok = await showConfirm(`识别到文本：${finalText}\n是否立即保存为笔记？`);
        if (ok) {
          onSave();
        }
      }
    }
    transcriptRef.current = "";
    setVoiceTarget(null);
  }

  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={() => setVoiceTarget("title")}
        placeholder="标题"
      />
      <textarea
        className="textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onFocus={() => setVoiceTarget("content")}
        placeholder="正文内容..."
        rows={4}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          className="input"
          style={{ width: "auto" }}
          value={speechLang}
          onChange={(e) => setSpeechLang(e.target.value)}
        >
          <option value="zh-CN">中文</option>
          <option value="en-US">English</option>
        </select>
        <button className="btn" onClick={startVoiceInput} disabled={listening}>
          <FontAwesomeIcon icon={faMicrophone} style={{ marginRight: 4 }} />
          {listening ? "录音中..." : "录音"}
        </button>
        <button className="btn" onClick={stopVoiceInput} disabled={!listening}>
          <FontAwesomeIcon icon={faStop} style={{ marginRight: 4 }} />
          停止
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" onClick={onSave} disabled={saving}>
          {saving ? "保存中..." : editingId ? "更新" : "保存"}
        </button>
        {editingId && (
          <button className="btn" onClick={() => { setEditingId(null); setTitle(""); setContent(""); }}>
            取消
          </button>
        )}
      </div>
    </div>
  );
}
