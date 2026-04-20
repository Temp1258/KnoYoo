import { useEffect, useRef, useState } from "react";
import { Trophy, X, Sparkles } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { Milestone } from "../../types";

type Display = { title: string; subtitle: string };

function parseMeta(meta_json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(meta_json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function formatMilestone(m: Milestone): Display {
  switch (m.kind) {
    case "clip_count":
      return {
        title: `收藏突破 ${m.value.toLocaleString()} 条`,
        subtitle: "你的知识库在稳步生长",
      };
    case "consecutive_days":
      return {
        title: `连续 ${m.value} 天有新输入`,
        subtitle: "习惯正在被你一点点养成",
      };
    case "tag_depth": {
      const meta = parseMeta(m.meta_json);
      const tag = typeof meta.tag === "string" ? meta.tag : "某个话题";
      return {
        title: `「${tag}」已累计 ${m.value} 条`,
        subtitle: "你在这个话题上挖得很深",
      };
    }
    case "books_read":
      return {
        title: `已读完第 ${m.value} 本书`,
        subtitle: "一本一本啃完的人不多",
      };
    default:
      return { title: "达成新里程碑", subtitle: "" };
  }
}

export default function MilestoneBanner() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [dismissing, setDismissing] = useState<Set<number>>(new Set());
  // Track pending dismissal timeouts so unmount can cancel them — otherwise
  // a late-firing setState callback against an unmounted banner throws a
  // React warning and can stomp state if the component is re-mounted later.
  const dismissTimeouts = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    let stale = false;
    tauriInvoke<Milestone[]>("list_milestones", { unacknowledgedOnly: true })
      .then((data) => {
        if (!stale) setMilestones(data);
      })
      .catch((e) => console.error("Failed to load milestones:", e));
    return () => {
      stale = true;
    };
  }, []);

  // Clear every pending timeout on unmount so the fade-out setState chain
  // doesn't run against a disposed component.
  useEffect(() => {
    const timers = dismissTimeouts.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const dismiss = async (id: number) => {
    setDismissing((prev) => new Set(prev).add(id));
    try {
      await tauriInvoke("acknowledge_milestone", { id });
      // Wait for CSS transition before removing from DOM. Store the timer
      // so unmount cleanup can cancel it.
      const t = setTimeout(() => {
        dismissTimeouts.current.delete(id);
        setMilestones((prev) => prev.filter((m) => m.id !== id));
        setDismissing((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 200);
      dismissTimeouts.current.set(id, t);
    } catch (e) {
      console.error("Failed to acknowledge milestone:", e);
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (milestones.length === 0) return null;

  // Cap visible banner count — if user has a pile, the rest will surface
  // next page load. Three at once keeps the Discover page glanceable.
  const visible = milestones.slice(0, 3);

  return (
    <section className="mb-8 space-y-2">
      {visible.map((m) => {
        const { title, subtitle } = formatMilestone(m);
        const isDismissing = dismissing.has(m.id);
        return (
          <div
            key={m.id}
            className={`relative overflow-hidden rounded-xl border border-amber-200/60 dark:border-amber-500/20 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 dark:from-amber-950/30 dark:via-yellow-950/20 dark:to-amber-950/30 px-4 py-3 flex items-center gap-3 transition-all duration-200 ${
              isDismissing ? "opacity-0 -translate-y-1" : "opacity-100"
            }`}
          >
            {/* Subtle sparkle accent */}
            <Sparkles
              size={10}
              className="absolute top-2 right-8 text-amber-400/60 animate-pulse"
            />
            <div className="shrink-0 w-9 h-9 rounded-full bg-amber-400/20 flex items-center justify-center">
              <Trophy size={18} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-amber-900 dark:text-amber-100 truncate">
                {title}
              </div>
              {subtitle && (
                <div className="text-[11px] text-amber-700/80 dark:text-amber-200/70 truncate">
                  {subtitle}
                </div>
              )}
            </div>
            <button
              onClick={() => dismiss(m.id)}
              disabled={isDismissing}
              className="shrink-0 p-1 rounded-md text-amber-700/60 dark:text-amber-300/60 hover:bg-amber-400/20 hover:text-amber-900 dark:hover:text-amber-100 transition-colors cursor-pointer disabled:cursor-default"
              aria-label="已知晓"
              title="已知晓"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </section>
  );
}
