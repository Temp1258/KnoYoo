import { useState, useEffect, useCallback } from "react";
import { Search, Star, Filter, Library, Copy, Check, Sparkles, Globe, Calendar, RefreshCw, Lightbulb, ChevronDown, ChevronUp } from "lucide-react";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { WebClip } from "../types";
import ClipCard from "../components/Clips/ClipCard";
import ClipDetail from "../components/Clips/ClipDetail";
import Button from "../components/ui/Button";

type TimeRange = "all" | "week" | "month" | "quarter";

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "week", label: "最近一周" },
  { value: "month", label: "最近一月" },
  { value: "quarter", label: "最近三月" },
];

function getDateFrom(range: TimeRange): string | undefined {
  if (range === "all") return undefined;
  const d = new Date();
  if (range === "week") d.setDate(d.getDate() - 7);
  else if (range === "month") d.setMonth(d.getMonth() - 1);
  else if (range === "quarter") d.setMonth(d.getMonth() - 3);
  return d.toISOString();
}

export default function ClipsPage() {
  const [clips, setClips] = useState<WebClip[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [allDomains, setAllDomains] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [selectedClip, setSelectedClip] = useState<WebClip | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [serverToken, setServerToken] = useState("");

  // AI fuzzy search
  const [fuzzyMode, setFuzzyMode] = useState(false);
  const [fuzzyQuery, setFuzzyQuery] = useState("");
  const [fuzzyLoading, setFuzzyLoading] = useState(false);
  const [fuzzyResults, setFuzzyResults] = useState<WebClip[] | null>(null);

  // Smart info feed
  const [forgottenClips, setForgottenClips] = useState<WebClip[]>([]);
  const [weeklySummary, setWeeklySummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Batch retag
  const [retagging, setRetagging] = useState(false);

  const loadClips = useCallback(async () => {
    try {
      if (query.trim()) {
        const results = await tauriInvoke<WebClip[]>("search_web_clips", { q: query });
        setClips(results);
      } else {
        const dateFrom = getDateFrom(timeRange);
        const results = await tauriInvoke<WebClip[]>("list_web_clips_advanced", {
          page,
          pageSize: 20,
          tag: selectedTag,
          starred: starredOnly || undefined,
          domain: selectedDomain,
          dateFrom,
        });
        setClips(results);
      }
      const count = await tauriInvoke<number>("count_web_clips");
      setTotal(count);
    } catch (e) {
      console.error("Failed to load clips:", e);
    }
  }, [query, page, selectedTag, selectedDomain, timeRange, starredOnly]);

  const loadMeta = useCallback(async () => {
    try {
      const [tags, domains] = await Promise.all([
        tauriInvoke<string[]>("list_clip_tags"),
        tauriInvoke<string[]>("list_clip_domains"),
      ]);
      setAllTags(tags);
      setAllDomains(domains);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadForgotten = useCallback(async () => {
    try {
      const forgotten = await tauriInvoke<WebClip[]>("forgotten_clips", { limit: 3 });
      setForgottenClips(forgotten);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadClips();
    loadMeta();
    loadForgotten();
  }, [loadClips, loadMeta, loadForgotten]);

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
    loadMeta();
  };

  const handleRetag = async (id: number) => {
    try {
      await tauriInvoke("ai_auto_tag_clip", { id });
      loadClips();
      loadMeta();
    } catch (e) {
      console.error("Retag failed:", e);
    }
  };

  const handleBatchRetag = async () => {
    setRetagging(true);
    try {
      const count = await tauriInvoke<number>("ai_batch_retag_clips");
      if (count > 0) {
        loadClips();
        loadMeta();
      }
    } catch (e) {
      console.error(e);
    }
    setRetagging(false);
  };

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(serverToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  const handleFuzzySearch = async () => {
    if (!fuzzyQuery.trim()) return;
    setFuzzyLoading(true);
    try {
      const results = await tauriInvoke<WebClip[]>("ai_fuzzy_search_clips", { description: fuzzyQuery });
      setFuzzyResults(results);
    } catch (e) {
      console.error(e);
    }
    setFuzzyLoading(false);
  };

  const handleLoadSummary = async () => {
    setSummaryLoading(true);
    try {
      const summary = await tauriInvoke<string>("ai_weekly_clip_summary");
      setWeeklySummary(summary);
    } catch (e) {
      console.error(e);
    }
    setSummaryLoading(false);
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

  // Determine which clips to show
  const displayClips = fuzzyResults ?? clips;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-bold tracking-tight m-0">收藏库</h1>
          <span className="text-[13px] text-text-tertiary">{total} 条收藏</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleBatchRetag} disabled={retagging}>
            <RefreshCw size={14} className={retagging ? "animate-spin" : ""} />
            {retagging ? "标签中..." : "批量标签"}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopyToken} title="复制插件连接 Token">
            {tokenCopied ? <Check size={14} /> : <Copy size={14} />}
            {tokenCopied ? "已复制" : "插件 Token"}
          </Button>
        </div>
      </div>

      {/* Weekly summary card */}
      {weeklySummary ? (
        <div className="p-4 rounded-xl bg-accent/5 border border-accent/10 mb-4">
          <div className="text-[11px] font-medium text-accent mb-1">本周收藏摘要</div>
          <p className="text-[13px] text-text leading-relaxed m-0">{weeklySummary}</p>
        </div>
      ) : (
        <button
          onClick={handleLoadSummary}
          disabled={summaryLoading}
          className="w-full p-3 rounded-xl bg-bg-secondary border border-border hover:border-accent/20 text-[12px] text-text-secondary mb-4 flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <Sparkles size={14} className={summaryLoading ? "animate-pulse" : ""} />
          {summaryLoading ? "生成本周摘要中..." : "生成本周收藏摘要"}
        </button>
      )}

      {/* "You may have forgotten" section */}
      {forgottenClips.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb size={14} className="text-yellow-500" />
            <span className="text-[12px] font-medium text-text-secondary">你可能忘了这些收藏</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {forgottenClips.map((clip) => (
              <button
                key={clip.id}
                onClick={() => setSelectedClip(clip)}
                className="text-left p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/10 hover:border-yellow-500/20 transition-colors cursor-pointer"
              >
                <div className="text-[12px] font-medium text-text line-clamp-1">{clip.title}</div>
                <div className="text-[11px] text-text-tertiary line-clamp-1 mt-0.5">{clip.summary}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search bar with mode toggle */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          {fuzzyMode ? (
            <input
              type="text"
              placeholder="描述你记得的内容... 例如「之前看过一个Rust生命周期的文章」"
              value={fuzzyQuery}
              onChange={(e) => setFuzzyQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleFuzzySearch(); }}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-accent/5 border border-accent/20 text-[13px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent/40 transition-colors"
            />
          ) : (
            <input
              type="text"
              placeholder="搜索收藏内容..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); setFuzzyResults(null); }}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-bg-secondary border border-border text-[13px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent/40 transition-colors"
            />
          )}
        </div>
        <button
          onClick={() => {
            setFuzzyMode(!fuzzyMode);
            setFuzzyResults(null);
            setFuzzyQuery("");
          }}
          className={`px-3 py-2 rounded-xl text-[12px] transition-colors cursor-pointer border flex items-center gap-1.5 shrink-0 ${
            fuzzyMode
              ? "bg-accent/10 text-accent border-accent/20"
              : "bg-bg-secondary text-text-secondary border-border hover:border-accent/20"
          }`}
          title="AI 模糊搜索：用自然语言描述你记得的内容"
        >
          <Sparkles size={13} />
          AI 搜索
        </button>
        {fuzzyMode && (
          <Button variant="ghost" size="sm" onClick={handleFuzzySearch} disabled={fuzzyLoading}>
            {fuzzyLoading ? "搜索中..." : "搜索"}
          </Button>
        )}
      </div>

      {/* Expandable filters */}
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="flex items-center gap-1 text-[12px] text-text-tertiary mb-2 cursor-pointer hover:text-text-secondary transition-colors"
      >
        <Filter size={12} />
        筛选条件
        {showFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {(selectedTag || selectedDomain || timeRange !== "all" || starredOnly) && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
        )}
      </button>

      {showFilters && (
        <div className="flex flex-col gap-3 mb-4 p-3 rounded-xl bg-bg-secondary border border-border">
          {/* Star + Time range */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { setStarredOnly(!starredOnly); setPage(1); setFuzzyResults(null); }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] transition-colors cursor-pointer border ${
                starredOnly
                  ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
                  : "bg-bg text-text-secondary border-border hover:border-accent/20"
              }`}
            >
              <Star size={12} fill={starredOnly ? "currentColor" : "none"} />
              星标
            </button>
            <div className="w-px h-4 bg-border mx-1" />
            <Calendar size={12} className="text-text-tertiary" />
            {TIME_RANGES.map((tr) => (
              <button
                key={tr.value}
                onClick={() => { setTimeRange(tr.value); setPage(1); setFuzzyResults(null); }}
                className={`px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer border ${
                  timeRange === tr.value
                    ? "bg-accent/10 text-accent border-accent/20"
                    : "bg-bg text-text-secondary border-border hover:border-accent/20"
                }`}
              >
                {tr.label}
              </button>
            ))}
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-text-tertiary shrink-0">标签:</span>
              {allTags.slice(0, 15).map((tag) => (
                <button
                  key={tag}
                  onClick={() => { setSelectedTag(selectedTag === tag ? null : tag); setPage(1); setFuzzyResults(null); }}
                  className={`px-2 py-0.5 rounded-md text-[11px] transition-colors cursor-pointer border ${
                    selectedTag === tag
                      ? "bg-accent/10 text-accent border-accent/20"
                      : "bg-bg text-text-secondary border-border hover:border-accent/20"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {/* Domains */}
          {allDomains.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Globe size={12} className="text-text-tertiary shrink-0" />
              {allDomains.slice(0, 10).map((d) => (
                <button
                  key={d}
                  onClick={() => { setSelectedDomain(selectedDomain === d ? null : d); setPage(1); setFuzzyResults(null); }}
                  className={`px-2 py-0.5 rounded-md text-[11px] transition-colors cursor-pointer border ${
                    selectedDomain === d
                      ? "bg-accent/10 text-accent border-accent/20"
                      : "bg-bg text-text-secondary border-border hover:border-accent/20"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fuzzy search results label */}
      {fuzzyResults && (
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={13} className="text-accent" />
          <span className="text-[12px] text-accent">AI 搜索结果 ({fuzzyResults.length} 条匹配)</span>
          <button
            onClick={() => { setFuzzyResults(null); setFuzzyMode(false); }}
            className="text-[11px] text-text-tertiary hover:text-text cursor-pointer ml-auto"
          >
            清除
          </button>
        </div>
      )}

      {/* Empty state */}
      {displayClips.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
          <Library size={48} strokeWidth={1} className="mb-4 opacity-40" />
          {fuzzyResults !== null ? (
            <>
              <p className="text-[14px] mb-1">没有找到匹配的收藏</p>
              <p className="text-[12px]">试试换个描述方式</p>
            </>
          ) : (
            <>
              <p className="text-[14px] mb-1">收藏库是空的</p>
              <p className="text-[12px]">安装浏览器插件，一键收藏有价值的网页内容</p>
            </>
          )}
        </div>
      )}

      {/* Clip grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {displayClips.map((clip) => (
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

      {/* Pagination (only for non-fuzzy mode) */}
      {!fuzzyResults && total > 20 && (
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
            disabled={displayClips.length < 20}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
