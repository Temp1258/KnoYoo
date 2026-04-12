import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  Star,
  Library,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Loader2,
  Settings,
  X,
} from "lucide-react";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { WebClip } from "../types";
import ClipCard from "../components/Clips/ClipCard";
import ClipDetail from "../components/Clips/ClipDetail";
import Button from "../components/ui/Button";
import { SkeletonCard } from "../components/ui/Skeleton";
import { useToast } from "../components/common/Toast";
import { useMediaQuery } from "../hooks/useMediaQuery";
import Combobox from "../components/ui/Combobox";
import FilterChip from "../components/ui/FilterChip";
import SegmentedControl from "../components/ui/SegmentedControl";

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

  // AI fuzzy search (unified: triggered when FTS returns empty)
  const [fuzzyLoading, setFuzzyLoading] = useState(false);
  const [fuzzyResults, setFuzzyResults] = useState<WebClip[] | null>(null);

  // Smart info feed
  const [forgottenClips, setForgottenClips] = useState<WebClip[]>([]);
  const [weeklySummary, setWeeklySummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  // Loading & infinite scroll
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Batch retag
  const [retagging, setRetagging] = useState(false);

  // Refresh animation
  const [refreshing, setRefreshing] = useState(false);

  // Banner
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Pending AI processing count
  const [pendingCount, setPendingCount] = useState(0);
  const [aiConfigured, setAiConfigured] = useState(true);
  const pendingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Undo delete
  const { showToast } = useToast();
  const pendingDeletesRef = useRef<
    Map<number, { timer: ReturnType<typeof setTimeout>; clip: WebClip }>
  >(new Map());

  // Search debounce
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isStarred = starredOnly;

  const loadClips = useCallback(async () => {
    setLoading(true);
    setHasMore(true);
    try {
      if (query.trim()) {
        const results = await tauriInvoke<WebClip[]>("search_web_clips", { q: query });
        setClips(isStarred ? results.filter((c) => c.is_starred) : results);
        setHasMore(false); // search results are not paginated
      } else {
        const dateFrom = getDateFrom(timeRange);
        const results = await tauriInvoke<WebClip[]>("list_web_clips_advanced", {
          page,
          pageSize: 20,
          tag: selectedTag,
          starred: isStarred || undefined,
          domain: selectedDomain,
          dateFrom,
        });
        setClips(results);
        if (results.length < 20) setHasMore(false);
      }
      const count = await tauriInvoke<number>("count_web_clips");
      setTotal(count);
    } catch (e) {
      console.error("Failed to load clips:", e);
    } finally {
      setLoading(false);
    }
  }, [query, page, selectedTag, selectedDomain, timeRange, isStarred]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || query.trim()) return;
    setLoadingMore(true);
    try {
      const nextPage = Math.floor(clips.length / 20) + 1;
      const dateFrom = getDateFrom(timeRange);
      const results = await tauriInvoke<WebClip[]>("list_web_clips_advanced", {
        page: nextPage,
        pageSize: 20,
        tag: selectedTag,
        starred: isStarred || undefined,
        domain: selectedDomain,
        dateFrom,
      });
      if (results.length < 20) setHasMore(false);
      if (results.length > 0) {
        setClips((prev) => {
          const existingIds = new Set(prev.map((c) => c.id));
          const fresh = results.filter((c) => !existingIds.has(c.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
    } catch (e) {
      console.error(e);
    }
    setLoadingMore(false);
  }, [
    loadingMore,
    hasMore,
    query,
    clips.length,
    timeRange,
    selectedTag,
    isStarred,
    selectedDomain,
  ]);

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
      const forgotten = await tauriInvoke<WebClip[]>("forgotten_clips", { limit: 5 });
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

  // Check AI config on mount + when config changes
  const checkAiConfig = useCallback(() => {
    tauriInvoke<string>("ai_smoketest")
      .then((r) => setAiConfigured(r.startsWith("ok")))
      .catch(() => setAiConfigured(false));
  }, []);

  useEffect(() => {
    checkAiConfig();
    const handler = async () => {
      checkAiConfig();
      const pending = await tauriInvoke<number>("count_pending_clips").catch(() => 0);
      if (pending > 0) {
        setRetagging(true);
        await tauriInvoke("ai_batch_retag_clips").catch(console.error);
        setRetagging(false);
      }
      loadClips();
      loadMeta();
    };
    window.addEventListener("knoyoo-ai-config-changed", handler);
    return () => window.removeEventListener("knoyoo-ai-config-changed", handler);
  }, [checkAiConfig, loadClips, loadMeta]);

  useEffect(() => {
    const checkPending = () => {
      tauriInvoke<number>("count_pending_clips")
        .then((n) => {
          setPendingCount(n);
          if (n === 0 && pendingTimerRef.current) {
            clearInterval(pendingTimerRef.current);
            pendingTimerRef.current = null;
          }
        })
        .catch(console.error);
    };
    checkPending();
    pendingTimerRef.current = setInterval(checkPending, 3000);
    return () => {
      if (pendingTimerRef.current) clearInterval(pendingTimerRef.current);
    };
  }, [total]);

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // Flush pending deletes on unmount
  useEffect(() => {
    return () => {
      pendingDeletesRef.current.forEach(({ timer }, id) => {
        clearTimeout(timer);
        tauriInvoke("delete_web_clip", { id });
      });
      pendingDeletesRef.current.clear();
    };
  }, []);

  const handleStar = async (id: number) => {
    await tauriInvoke("toggle_star_clip", { id });
    loadClips();
    if (selectedClip?.id === id) {
      setSelectedClip((prev) => (prev ? { ...prev, is_starred: !prev.is_starred } : null));
    }
  };

  const handleDelete = (id: number) => {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    setClips((prev) => prev.filter((c) => c.id !== id));
    if (selectedClip?.id === id) setSelectedClip(null);
    const timer = setTimeout(() => {
      pendingDeletesRef.current.delete(id);
      tauriInvoke("delete_web_clip", { id }).then(() => loadMeta());
    }, 5000);
    pendingDeletesRef.current.set(id, { timer, clip });
    showToast("已删除", "info", {
      label: "撤销",
      onClick: () => {
        const pending = pendingDeletesRef.current.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingDeletesRef.current.delete(id);
          setClips((prev) => [pending.clip, ...prev]);
        }
      },
    });
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

  const handleAISearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setFuzzyLoading(true);
    try {
      const results = await tauriInvoke<WebClip[]>("ai_fuzzy_search_clips", {
        description: searchQuery,
      });
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
      setSummaryExpanded(true);
    } catch (e) {
      console.error(e);
    }
    setSummaryLoading(false);
  };

  const isWide = useMediaQuery("(min-width: 1024px)");

  // Narrow screen: full-page detail view
  if (selectedClip && !isWide) {
    return (
      <ClipDetail
        clip={selectedClip}
        onBack={() => setSelectedClip(null)}
        onStar={handleStar}
        onUpdate={(c) => {
          setSelectedClip(c);
          loadClips();
          loadMeta();
        }}
      />
    );
  }

  const displayClips = fuzzyResults ?? clips;
  const showBanner = !bannerDismissed && (pendingCount > 0 || (!aiConfigured && total > 0));
  const splitView = isWide && selectedClip;

  return (
    <div className={splitView ? "flex gap-0 -mx-6 -my-6 h-[calc(100vh)]" : ""}>
      {/* Detail panel (split view right side) */}
      {splitView && (
        <div className="w-3/5 order-2 overflow-y-auto px-6 py-6 border-l border-border">
          <ClipDetail
            clip={selectedClip}
            onBack={() => setSelectedClip(null)}
            onStar={handleStar}
            onUpdate={(c) => {
              setSelectedClip(c);
              loadClips();
              loadMeta();
            }}
            compact
          />
        </div>
      )}
      <div className={splitView ? "w-2/5 order-1 overflow-y-auto px-4 py-4" : ""}>
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h1 className="text-[28px] font-bold tracking-tight m-0">知识库</h1>
              <span className="text-[13px] text-text-tertiary">{total} 条收藏</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  setRefreshing(true);
                  await Promise.all([loadClips(), loadMeta(), loadForgotten()]);
                  setRefreshing(false);
                }}
                title="刷新"
                disabled={refreshing}
              >
                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                刷新
              </Button>
              <Button variant="ghost" size="sm" onClick={handleBatchRetag} disabled={retagging}>
                <RefreshCw size={14} className={retagging ? "animate-spin" : ""} />
                {retagging ? "标签中..." : "批量标签"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyToken}
                title="复制插件连接 Token"
              >
                {tokenCopied ? <Check size={14} /> : <Copy size={14} />}
                {tokenCopied ? "已复制" : "插件 Token"}
              </Button>
            </div>
          </div>

          {/* Merged banner (pending AI / AI not configured) */}
          {showBanner && (
            <div
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl mb-3 ${
                pendingCount > 0
                  ? "bg-blue-500/5 border border-blue-500/15"
                  : "bg-yellow-500/5 border border-yellow-500/15"
              }`}
            >
              {pendingCount > 0 ? (
                retagging ? (
                  <>
                    <Loader2 size={14} className="text-blue-500 animate-spin shrink-0" />
                    <span className="text-[12px] text-blue-600">
                      {pendingCount} 条内容正在 AI 解析中...
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} className="text-blue-500 shrink-0" />
                    <span className="text-[12px] text-blue-600">
                      {pendingCount} 条内容待 AI 解析
                    </span>
                    <button
                      onClick={handleBatchRetag}
                      className="text-[11px] text-blue-500 hover:text-blue-600 cursor-pointer font-medium ml-2"
                    >
                      开始解析
                    </button>
                  </>
                )
              ) : (
                <>
                  <Settings size={14} className="text-yellow-600 shrink-0" />
                  <span className="text-[12px] text-yellow-700">
                    AI 未配置 — 点击左侧 ⚙ 设置 API Key 后，收藏内容将自动生成摘要和标签
                  </span>
                </>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setBannerDismissed(true)}
                className="p-0.5 rounded text-text-tertiary hover:text-text transition-colors cursor-pointer shrink-0"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Sticky search bar */}
          <div className="sticky top-0 z-10 bg-bg/80 backdrop-blur-sm -mx-6 px-6 py-2">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
              />
              <input
                type="text"
                placeholder="搜索知识库..."
                value={query}
                onChange={(e) => {
                  const val = e.target.value;
                  setQuery(val);
                  setFuzzyResults(null);
                  setPage(1);
                  if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
                  if (val.trim()) {
                    searchTimeoutRef.current = setTimeout(() => loadClips(), 300);
                  } else {
                    loadClips();
                  }
                }}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-bg-secondary border border-border text-[13px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent/40 transition-colors"
              />
            </div>
          </div>

          {/* Weekly summary (collapsible, home only) */}
          {
            <div className="mt-3 mb-3">
              {weeklySummary ? (
                <div className="rounded-xl bg-accent/5 border border-accent/10">
                  <button
                    onClick={() => setSummaryExpanded(!summaryExpanded)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] font-medium text-accent cursor-pointer"
                  >
                    <Sparkles size={12} />
                    本周收藏摘要
                    {summaryExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {summaryExpanded && (
                    <p className="px-4 pb-3 text-[13px] text-text leading-relaxed m-0">
                      {weeklySummary}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={handleLoadSummary}
                  disabled={summaryLoading}
                  className="w-full p-2.5 rounded-xl bg-bg-secondary border border-border hover:border-accent/20 text-[12px] text-text-secondary flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Sparkles size={13} className={summaryLoading ? "animate-pulse" : ""} />
                  {summaryLoading ? "生成本周摘要中..." : "生成本周收藏摘要"}
                </button>
              )}
            </div>
          }

          {/* "You may have forgotten" — horizontal scroll */}
          {forgottenClips.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Lightbulb size={13} className="text-yellow-500" />
                <span className="text-[11px] font-medium text-text-secondary">
                  你可能忘了这些收藏
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {forgottenClips.map((clip) => (
                  <button
                    key={clip.id}
                    onClick={() => setSelectedClip(clip)}
                    className="shrink-0 w-[200px] text-left p-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/10 hover:border-yellow-500/20 transition-colors cursor-pointer"
                  >
                    <div className="text-[12px] font-medium text-text line-clamp-1">
                      {clip.title}
                    </div>
                    <div className="text-[11px] text-text-tertiary line-clamp-1 mt-0.5">
                      {clip.summary}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Compact filter bar */}
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {
              <button
                onClick={() => {
                  setStarredOnly(!starredOnly);
                  setPage(1);
                  setFuzzyResults(null);
                }}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer border ${
                  starredOnly
                    ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
                    : "bg-bg text-text-secondary border-border hover:border-accent/20"
                }`}
              >
                <Star size={11} fill={starredOnly ? "currentColor" : "none"} />
                星标
              </button>
            }
            <SegmentedControl
              options={TIME_RANGES}
              value={timeRange}
              onChange={(v) => {
                setTimeRange(v);
                setPage(1);
                setFuzzyResults(null);
              }}
            />
            {allTags.length > 0 && (
              <Combobox
                options={allTags}
                value={selectedTag}
                onChange={(v) => {
                  setSelectedTag(v);
                  setPage(1);
                  setFuzzyResults(null);
                }}
                placeholder="标签"
              />
            )}
            {allDomains.length > 0 && (
              <Combobox
                options={allDomains}
                value={selectedDomain}
                onChange={(v) => {
                  setSelectedDomain(v);
                  setPage(1);
                  setFuzzyResults(null);
                }}
                placeholder="域名"
              />
            )}
          </div>

          {/* Active filter chips */}
          {(selectedTag || selectedDomain || timeRange !== "all" || starredOnly) && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {starredOnly && <FilterChip label="星标" onDismiss={() => setStarredOnly(false)} />}
              {timeRange !== "all" && (
                <FilterChip
                  label={TIME_RANGES.find((t) => t.value === timeRange)!.label}
                  onDismiss={() => setTimeRange("all")}
                />
              )}
              {selectedTag && (
                <FilterChip label={`标签: ${selectedTag}`} onDismiss={() => setSelectedTag(null)} />
              )}
              {selectedDomain && (
                <FilterChip
                  label={`域名: ${selectedDomain}`}
                  onDismiss={() => setSelectedDomain(null)}
                />
              )}
            </div>
          )}

          {/* Fuzzy search results label */}
          {fuzzyResults && (
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={13} className="text-accent" />
              <span className="text-[12px] text-accent">
                AI 搜索结果 ({fuzzyResults.length} 条匹配)
              </span>
              <button
                onClick={() => setFuzzyResults(null)}
                className="text-[11px] text-text-tertiary hover:text-text cursor-pointer ml-auto"
              >
                清除
              </button>
            </div>
          )}

          {/* Skeleton loading */}
          {loading && clips.length === 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Array.from({ length: 6 }, (_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}

          {/* Empty state / AI search prompt */}
          {!loading && displayClips.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
              <Library size={48} strokeWidth={1} className="mb-4 opacity-40" />
              {fuzzyResults !== null ? (
                <>
                  <p className="text-[14px] mb-1">AI 搜索未找到匹配内容</p>
                  <p className="text-[12px]">试试换个描述方式</p>
                </>
              ) : query.trim() ? (
                <>
                  <p className="text-[14px] mb-1">没有找到精确匹配的结果</p>
                  <button
                    onClick={() => handleAISearch(query)}
                    disabled={fuzzyLoading}
                    className="text-[13px] text-accent hover:underline cursor-pointer mt-2 flex items-center gap-1.5"
                  >
                    <Sparkles size={13} />
                    {fuzzyLoading ? "AI 搜索中..." : "试试 AI 搜索？"}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[14px] mb-1">知识库是空的</p>
                  <p className="text-[12px]">安装浏览器插件，一键收藏有价值的网页内容</p>
                </>
              )}
            </div>
          )}

          {/* Clip grid */}
          {displayClips.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {displayClips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  onStar={handleStar}
                  onDelete={handleDelete}
                  onSelect={setSelectedClip}
                  onRetag={handleRetag}
                  isSelected={selectedClip?.id === clip.id}
                />
              ))}
            </div>
          )}

          {/* Infinite scroll sentinel */}
          {!fuzzyResults && hasMore && displayClips.length > 0 && (
            <div ref={sentinelRef} className="flex items-center justify-center py-4">
              {loadingMore && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
