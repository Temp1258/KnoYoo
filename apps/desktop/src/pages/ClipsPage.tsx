import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  Star,
  Library,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
  Loader2,
  Settings,
  X,
  BookOpen,
  SlidersHorizontal,
  MoreHorizontal,
} from "lucide-react";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { WebClip } from "../types";
import ClipCard from "../components/Clips/ClipCard";
import ClipDetail from "../components/Clips/ClipDetail";
import EmptyState from "../components/Clips/EmptyState";
import OnboardingFlow from "../components/Onboarding/OnboardingFlow";
import Button from "../components/ui/Button";
import { SkeletonCard } from "../components/ui/Skeleton";
import { useToast } from "../components/common/Toast";
import { useMediaQuery } from "../hooks/useMediaQuery";
import Combobox from "../components/ui/Combobox";
import FilterChip from "../components/ui/FilterChip";
import SegmentedControl from "../components/ui/SegmentedControl";
import { useSearchHistory } from "../hooks/useSearchHistory";

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
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [selectedClip, setSelectedClip] = useState<WebClip | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [serverToken, setServerToken] = useState("");

  // AI fuzzy search (unified: triggered when FTS returns empty)
  const [fuzzyLoading, setFuzzyLoading] = useState(false);
  const [fuzzyResults, setFuzzyResults] = useState<WebClip[] | null>(null);

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

  // Onboarding
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Pending AI processing count
  const [pendingCount, setPendingCount] = useState(0);
  const [aiConfigured, setAiConfigured] = useState(true);
  const pendingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Delete animation + undo
  const [slidingOutIds, setSlidingOutIds] = useState<Set<number>>(new Set());
  const animationTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const { showToast } = useToast();
  const pendingDeletesRef = useRef<
    Map<number, { timer: ReturnType<typeof setTimeout>; clip: WebClip }>
  >(new Map());

  // Search debounce
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search UX
  const [searchFocused, setSearchFocused] = useState(false);
  const [aiSearchMode, setAiSearchMode] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { history: searchHistory, addQuery: addSearchHistory } = useSearchHistory();

  // Use refs for filter values to avoid re-creating loadClips on every filter change
  const filtersRef = useRef({
    query,
    page,
    selectedTag,
    selectedDomain,
    timeRange,
    starredOnly,
    unreadOnly,
  });
  filtersRef.current = {
    query,
    page,
    selectedTag,
    selectedDomain,
    timeRange,
    starredOnly,
    unreadOnly,
  };

  // Stale request guard: only apply results from the latest request
  const requestIdRef = useRef(0);

  const loadClips = useCallback(async () => {
    const f = filtersRef.current;
    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setHasMore(true);
    try {
      let results: WebClip[];
      if (f.query.trim()) {
        results = await tauriInvoke<WebClip[]>("search_web_clips", {
          q: f.query,
          page: 1,
          pageSize: 20,
        });
        if (f.starredOnly) results = results.filter((c) => c.is_starred);
        // Auto-fallback to AI search when FTS returns empty
        if (results.length === 0 && !aiSearchMode) {
          if (currentRequestId !== requestIdRef.current) return;
          setFuzzyLoading(true);
          try {
            const aiResults = await tauriInvoke<WebClip[]>("ai_fuzzy_search_clips", {
              description: f.query,
            });
            if (currentRequestId !== requestIdRef.current) return;
            if (aiResults.length > 0) {
              setFuzzyResults(aiResults);
            }
          } catch {
            // AI search failed silently — show empty FTS results
          }
          setFuzzyLoading(false);
        }
      } else {
        const dateFrom = getDateFrom(f.timeRange);
        results = await tauriInvoke<WebClip[]>("list_web_clips_advanced", {
          page: f.page,
          pageSize: 20,
          tag: f.selectedTag,
          starred: f.starredOnly || undefined,
          unread: f.unreadOnly || undefined,
          domain: f.selectedDomain,
          dateFrom,
        });
      }
      // Discard stale response if a newer request was started
      if (currentRequestId !== requestIdRef.current) return;
      setClips(results);
      setHasMore(results.length >= 20);
      const count = await tauriInvoke<number>("count_web_clips");
      if (currentRequestId !== requestIdRef.current) return;
      setTotal(count);
    } catch (e) {
      if (currentRequestId !== requestIdRef.current) return;
      console.error("Failed to load clips:", e);
    } finally {
      if (currentRequestId === requestIdRef.current) setLoading(false);
    }
  }, []); // stable reference — reads filters from ref

  const clipsLengthRef = useRef(clips.length);
  clipsLengthRef.current = clips.length;

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const snapshotId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const f = filtersRef.current;
      const nextPage = Math.floor(clipsLengthRef.current / 20) + 1;
      let results: WebClip[];
      if (f.query.trim()) {
        results = await tauriInvoke<WebClip[]>("search_web_clips", {
          q: f.query,
          page: nextPage,
          pageSize: 20,
        });
      } else {
        const dateFrom = getDateFrom(f.timeRange);
        results = await tauriInvoke<WebClip[]>("list_web_clips_advanced", {
          page: nextPage,
          pageSize: 20,
          tag: f.selectedTag,
          starred: f.starredOnly || undefined,
          unread: f.unreadOnly || undefined,
          domain: f.selectedDomain,
          dateFrom,
        });
      }
      if (snapshotId !== requestIdRef.current) return;
      if (results.length < 20) setHasMore(false);
      if (results.length > 0) {
        setClips((prev) => {
          const existingIds = new Set(prev.map((c) => c.id));
          const fresh = results.filter((c) => !existingIds.has(c.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
    } catch (e) {
      if (snapshotId !== requestIdRef.current) return;
      console.error(e);
    }
    if (snapshotId === requestIdRef.current) setLoadingMore(false);
  }, [loadingMore, hasMore]);

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

  // Trigger loadClips when any filter changes
  useEffect(() => {
    loadClips();
  }, [loadClips, query, page, selectedTag, selectedDomain, timeRange, starredOnly, unreadOnly]);

  // loadMeta only once on mount (tags/domains don't change with filters)
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    tauriInvoke<string>("get_clip_server_token").then(setServerToken).catch(console.error);
  }, []);

  // Check onboarding status (only once, after first clips load)
  const onboardingChecked = useRef(false);
  useEffect(() => {
    if (onboardingChecked.current || loading) return;
    onboardingChecked.current = true;
    if (total === 0) {
      tauriInvoke<{ clip_count: number; onboarding_complete: boolean }>("get_app_status")
        .then((status) => {
          if (status.clip_count === 0 && !status.onboarding_complete) {
            setShowOnboarding(true);
          }
        })
        .catch(console.error);
    }
  }, [loading, total]);

  // Check AI config — lightweight: only check if config keys exist, no API call
  const checkAiConfig = useCallback(() => {
    tauriInvoke<Record<string, string>>("get_ai_config")
      .then((cfg) => setAiConfigured(Boolean(cfg.provider && cfg.api_key)))
      .catch(() => setAiConfigured(false));
  }, []);

  // Only run once on mount, not on every loadClips change
  const loadClipsRef = useRef(loadClips);
  loadClipsRef.current = loadClips;
  const loadMetaRef = useRef(loadMeta);
  loadMetaRef.current = loadMeta;

  useEffect(() => {
    checkAiConfig();
    const handler = async () => {
      checkAiConfig();
      const pending = await tauriInvoke<number>("count_pending_clips").catch(() => 0);
      if (pending > 0) {
        setRetagging(true);
        // Triggers background processing; polling detects completion
        await tauriInvoke("ai_batch_retag_clips").catch(console.error);
      }
      loadClipsRef.current();
      loadMetaRef.current();
    };
    window.addEventListener("knoyoo-ai-config-changed", handler);
    return () => window.removeEventListener("knoyoo-ai-config-changed", handler);
  }, [checkAiConfig]);

  // Track previous pending count to detect batch completion
  const prevPendingRef = useRef(0);
  useEffect(() => {
    const checkPending = () => {
      tauriInvoke<number>("count_pending_clips")
        .then((n) => {
          const prev = prevPendingRef.current;
          prevPendingRef.current = n;
          setPendingCount(n);
          // Batch retag finished: pending dropped to 0 from a nonzero value
          if (n === 0 && prev > 0) {
            setRetagging(false);
            loadClipsRef.current();
            loadMetaRef.current();
          }
        })
        .catch(console.error);
    };
    checkPending();
    pendingTimerRef.current = setInterval(checkPending, 3000);
    return () => {
      if (pendingTimerRef.current) clearInterval(pendingTimerRef.current);
    };
  }, []);

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

  // Cleanup timers on unmount
  useEffect(() => {
    const animTimers = animationTimersRef.current;
    const pendingDeletes = pendingDeletesRef.current;
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      animTimers.forEach((t) => clearTimeout(t));
      animTimers.clear();
      pendingDeletes.forEach(({ timer }, id) => {
        clearTimeout(timer);
        tauriInvoke("delete_web_clip", { id });
      });
      pendingDeletes.clear();
    };
  }, []);

  // Close more-menu on outside click
  useEffect(() => {
    if (!moreMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreMenuOpen]);

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
    if (selectedClip?.id === id) setSelectedClip(null);
    // Start slide-out animation
    setSlidingOutIds((prev) => new Set(prev).add(id));
    // After animation, remove from list and schedule actual soft-delete
    const animTimer = setTimeout(() => {
      animationTimersRef.current.delete(id);
      setSlidingOutIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setClips((prev) => prev.filter((c) => c.id !== id));
      const timer = setTimeout(() => {
        pendingDeletesRef.current.delete(id);
        tauriInvoke("delete_web_clip", { id }).then(() => loadMeta());
      }, 15000);
      pendingDeletesRef.current.set(id, { timer, clip });
      showToast("已移至乐色（可在乐色中恢复）", "info", {
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
    }, 300);
    animationTimersRef.current.set(id, animTimer);
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
      if (count === 0) {
        setRetagging(false);
      }
      // count > 0: tagging runs in background; pendingCount polling will
      // detect completion and clear retagging state
    } catch (e) {
      console.error(e);
      setRetagging(false);
    }
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

  const handleLoadDemo = async () => {
    const demos = [
      {
        url: "https://example.com/rust-ownership",
        title: "深入理解 Rust 所有权机制",
        content: "Rust 的所有权系统是其最独特的特性之一，它在编译时保证内存安全，无需垃圾回收器...",
        source_type: "article",
        favicon: "",
      },
      {
        url: "https://example.com/react-19",
        title: "React 19 新特性一览",
        content: "React 19 带来了服务端组件、Actions、新的 hooks 等重大更新...",
        source_type: "article",
        favicon: "",
      },
      {
        url: "https://youtube.com/watch?v=demo123",
        title: "10 分钟学会 Docker",
        content: "Docker 容器化技术入门：从安装到部署你的第一个应用...",
        source_type: "video",
        favicon: "",
      },
    ];
    for (const demo of demos) {
      await tauriInvoke("add_web_clip", { clip: demo }).catch(console.error);
    }
    loadClips();
    loadMeta();
  };

  const isWide = useMediaQuery("(min-width: 1024px)");

  // Narrow screen: full-page detail view
  if (selectedClip && !isWide) {
    return (
      <ClipDetail
        key={selectedClip.id}
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
  const activeFilterCount =
    (starredOnly ? 1 : 0) +
    (unreadOnly ? 1 : 0) +
    (timeRange !== "all" ? 1 : 0) +
    (selectedTag ? 1 : 0) +
    (selectedDomain ? 1 : 0);

  return (
    <div className={splitView ? "flex gap-0 -mx-6 -my-6 h-[calc(100vh)]" : ""}>
      {/* Detail panel (split view right side) */}
      {splitView && (
        <div className="w-3/5 order-2 overflow-y-auto px-6 py-6 border-l border-border">
          <ClipDetail
            key={selectedClip.id}
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
          {/* Header — clean: title + count + refresh */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h1 className="text-[28px] font-bold tracking-tight m-0">智库</h1>
              <span className="text-[13px] text-text-tertiary">{total} 条收藏</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                setRefreshing(true);
                await Promise.all([loadClips(), loadMeta()]);
                setRefreshing(false);
              }}
              title="刷新"
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            </Button>
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

          {/* Sticky search + filter toggle + more menu */}
          <div className="sticky top-0 z-10 bg-bg/80 backdrop-blur-sm -mx-6 px-6 py-2">
            <div className="flex items-center gap-2">
              {/* Search input */}
              <div className="relative flex-1">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
                />
                <input
                  type="text"
                  placeholder={aiSearchMode ? "AI 搜索：描述你记得的内容..." : "搜索智库..."}
                  value={query}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => {
                    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
                    blurTimeoutRef.current = setTimeout(() => setSearchFocused(false), 200);
                  }}
                  onChange={(e) => {
                    const val = e.target.value;
                    setQuery(val);
                    setFuzzyResults(null);
                    setPage(1);
                    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
                    if (val.trim()) {
                      if (aiSearchMode) {
                        searchTimeoutRef.current = setTimeout(() => handleAISearch(val), 500);
                      } else {
                        searchTimeoutRef.current = setTimeout(() => {
                          loadClips();
                          addSearchHistory(val);
                        }, 300);
                      }
                    }
                  }}
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-bg-secondary border border-border text-[13px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent/40 focus:shadow-md focus:ring-2 focus:ring-accent/15 transition-all duration-200"
                />
                <button
                  onClick={() => setAiSearchMode(!aiSearchMode)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors cursor-pointer ${
                    aiSearchMode
                      ? "text-accent bg-accent/10"
                      : "text-text-tertiary hover:text-accent"
                  }`}
                  title={aiSearchMode ? "切换为普通搜索" : "切换为 AI 搜索"}
                >
                  <Sparkles size={14} />
                </button>
              </div>

              {/* Filter toggle */}
              <button
                onClick={() => setFiltersOpen(!filtersOpen)}
                className={`relative p-2 rounded-xl border transition-colors cursor-pointer shrink-0 ${
                  filtersOpen || activeFilterCount > 0
                    ? "bg-accent/10 text-accent border-accent/20"
                    : "bg-bg-secondary text-text-secondary border-border hover:border-accent/20"
                }`}
                title="筛选"
              >
                <SlidersHorizontal size={16} />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent text-white text-[10px] flex items-center justify-center font-medium">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {/* More menu */}
              <div className="relative" ref={moreMenuRef}>
                <button
                  onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                  className="p-2 rounded-xl border border-border bg-bg-secondary text-text-secondary hover:border-accent/20 transition-colors cursor-pointer shrink-0"
                  title="更多操作"
                >
                  <MoreHorizontal size={16} />
                </button>
                {moreMenuOpen && (
                  <div className="absolute right-0 mt-1 w-40 rounded-xl bg-bg-secondary border border-border shadow-lg z-30 py-1">
                    <button
                      onClick={() => {
                        handleBatchRetag();
                        setMoreMenuOpen(false);
                      }}
                      disabled={retagging}
                      className="w-full text-left px-3 py-2 text-[12px] text-text hover:bg-bg-tertiary transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <RefreshCw size={13} className={retagging ? "animate-spin" : ""} />
                      {retagging ? "标签中..." : "批量标签"}
                    </button>
                    <button
                      onClick={() => {
                        handleCopyToken();
                        setMoreMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-[12px] text-text hover:bg-bg-tertiary transition-colors cursor-pointer flex items-center gap-2"
                    >
                      {tokenCopied ? <Check size={13} /> : <Copy size={13} />}
                      {tokenCopied ? "Token 已复制" : "复制插件 Token"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Search history dropdown */}
            {searchFocused && !query && searchHistory.length > 0 && (
              <div className="absolute left-6 right-6 mt-1 rounded-xl bg-bg-secondary border border-border shadow-md z-20 py-1">
                {searchHistory.map((h) => (
                  <button
                    key={h}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setQuery(h);
                      setPage(1);
                      setFuzzyResults(null);
                      if (aiSearchMode) {
                        handleAISearch(h);
                      } else {
                        setTimeout(() => loadClips(), 0);
                      }
                    }}
                    className="w-full text-left px-4 py-2 text-[12px] text-text-secondary hover:bg-bg-tertiary transition-colors cursor-pointer"
                  >
                    <Search size={12} className="inline mr-2 text-text-tertiary" />
                    {h}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Collapsible filter panel */}
          {filtersOpen && (
            <div className="flex items-center gap-2 flex-wrap mb-2 pt-1 animate-fade-in">
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
              <button
                onClick={() => {
                  setUnreadOnly(!unreadOnly);
                  setPage(1);
                  setFuzzyResults(null);
                }}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer border ${
                  unreadOnly
                    ? "bg-accent/10 text-accent border-accent/20"
                    : "bg-bg text-text-secondary border-border hover:border-accent/20"
                }`}
              >
                <BookOpen size={11} />
                未读
              </button>
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
          )}

          {/* Active filter chips (always visible when filters are active) */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {starredOnly && <FilterChip label="星标" onDismiss={() => setStarredOnly(false)} />}
              {unreadOnly && <FilterChip label="未读" onDismiss={() => setUnreadOnly(false)} />}
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
            <>
              {fuzzyResults !== null ? (
                <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                  <Library size={48} strokeWidth={1} className="mb-4 opacity-40" />
                  <p className="text-[14px] mb-1">AI 搜索未找到匹配内容</p>
                  <p className="text-[12px]">试试换个描述方式</p>
                </div>
              ) : query.trim() ? (
                <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                  <Library size={48} strokeWidth={1} className="mb-4 opacity-40" />
                  <p className="text-[14px] mb-1">
                    {fuzzyLoading ? "AI 正在搜索中..." : "没有找到匹配的结果"}
                  </p>
                  {fuzzyLoading && <Loader2 size={16} className="animate-spin text-accent mt-2" />}
                  {!fuzzyLoading && <p className="text-[12px]">试试换个关键词或描述方式</p>}
                </div>
              ) : total === 0 ? (
                showOnboarding ? (
                  <OnboardingFlow
                    onComplete={() => {
                      setShowOnboarding(false);
                      loadClips();
                    }}
                  />
                ) : (
                  <EmptyState
                    onLoadDemo={handleLoadDemo}
                    onCopyToken={handleCopyToken}
                    tokenCopied={tokenCopied}
                  />
                )
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                  <Library size={48} strokeWidth={1} className="mb-4 opacity-40" />
                  <p className="text-[14px]">当前筛选条件下没有结果</p>
                </div>
              )}
            </>
          )}

          {/* Clip grid */}
          {displayClips.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-fade-in">
              {displayClips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  onStar={handleStar}
                  onDelete={handleDelete}
                  onSelect={setSelectedClip}
                  onRetag={handleRetag}
                  isSelected={selectedClip?.id === clip.id}
                  searchQuery={query}
                  animateOut={slidingOutIds.has(clip.id)}
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

          {/* End of results indicator */}
          {!loading && !hasMore && displayClips.length > 0 && !fuzzyResults && (
            <div className="flex items-center justify-center py-6 text-text-tertiary text-[12px]">
              已显示全部 {displayClips.length} 条结果
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
