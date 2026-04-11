import { ArrowLeft, ExternalLink, Star, Tag, X } from "lucide-react";
import type { WebClip } from "../../types";
import Button from "../ui/Button";

type Props = {
  clip: WebClip;
  onBack: () => void;
  onStar: (id: number) => void;
  compact?: boolean;
};

export default function ClipDetail({ clip, onBack, onStar, compact }: Props) {
  const domain = (() => {
    try {
      return new URL(clip.url).hostname.replace("www.", "");
    } catch {
      return clip.url;
    }
  })();

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
