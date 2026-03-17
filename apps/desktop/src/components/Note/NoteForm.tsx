import { useState, useRef } from "react";
import { Mic, Square } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/Toast";
import Card from "../ui/Card";
import Input from "../ui/Input";
import Textarea from "../ui/Textarea";
import Button from "../ui/Button";
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
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef<string>("");
  const [voiceTarget, setVoiceTarget] = useState<"title" | "content" | null>(null);

  async function onSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      if (editingId == null) {
        await tauriInvoke<number>("add_note", { title, content });
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
      const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognitionCtor) {
        showToast("当前浏览器不支持语音识别", "error");
        return;
      }
      const recognition = new SpeechRecognitionCtor();
      recognitionRef.current = recognition;
      transcriptRef.current = "";
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = speechLang;
      recognition.onstart = () => setListening(true);
      recognition.onend = () => setListening(false);
      recognition.onerror = (e: Event) => {
        console.error(e);
        showToast("语音识别出现错误，请重试", "error");
        setListening(false);
      };
      recognition.onresult = (e: SpeechRecognitionEvent) => {
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
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch (_e) {
        // recognition.stop() may throw if already stopped
      }
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
    <Card padding="sm">
      <div className="space-y-2.5">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setVoiceTarget("title")}
          placeholder="标题"
        />
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onFocus={() => setVoiceTarget("content")}
          placeholder="正文内容..."
          rows={4}
        />

        {/* Voice controls */}
        <div className="flex items-center gap-2">
          <select
            className="h-7 px-2 text-[12px] bg-bg-secondary text-text border border-border rounded-md focus:outline-none focus:border-accent"
            value={speechLang}
            onChange={(e) => setSpeechLang(e.target.value)}
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
          <Button size="sm" onClick={startVoiceInput} disabled={listening}>
            <Mic size={13} />
            {listening ? "录音中..." : "录音"}
          </Button>
          <Button size="sm" onClick={stopVoiceInput} disabled={!listening}>
            <Square size={13} />
            停止
          </Button>
        </div>

        {/* Save */}
        <div className="flex gap-2">
          <Button variant="primary" onClick={onSave} disabled={saving}>
            {saving ? "保存中..." : editingId ? "更新" : "保存"}
          </Button>
          {editingId && (
            <Button
              onClick={() => {
                setEditingId(null);
                setTitle("");
                setContent("");
              }}
            >
              取消
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
