import { useState } from "react";
import {
  Star,
  Trash2,
  ExternalLink,
  Tag,
  RefreshCw,
  FileText,
  Play,
  MessageCircle,
  Code,
  Camera,
  type LucideIcon,
} from "lucide-react";
import type { WebClip } from "../../types";

const SOURCE_CONFIG: Record<
  string,
  { icon: LucideIcon; color: string; border: string; label: string }
> = {
  article: { icon: FileText, color: "text-blue-500", border: "border-l-blue-500", label: "文章" },
  video: { icon: Play, color: "text-red-500", border: "border-l-red-500", label: "视频" },
  tweet: { icon: MessageCircle, color: "text-sky-400", border: "border-l-sky-400", label: "推文" },
  code: { icon: Code, color: "text-green-500", border: "border-l-green-500", label: "代码" },
  screenshot: {
    icon: Camera,
    color: "text-purple-500",
    border: "border-l-purple-500",
    label: "截图",
  },
  doc: { icon: FileText, color: "text-orange-500", border: "border-l-orange-500", label: "文档" },
};

function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|v=)([^&\s]+)/);
  return match?.[1] ?? null;
}

type Props = {
  clip: WebClip;
  onStar: (id: number) => void;
  onDelete: (id: number) => void;
  onSelect: (clip: WebClip) => void;
  onRetag: (id: number) => void;
};

export default function ClipCard({ clip, onStar, onDelete, onSelect, onRetag }: Props) {
  const [starBounce, setStarBounce] = useState(false);

  const domain = (() => {
    try {
      return new URL(clip.url).hostname.replace("www.", "");
    } catch {
      return clip.url;
    }
  })();

  const st = SOURCE_CONFIG[clip.source_type] || SOURCE_CONFIG.article;
  const SourceIcon = st.icon;
  const ytId = clip.source_type === "video" ? getYouTubeId(clip.url) : null;

  return (
    <div
      className={`group rounded-xl border border-border border-l-[3px] ${st.border} bg-bg-secondary p-4 hover:border-accent/30 transition-all cursor-pointer`}
      onClick={() => onSelect(clip)}
    >
      {/* YouTube thumbnail */}
      {ytId && (
        <img
          src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`}
          alt=""
          className="w-full h-32 object-cover rounded-lg mb-2"
        />
      )}

      {/* Header */}
      <div className="flex items-start gap-2.5 mb-2">
        <SourceIcon size={14} className={`${st.color} mt-0.5 shrink-0`} />
        {clip.favicon ? (
          <img src={clip.favicon} alt="" className="w-4 h-4 mt-0.5 rounded-sm shrink-0" />
        ) : (
          <div className="w-4 h-4 mt-0.5 rounded-sm bg-bg-tertiary shrink-0" />
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
            onClick={(e) => {
              e.stopPropagation();
              onRetag(clip.id);
            }}
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
            onClick={(e) => {
              e.stopPropagation();
              setStarBounce(true);
              setTimeout(() => setStarBounce(false), 150);
              onStar(clip.id);
            }}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              clip.is_starred
                ? "text-yellow-500"
                : "text-text-tertiary hover:text-yellow-500 hover:bg-yellow-500/10"
            }`}
            style={{
              transform: starBounce ? "scale(0.85)" : "scale(1)",
              transition: "transform 150ms ease",
            }}
            title={clip.is_starred ? "取消星标" : "星标"}
          >
            <Star size={13} fill={clip.is_starred ? "currentColor" : "none"} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(clip.id);
            }}
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
