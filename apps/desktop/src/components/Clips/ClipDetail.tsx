import { useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  Star,
  Tag,
  X,
  Pencil,
  RefreshCw,
  Check,
  Plus,
} from "lucide-react";
import type { WebClip } from "../../types";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Button from "../ui/Button";

type Props = {
  clip: WebClip;
  onBack: () => void;
  onStar: (id: number) => void;
  onUpdate?: (clip: WebClip) => void;
  compact?: boolean;
};

export default function ClipDetail({ clip, onBack, onStar, onUpdate, compact }: Props) {
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(clip.summary);
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState<string[]>(clip.tags);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);

  const domain = (() => {
    try {
      return new URL(clip.url).hostname.replace("www.", "");
    } catch {
      return clip.url;
    }
  })();

  const saveSummary = async () => {
    setSaving(true);
    try {
      const updated = await tauriInvoke<WebClip>("update_web_clip", {
        id: clip.id,
        summary: summaryDraft,
      });
      onUpdate?.(updated);
      setEditingSummary(false);
    } catch (e) {
      console.error("Save summary failed:", e);
    }
    setSaving(false);
  };

  const saveTags = async () => {
    setSaving(true);
    try {
      const updated = await tauriInvoke<WebClip>("update_web_clip", {
        id: clip.id,
        tags: tagsDraft,
      });
      onUpdate?.(updated);
      setEditingTags(false);
    } catch (e) {
      console.error("Save tags failed:", e);
    }
    setSaving(false);
  };

  const resetToAI = async () => {
    setSaving(true);
    try {
      await tauriInvoke("ai_auto_tag_clip", { id: clip.id });
      // Reload clip data
      const clips = await tauriInvoke<WebClip[]>("search_web_clips", {
        q: clip.title.slice(0, 20),
      });
      const updated = clips.find((c) => c.id === clip.id);
      if (updated) onUpdate?.(updated);
    } catch (e) {
      console.error("AI retag failed:", e);
    }
    setSaving(false);
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (tag && !tagsDraft.includes(tag)) {
      setTagsDraft([...tagsDraft, tag]);
      setNewTag("");
    }
  };

  return (
    <div>
      {/* Sticky back button bar */}
      <div className="sticky top-0 z-10 bg-bg/80 backdrop-blur-sm -mx-6 px-6 py-3 mb-2 border-b border-transparent [&:not(:first-child)]:border-border">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onBack}>
            {compact ? <X size={14} /> : <ArrowLeft size={14} />}
            {compact ? "关闭" : "返回列表"}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onStar(clip.id)}>
              <Star
                size={14}
                fill={clip.is_starred ? "currentColor" : "none"}
                className={clip.is_starred ? "text-yellow-500" : ""}
              />
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
      </div>

      {/* Title */}
      <h1 className="text-[22px] font-bold text-text mb-2">{clip.title || "无标题"}</h1>

      {/* Meta */}
      <div className="flex items-center gap-3 text-[12px] text-text-tertiary mb-4">
        <span>{domain}</span>
        <span>{new Date(clip.created_at).toLocaleDateString("zh-CN")}</span>
        <span className="px-1.5 py-0.5 rounded bg-bg-tertiary text-[11px]">{clip.source_type}</span>
      </div>

      {/* Tags (editable) */}
      <div className="mb-4">
        {editingTags ? (
          <div className="p-3 rounded-xl bg-bg-secondary border border-border">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tagsDraft.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/8 text-accent text-[12px]"
                >
                  {tag}
                  <button
                    onClick={() => setTagsDraft(tagsDraft.filter((t) => t !== tag))}
                    className="hover:text-danger cursor-pointer"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 items-center mb-2">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
                placeholder="输入新标签..."
                className="flex-1 h-7 px-2 text-[12px] bg-bg-tertiary border border-border rounded-md focus:outline-none focus:border-accent"
              />
              <button
                onClick={addTag}
                className="p-1 text-accent hover:bg-accent/10 rounded cursor-pointer"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={saveTags} disabled={saving}>
                <Check size={12} /> 保存
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setTagsDraft(clip.tags);
                  setEditingTags(false);
                }}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="group/tags flex flex-wrap gap-1.5 items-center">
            {clip.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/8 text-accent text-[12px]"
              >
                <Tag size={11} />
                {tag}
              </span>
            ))}
            <button
              onClick={() => {
                setTagsDraft(clip.tags);
                setEditingTags(true);
              }}
              className="p-1 rounded-md text-text-tertiary hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer opacity-0 group-hover/tags:opacity-100"
              title="编辑标签"
            >
              <Pencil size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Summary (editable) */}
      <div className="p-4 rounded-xl bg-accent/5 border border-accent/10 mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] font-medium text-accent">AI 摘要</div>
          <div className="flex items-center gap-1">
            {!editingSummary && (
              <>
                <button
                  onClick={() => {
                    setSummaryDraft(clip.summary);
                    setEditingSummary(true);
                  }}
                  className="p-1 rounded-md text-text-tertiary hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                  title="编辑摘要"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={resetToAI}
                  disabled={saving}
                  className="p-1 rounded-md text-text-tertiary hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                  title="重新 AI 生成"
                >
                  <RefreshCw size={11} className={saving ? "animate-spin" : ""} />
                </button>
              </>
            )}
          </div>
        </div>
        {editingSummary ? (
          <div>
            <textarea
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
              className="w-full h-24 px-3 py-2 text-[13px] bg-bg-secondary border border-border rounded-lg resize-y focus:outline-none focus:border-accent leading-relaxed"
            />
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="primary" onClick={saveSummary} disabled={saving}>
                <Check size={12} /> 保存
              </Button>
              <Button size="sm" onClick={() => setEditingSummary(false)}>
                取消
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-text leading-relaxed m-0">
            {clip.summary || "（暂无摘要，点击编辑或 AI 生成）"}
          </p>
        )}
      </div>

      {/* Content */}
      <div className="prose prose-sm max-w-none text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap">
        {clip.content || "（无正文内容）"}
      </div>
    </div>
  );
}
