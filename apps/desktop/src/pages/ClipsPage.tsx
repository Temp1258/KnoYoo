import { useState, useEffect, useCallback } from "react";
import { Search, Star, Filter, Library, Copy, Check } from "lucide-react";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { WebClip } from "../types";
import ClipCard from "../components/Clips/ClipCard";
import ClipDetail from "../components/Clips/ClipDetail";
import Button from "../components/ui/Button";

export default function ClipsPage() {
  const [clips, setClips] = useState<WebClip[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [selectedClip, setSelectedClip] = useState<WebClip | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [serverToken, setServerToken] = useState("");

  const loadClips = useCallback(async () => {
    try {
      if (query.trim()) {
        const results = await tauriInvoke<WebClip[]>("search_web_clips", { q: query });
        setClips(results);
      } else {
        const results = await tauriInvoke<WebClip[]>("list_web_clips", {
          page,
          pageSize: 20,
          tag: selectedTag,
          starred: starredOnly || undefined,
        });
        setClips(results);
      }
      const count = await tauriInvoke<number>("count_web_clips");
      setTotal(count);
    } catch (e) {
      console.error("Failed to load clips:", e);
    }
  }, [query, page, selectedTag, starredOnly]);

  const loadTags = useCallback(async () => {
    try {
      const tags = await tauriInvoke<string[]>("list_clip_tags");
      setAllTags(tags);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadClips();
    loadTags();
  }, [loadClips, loadTags]);

  // Load server token on mount
  useEffect(() => {
    tauriInvoke<string>("get_clip_server_token").then(setServerToken).catch(console.error);
  }, []);

  const handleStar = async (id: number) => {
    await tauriInvoke("toggle_star_clip", { id });
    loadClips();
    if (selectedClip?.id === id) {
      setSelectedClip((prev) => prev ? { ...prev, is_starred: !prev.is_starred } : null);
    }
  };

  const handleDelete = async (id: number) => {
    await tauriInvoke("delete_web_clip", { id });
    if (selectedClip?.id === id) setSelectedClip(null);
    loadClips();
    loadTags();
  };

  const handleRetag = async (id: number) => {
    try {
      await tauriInvoke("ai_auto_tag_clip", { id });
      loadClips();
      loadTags();
    } catch (e) {
      console.error("Retag failed:", e);
    }
  };

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(serverToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  // Detail view
  if (selectedClip) {
    return (
      <ClipDetail
        clip={selectedClip}
        onBack={() => setSelectedClip(null)}
        onStar={handleStar}
      />
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-bold tracking-tight m-0">收藏库</h1>
          <span className="text-[13px] text-text-tertiary">{total} 条收藏</span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleCopyToken} title="复制插件连接 Token">
          {tokenCopied ? <Check size={14} /> : <Copy size={14} />}
          {tokenCopied ? "已复制" : "插件 Token"}
        </Button>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          placeholder="搜索收藏内容..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-bg-secondary border border-border text-[13px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent/40 transition-colors"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => { setStarredOnly(!starredOnly); setPage(1); }}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] transition-colors cursor-pointer border ${
            starredOnly
              ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
              : "bg-bg-secondary text-text-secondary border-border hover:border-accent/20"
          }`}
        >
          <Star size={12} fill={starredOnly ? "currentColor" : "none"} />
          星标
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        {allTags.slice(0, 10).map((tag) => (
          <button
            key={tag}
            onClick={() => { setSelectedTag(selectedTag === tag ? null : tag); setPage(1); }}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer border ${
              selectedTag === tag
                ? "bg-accent/10 text-accent border-accent/20"
                : "bg-bg-secondary text-text-secondary border-border hover:border-accent/20"
            }`}
          >
            <Filter size={10} />
            {tag}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {clips.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
          <Library size={48} strokeWidth={1} className="mb-4 opacity-40" />
          <p className="text-[14px] mb-1">收藏库是空的</p>
          <p className="text-[12px]">安装浏览器插件，一键收藏有价值的网页内容</p>
        </div>
      )}

      {/* Clip grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {clips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            onStar={handleStar}
            onDelete={handleDelete}
            onSelect={setSelectedClip}
            onRetag={handleRetag}
          />
        ))}
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </Button>
          <span className="text-[12px] text-text-tertiary">第 {page} 页</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={clips.length < 20}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
