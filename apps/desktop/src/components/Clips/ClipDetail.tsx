import { useState } from "react";
import { ArrowLeft, ExternalLink, Star, Tag, FileText, Check } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { WebClip } from "../../types";
import Button from "../ui/Button";

type Props = {
  clip: WebClip;
  onBack: () => void;
  onStar: (id: number) => void;
};

export default function ClipDetail({ clip, onBack, onStar }: Props) {
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [annotation, setAnnotation] = useState("");
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState(false);

  const domain = (() => {
    try {
      return new URL(clip.url).hostname.replace("www.", "");
    } catch {
      return clip.url;
    }
  })();

  const handleConvertToNote = async () => {
    setConverting(true);
    try {
      await tauriInvoke("clip_to_note", {
        id: clip.id,
        annotation: annotation.trim() || null,
      });
      setConverted(true);
      setShowNoteForm(false);
    } catch (e) {
      console.error("Convert failed:", e);
    }
    setConverting(false);
  };

  return (
    <div>
      {/* Back button + actions */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={14} />
          返回列表
        </Button>
        <div className="flex items-center gap-2">
          {converted ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-green-500 px-2 py-1">
              <Check size={14} />
              已转为笔记
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setShowNoteForm(!showNoteForm)}>
              <FileText size={14} />
              转为笔记
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onStar(clip.id)}>
            <Star size={14} fill={clip.is_starred ? "currentColor" : "none"} className={clip.is_starred ? "text-yellow-500" : ""} />
            {clip.is_starred ? "已星标" : "星标"}
          </Button>
          <a href={clip.url} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm">
              <ExternalLink size={14} />
              打开原文
            </Button>
          </a>
        </div>
      </div>

      {/* Convert to note form */}
      {showNoteForm && (
        <div className="p-4 rounded-xl bg-bg-secondary border border-border mb-4">
          <div className="text-[12px] font-medium text-text mb-2">添加你的理解和批注（可选）</div>
          <textarea
            value={annotation}
            onChange={(e) => setAnnotation(e.target.value)}
            placeholder="写下你对这篇内容的理解、要点、或个人笔记..."
            className="w-full h-24 p-3 rounded-lg bg-bg border border-border text-[13px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent/40 transition-colors resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-text-tertiary">笔记将包含：你的批注 + AI摘要 + 原文链接 + 内容节选</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowNoteForm(false)}>取消</Button>
              <Button size="sm" onClick={handleConvertToNote} disabled={converting}>
                {converting ? "转换中..." : "确认转为笔记"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Title */}
      <h1 className="text-[22px] font-bold text-text mb-2">{clip.title || "无标题"}</h1>

      {/* Meta */}
      <div className="flex items-center gap-3 text-[12px] text-text-tertiary mb-4">
        <span>{domain}</span>
        <span>{new Date(clip.created_at).toLocaleDateString("zh-CN")}</span>
        <span className="px-1.5 py-0.5 rounded bg-bg-tertiary text-[11px]">{clip.source_type}</span>
      </div>

      {/* Tags */}
      {clip.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {clip.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/8 text-accent text-[12px]"
            >
              <Tag size={11} />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Summary */}
      {clip.summary && (
        <div className="p-4 rounded-xl bg-accent/5 border border-accent/10 mb-6">
          <div className="text-[11px] font-medium text-accent mb-1">AI 摘要</div>
          <p className="text-[13px] text-text leading-relaxed m-0">{clip.summary}</p>
        </div>
      )}

      {/* Content */}
      <div className="prose prose-sm max-w-none text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap">
        {clip.content || "（无正文内容）"}
      </div>
    </div>
  );
}
