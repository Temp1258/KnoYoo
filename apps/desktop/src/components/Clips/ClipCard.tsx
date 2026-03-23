import { Star, Trash2, ExternalLink, Tag, RefreshCw } from "lucide-react";
import type { WebClip } from "../../types";

type Props = {
  clip: WebClip;
  onStar: (id: number) => void;
  onDelete: (id: number) => void;
  onSelect: (clip: WebClip) => void;
  onRetag: (id: number) => void;
};

export default function ClipCard({ clip, onStar, onDelete, onSelect, onRetag }: Props) {
  const domain = (() => {
    try {
      return new URL(clip.url).hostname.replace("www.", "");
    } catch {
      return clip.url;
    }
  })();

  return (
    <div
      className="group rounded-xl border border-border bg-bg-secondary p-4 hover:border-accent/30 transition-all cursor-pointer"
      onClick={() => onSelect(clip)}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        {clip.favicon ? (
          <img src={clip.favicon} alt="" className="w-4 h-4 mt-1 rounded-sm shrink-0" />
        ) : (
          <div className="w-4 h-4 mt-1 rounded-sm bg-bg-tertiary shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-medium text-text leading-snug line-clamp-2 m-0">
            {clip.title || "无标题"}
          </h3>
          <span className="text-[11px] text-text-tertiary">{domain}</span>
        </div>
      </div>

      {/* Summary */}
      {clip.summary && (
        <p className="text-[12px] text-text-secondary leading-relaxed line-clamp-3 mb-3 m-0">
          {clip.summary}
        </p>
      )}

      {/* Tags */}
      {clip.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {clip.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-accent/8 text-accent text-[11px]"
            >
              <Tag size={10} />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-tertiary">
          {new Date(clip.created_at).toLocaleDateString("zh-CN")}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onRetag(clip.id); }}
            className="p-1 rounded-md text-text-tertiary hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
            title="重新生成标签"
          >
            <RefreshCw size={13} />
          </button>
          <a
            href={clip.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1 rounded-md text-text-tertiary hover:text-accent hover:bg-accent/10 transition-colors"
            title="打开原始链接"
          >
            <ExternalLink size={13} />
          </a>
          <button
            onClick={(e) => { e.stopPropagation(); onStar(clip.id); }}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              clip.is_starred
                ? "text-yellow-500"
                : "text-text-tertiary hover:text-yellow-500 hover:bg-yellow-500/10"
            }`}
            title={clip.is_starred ? "取消星标" : "星标"}
          >
            <Star size={13} fill={clip.is_starred ? "currentColor" : "none"} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(clip.id); }}
            className="p-1 rounded-md text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
            title="删除"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
