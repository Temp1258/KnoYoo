import { useState, useEffect, useCallback } from "react";
import {
  Lightbulb,
  Sparkles,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Tag,
  Globe,
  BarChart3,
} from "lucide-react";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { WebClip } from "../types";
import ClipCard from "../components/Clips/ClipCard";
import ClipDetail from "../components/Clips/ClipDetail";
import MilestoneBanner from "../components/Milestones/MilestoneBanner";
import { SkeletonCard } from "../components/ui/Skeleton";
import { useMediaQuery } from "../hooks/useMediaQuery";

type WeeklyStats = {
  daily_counts: [string, number][];
  top_tags: [string, number][];
  top_domains: [string, number][];
  total_clips: number;
  total_notes: number;
};

const TAG_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
];

function DomainBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-24 text-text-secondary truncate" title={label}>
        {label}
      </span>
      <div className="flex-1 h-[18px] bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className="h-full bg-accent/50 rounded-full transition-all duration-500"
          style={{ width: `${Math.max(pct, 3)}%` }}
        />
      </div>
      <span className="w-8 text-right tabular-nums text-text-tertiary font-medium">{value}</span>
    </div>
  );
}

export default function DiscoverPage() {
  const [forgottenClips, setForgottenClips] = useState<WebClip[]>([]);
  const [weeklySummary, setWeeklySummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [selectedClip, setSelectedClip] = useState<WebClip | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<WeeklyStats | null>(null);

  const isWide = useMediaQuery("(min-width: 1024px)");

  const loadForgotten = useCallback(async () => {
    setLoading(true);
    try {
      const clips = await tauriInvoke<WebClip[]>("forgotten_clips", { limit: 5 });
      setForgottenClips(clips);
    } catch (e) {
      console.error("Failed to load forgotten clips:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let stale = false;

    tauriInvoke<WebClip[]>("forgotten_clips", { limit: 5 })
      .then((clips) => {
        if (!stale) setForgottenClips(clips);
      })
      .catch(console.error)
      .finally(() => {
        if (!stale) setLoading(false);
      });

    tauriInvoke<WeeklyStats>("get_weekly_stats")
      .then((s) => {
        if (!stale) setStats(s);
      })
      .catch(console.error);

    return () => {
      stale = true;
    };
  }, []);

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

  const handleRegenerateSummary = async () => {
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

  const handleStar = async (id: number) => {
    await tauriInvoke("toggle_star_clip", { id });
    loadForgotten();
    if (selectedClip?.id === id) {
      setSelectedClip((prev) => (prev ? { ...prev, is_starred: !prev.is_starred } : null));
    }
  };

  const handleDelete = async (id: number) => {
    await tauriInvoke("delete_web_clip", { id });
    if (selectedClip?.id === id) setSelectedClip(null);
    loadForgotten();
  };

  const handleRetag = async (id: number) => {
    await tauriInvoke("ai_auto_tag_clip", { id }).catch(console.error);
    loadForgotten();
  };

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
          loadForgotten();
        }}
      />
    );
  }

  const splitView = isWide && selectedClip;

  // Compute tag cloud sizing
  const topTags = stats?.top_tags.slice(0, 10) ?? [];
  const maxTagCount = Math.max(...topTags.map(([, c]) => c), 1);
  const minTagCount = Math.min(...topTags.map(([, c]) => c), 1);

  // Compute domain bar chart
  const topDomains = stats?.top_domains.slice(0, 5) ?? [];
  const maxDomainCount = Math.max(...topDomains.map(([, c]) => c), 1);

  // Compute sparkline
  const dailyCounts = stats?.daily_counts ?? [];
  const maxDaily = Math.max(...dailyCounts.map(([, c]) => c), 1);

  return (
    <div className={splitView ? "flex gap-0 -mx-6 -my-6 h-[calc(100vh)]" : ""}>
      {splitView && (
        <div className="w-3/5 order-2 overflow-y-auto px-6 py-6 border-l border-border">
          <ClipDetail
            key={selectedClip.id}
            clip={selectedClip}
            onBack={() => setSelectedClip(null)}
            onStar={handleStar}
            onUpdate={(c) => {
              setSelectedClip(c);
              loadForgotten();
            }}
            compact
          />
        </div>
      )}

      <div className={splitView ? "w-2/5 order-1 overflow-y-auto px-4 py-4" : ""}>
        <h1 className="text-[28px] font-bold tracking-tight mb-6">发现</h1>

        {/* ── Milestones (unacknowledged celebrations) ── */}
        <MilestoneBanner />

        {/* ── Weekly Summary ── */}
        <section className="mb-8">
          {weeklySummary ? (
            <div className="rounded-xl bg-accent/5 border border-accent/10">
              <div className="flex items-center justify-between px-4 py-3">
                <button
                  onClick={() => setSummaryExpanded(!summaryExpanded)}
                  className="flex items-center gap-2 text-[13px] font-medium text-accent cursor-pointer bg-transparent border-none p-0"
                >
                  <Sparkles size={14} />
                  本周收藏摘要
                  {summaryExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <button
                  onClick={handleRegenerateSummary}
                  disabled={summaryLoading}
                  className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent cursor-pointer bg-transparent border-none p-1 rounded-md hover:bg-accent/10 transition-colors"
                  title="重新生成"
                >
                  <RefreshCw size={12} className={summaryLoading ? "animate-spin" : ""} />
                  重新生成
                </button>
              </div>
              {summaryExpanded && (
                <p className="px-4 pb-4 text-[13px] text-text leading-relaxed m-0">
                  {weeklySummary}
                </p>
              )}
            </div>
          ) : (
            <button
              onClick={handleLoadSummary}
              disabled={summaryLoading}
              className="w-full p-3 rounded-xl bg-bg-secondary border border-border hover:border-accent/20 text-[13px] text-text-secondary flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Sparkles size={14} className={summaryLoading ? "animate-pulse" : ""} />
              {summaryLoading ? "生成本周摘要中..." : "生成本周收藏摘要"}
            </button>
          )}
        </section>

        {/* ── Knowledge Profile ── */}
        {stats && (topTags.length > 0 || topDomains.length > 0 || dailyCounts.length > 0) && (
          <section className="mb-8">
            <h2 className="text-[16px] font-semibold text-text mb-4">知识画像</h2>

            {/* Overview counters */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: "总收藏", value: stats.total_clips },
                { label: "笔记", value: stats.total_notes },
              ].map((item) => (
                <div
                  key={item.label}
                  className="p-3 rounded-xl bg-bg-secondary border border-border text-center"
                >
                  <div className="text-[20px] font-bold text-text tabular-nums">{item.value}</div>
                  <div className="text-[11px] text-text-tertiary">{item.label}</div>
                </div>
              ))}
            </div>

            {/* Tag cloud */}
            {topTags.length > 0 && (
              <div className="p-4 rounded-xl bg-bg-secondary border border-border mb-4">
                <div className="flex items-center gap-2 mb-3 text-[12px] font-medium text-text-secondary">
                  <Tag size={14} />
                  标签词云
                </div>
                <div className="flex flex-wrap gap-2">
                  {topTags.map(([tag, count], i) => {
                    const range = maxTagCount - minTagCount || 1;
                    const ratio = (count - minTagCount) / range;
                    const fontSize = 11 + ratio * 5; // 11px to 16px
                    const paddingY = 3 + ratio * 2;
                    const paddingX = 8 + ratio * 4;
                    return (
                      <span
                        key={tag}
                        className={`inline-flex items-center rounded-full font-medium transition-transform hover:scale-105 ${TAG_COLORS[i % TAG_COLORS.length]}`}
                        style={{
                          fontSize: `${fontSize}px`,
                          paddingTop: `${paddingY}px`,
                          paddingBottom: `${paddingY}px`,
                          paddingLeft: `${paddingX}px`,
                          paddingRight: `${paddingX}px`,
                        }}
                        title={`${tag}: ${count} 条`}
                      >
                        {tag}
                        <span className="ml-1 opacity-60 text-[10px]">{count}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top 5 Domains */}
            {topDomains.length > 0 && (
              <div className="p-4 rounded-xl bg-bg-secondary border border-border mb-4">
                <div className="flex items-center gap-2 mb-3 text-[12px] font-medium text-text-secondary">
                  <Globe size={14} />
                  来源 Top 5
                </div>
                <div className="space-y-2">
                  {topDomains.map(([domain, count]) => (
                    <DomainBar key={domain} value={count} max={maxDomainCount} label={domain} />
                  ))}
                </div>
              </div>
            )}

            {/* 28-day Trend Sparkline */}
            {dailyCounts.length > 0 && (
              <div className="p-4 rounded-xl bg-bg-secondary border border-border">
                <div className="flex items-center gap-2 mb-3 text-[12px] font-medium text-text-secondary">
                  <BarChart3 size={14} />
                  收藏趋势
                  <span className="text-[10px] text-text-tertiary font-normal">最近 28 天</span>
                </div>
                <div className="flex items-end gap-[3px] h-16">
                  {dailyCounts.map(([day, count]) => (
                    <div
                      key={day}
                      className="flex-1 bg-accent/40 rounded-t hover:bg-accent/70 transition-colors cursor-default"
                      style={{ height: `${Math.max((count / maxDaily) * 100, 4)}%` }}
                      title={`${day}: ${count} 条`}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Forgotten Clips ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb size={15} className="text-yellow-500" />
            <span className="text-[14px] font-medium text-text">你可能忘了这些收藏</span>
            <span className="text-[11px] text-text-tertiary">(30天未查看)</span>
          </div>

          {loading && forgottenClips.length === 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}

          {!loading && forgottenClips.length === 0 && (
            <div className="text-center py-12 text-text-tertiary">
              <Lightbulb size={40} strokeWidth={1} className="mx-auto mb-3 opacity-40" />
              <p className="text-[14px]">还没有需要回顾的内容</p>
              <p className="text-[12px]">收藏超过 30 天的内容会在这里浮现</p>
            </div>
          )}

          {forgottenClips.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {forgottenClips.map((clip) => (
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
        </section>
      </div>
    </div>
  );
}
