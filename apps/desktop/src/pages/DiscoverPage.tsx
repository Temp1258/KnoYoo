import { useState, useEffect, useCallback } from "react";
import { Lightbulb, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { WebClip } from "../types";
import ClipCard from "../components/Clips/ClipCard";
import ClipDetail from "../components/Clips/ClipDetail";
import { SkeletonCard } from "../components/ui/Skeleton";
import { useMediaQuery } from "../hooks/useMediaQuery";
import WeeklyReportCard from "../components/Dashboard/WeeklyReportCard";

export default function DiscoverPage() {
  const [forgottenClips, setForgottenClips] = useState<WebClip[]>([]);
  const [weeklySummary, setWeeklySummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [selectedClip, setSelectedClip] = useState<WebClip | null>(null);
  const [loading, setLoading] = useState(true);

  const isWide = useMediaQuery("(min-width: 1024px)");

  const loadForgotten = useCallback(async () => {
    setLoading(true);
    try {
      const clips = await tauriInvoke<WebClip[]>("forgotten_clips", { limit: 10 });
      setForgottenClips(clips);
    } catch (e) {
      console.error("Failed to load forgotten clips:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let stale = false;
    tauriInvoke<WebClip[]>("forgotten_clips", { limit: 10 })
      .then((clips) => {
        if (!stale) setForgottenClips(clips);
      })
      .catch(console.error)
      .finally(() => {
        if (!stale) setLoading(false);
      });
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

  return (
    <div className={splitView ? "flex gap-0 -mx-6 -my-6 h-[calc(100vh)]" : ""}>
      {splitView && (
        <div className="w-3/5 order-2 overflow-y-auto px-6 py-6 border-l border-border">
          <ClipDetail
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
        <h1 className="text-[28px] font-bold tracking-tight mb-4">发现</h1>

        {/* Weekly summary */}
        <div className="mb-6">
          {weeklySummary ? (
            <div className="rounded-xl bg-accent/5 border border-accent/10">
              <button
                onClick={() => setSummaryExpanded(!summaryExpanded)}
                className="w-full flex items-center gap-2 px-4 py-3 text-[13px] font-medium text-accent cursor-pointer"
              >
                <Sparkles size={14} />
                本周收藏摘要
                {summaryExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
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
        </div>

        {/* Forgotten clips */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb size={15} className="text-yellow-500" />
            <span className="text-[14px] font-medium text-text">你可能忘了这些收藏</span>
            <span className="text-[11px] text-text-tertiary">
              ({forgottenClips.length} 条 30 天前的内容)
            </span>
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
        </div>

        {/* Weekly Stats Dashboard */}
        <div className="mt-6">
          <h2 className="text-[16px] font-semibold text-text mb-3">知识库概览</h2>
          <WeeklyReportCard />
        </div>
      </div>
    </div>
  );
}
