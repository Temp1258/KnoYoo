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
import HighlightText from "./HighlightText";

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
  isSelected?: boolean;
  searchQuery?: string;
  animateOut?: boolean;
};

export default function ClipCard({
  clip,
  onStar,
  onDelete,
  onSelect,
  onRetag,
  isSelected,
  searchQuery = "",
  animateOut,
}: Props) {
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
      className={`group relative rounded-xl border border-l-[3px] ${st.border} bg-bg-secondary dark:glass-card p-4 hover:border-accent/30 hover:shadow-md transition-all duration-200 cursor-pointer ${
        isSelected ? "border-accent/30 ring-2 ring-accent/20" : "border-border"
      } ${animateOut ? "animate-slide-out-right" : ""}`}
      onClick={() => onSelect(clip)}
    >
      {/* Unread indicator */}
      {!clip.is_read && (
        <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-accent" title="未读" />
      )}
      {/* Thumbnail: YouTube or OG image */}
      {ytId ? (
        <img
          src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`}
          alt=""
          className="w-full h-32 object-cover rounded-lg mb-2"
        />
      ) : (
        clip.og_image && (
          <img
            src={clip.og_image}
            alt=""
            className="w-full h-32 object-cover rounded-lg mb-2"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )
      )}

      {/* Header */}
      <div className="flex items-start gap-2.5 mb-1">
        <SourceIcon size={14} className={`${st.color} mt-0.5 shrink-0`} />
        {clip.favicon ? (
          <img src={clip.favicon} alt="" className="w-4 h-4 mt-0.5 rounded-sm shrink-0" />
        ) : (
          <div className="w-4 h-4 mt-0.5 rounded-sm bg-bg-tertiary shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold text-text leading-snug line-clamp-2 m-0">
            <HighlightText text={clip.title || "无标题"} query={searchQuery} />
          </h3>
        </div>
      </div>

      {/* Meta line */}
      <div className="text-[11px] text-text-tertiary mb-2 ml-[34px]">
        {domain} &middot; {new Date(clip.created_at).toLocaleDateString("zh-CN")}
      </div>

      {/* Summary */}
      {clip.summary && (
        <p className="text-[12px] text-text-secondary leading-relaxed line-clamp-3 mb-3 m-0">
          <HighlightText text={clip.summary} query={searchQuery} />
        </p>
      )}

      {/* Tags */}
      {clip.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {clip.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/8 text-accent text-[11px] font-medium"
            >
              <Tag size={10} />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer (actions only, date moved to meta line) */}
      <div className="flex items-center justify-end">
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
              setTimeout(() => setStarBounce(false), 400);
              onStar(clip.id);
            }}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              starBounce ? "animate-star-bounce" : ""
            } ${
              clip.is_starred
                ? "text-yellow-500"
                : "text-text-tertiary hover:text-yellow-500 hover:bg-yellow-500/10"
            }`}
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
