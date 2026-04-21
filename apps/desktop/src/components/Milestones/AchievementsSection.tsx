import { useEffect, useMemo, useState } from "react";
import {
  Trophy,
  Sparkles,
  Flame,
  Tag as TagIcon,
  BookOpen,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { Milestone, MilestoneKind } from "../../types";

/**
 * Trophy wall embedded inside DiscoverPage. Shows every milestone the user
 * has ever achieved, grouped by kind. Formerly a standalone /achievements
 * page — integrated into Discover so the sidebar stays lean and so new
 * (unacknowledged) + historical milestones live in the same visual context.
 */

type GroupMeta = {
  title: string;
  icon: LucideIcon;
  accent: string;
  cardAccent: string;
};

const GROUP_META: Record<string, GroupMeta> = {
  clip_count: {
    title: "收藏量",
    icon: FileText,
    accent: "text-blue-500",
    cardAccent: "from-blue-50 to-sky-50 dark:from-blue-950/40 dark:to-sky-950/30",
  },
  consecutive_days: {
    title: "连续输入",
    icon: Flame,
    accent: "text-orange-500",
    cardAccent: "from-orange-50 to-amber-50 dark:from-orange-950/40 dark:to-amber-950/30",
  },
  tag_depth: {
    title: "话题深度",
    icon: TagIcon,
    accent: "text-emerald-500",
    cardAccent: "from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30",
  },
  books_read: {
    title: "阅读完成",
    icon: BookOpen,
    accent: "text-amber-500",
    cardAccent: "from-amber-50 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/30",
  },
};

function parseMeta(json: string): Record<string, unknown> {
  try {
    const p = JSON.parse(json);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function milestoneTitle(m: Milestone): string {
  switch (m.kind as MilestoneKind) {
    case "clip_count":
      return `收藏突破 ${m.value.toLocaleString()} 条`;
    case "consecutive_days":
      return `连续 ${m.value} 天`;
    case "tag_depth": {
      const tag =
        typeof parseMeta(m.meta_json).tag === "string"
          ? (parseMeta(m.meta_json).tag as string)
          : "某个话题";
      return `「${tag}」累计 ${m.value} 条`;
    }
    case "books_read":
      return `读完第 ${m.value} 本书`;
    default:
      return `达成 ${m.value}`;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function MilestoneCard({ m, meta }: { m: Milestone; meta: GroupMeta }) {
  const Icon = meta.icon;
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-border bg-gradient-to-br ${meta.cardAccent} px-4 py-3 flex items-center gap-3`}
    >
      <div className="shrink-0 w-10 h-10 rounded-full bg-white/60 dark:bg-black/20 flex items-center justify-center backdrop-blur-sm">
        <Trophy size={18} className={meta.accent} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-text truncate">{milestoneTitle(m)}</div>
        <div className="text-[11px] text-text-tertiary mt-0.5 flex items-center gap-1">
          <Icon size={10} />
          达成于 {fmtDate(m.achieved_at)}
        </div>
      </div>
      <Sparkles size={10} className="text-amber-400/50 shrink-0" />
    </div>
  );
}

export default function AchievementsSection() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stale = false;
    tauriInvoke<Milestone[]>("list_milestones", { unacknowledgedOnly: false })
      .then((data) => {
        if (!stale) setMilestones(data);
      })
      .catch((e) => console.error("list_milestones failed:", e))
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const out: Record<string, Milestone[]> = {};
    for (const m of milestones) {
      (out[m.kind] ??= []).push(m);
    }
    for (const list of Object.values(out)) {
      list.sort((a, b) => b.value - a.value);
    }
    return out;
  }, [milestones]);

  const kinds = Object.keys(GROUP_META).filter((k) => (grouped[k]?.length ?? 0) > 0);

  // Loading silently (no skeleton) — this is one of several sections and
  // other content above already gives the user something to look at.
  if (loading) return null;
  // Zero-state: hide entirely. The MilestoneBanner covers the "你还没有成就"
  // guidance path via its own empty branch (it simply doesn't render).
  if (milestones.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy size={15} className="text-amber-500" />
          <h2 className="text-[16px] font-semibold text-text m-0">成就</h2>
          <span className="text-[11px] text-text-tertiary">· 共 {milestones.length} 项</span>
        </div>
      </div>

      <div className="space-y-5">
        {kinds.map((kind) => {
          const meta = GROUP_META[kind];
          if (!meta) return null;
          const list = grouped[kind] ?? [];
          const Icon = meta.icon;
          return (
            <div key={kind}>
              <div className="flex items-center gap-2 mb-2">
                <Icon size={13} className={meta.accent} />
                <h3 className="text-[13px] font-medium text-text-secondary m-0">{meta.title}</h3>
                <span className="text-[10px] text-text-tertiary">· {list.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {list.map((m) => (
                  <MilestoneCard key={m.id} m={m} meta={meta} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
