import { useState, useEffect } from "react";
import { BarChart3, Tag, Globe } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";

type WeeklyStats = {
  daily_counts: [string, number][];
  top_tags: [string, number][];
  top_domains: [string, number][];
  total_clips: number;
  total_notes: number;
  total_collections: number;
};

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 text-text-tertiary truncate" title={label}>
        {label}
      </span>
      <div className="flex-1 h-4 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className="h-full bg-accent/60 rounded-full transition-all duration-300"
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span className="w-6 text-right text-text-tertiary">{value}</span>
    </div>
  );
}

export default function WeeklyReportCard() {
  const [stats, setStats] = useState<WeeklyStats | null>(null);

  useEffect(() => {
    tauriInvoke<WeeklyStats>("get_weekly_stats").then(setStats).catch(console.error);
  }, []);

  if (!stats) return null;

  const maxDaily = Math.max(...stats.daily_counts.map(([, c]) => c), 1);
  const maxTag = Math.max(...stats.top_tags.map(([, c]) => c), 1);
  const maxDomain = Math.max(...stats.top_domains.map(([, c]) => c), 1);

  return (
    <div className="space-y-4">
      {/* Overview */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "总收藏", value: stats.total_clips },
          { label: "笔记", value: stats.total_notes },
          { label: "集合", value: stats.total_collections },
        ].map((item) => (
          <div
            key={item.label}
            className="p-3 rounded-xl bg-bg-secondary border border-border text-center"
          >
            <div className="text-[20px] font-bold text-text">{item.value}</div>
            <div className="text-[11px] text-text-tertiary">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Daily Activity */}
      {stats.daily_counts.length > 0 && (
        <div className="p-4 rounded-xl bg-bg-secondary border border-border">
          <div className="flex items-center gap-2 mb-3 text-[12px] font-medium text-text-secondary">
            <BarChart3 size={14} />
            最近 28 天收藏趋势
          </div>
          <div className="flex items-end gap-0.5 h-16">
            {stats.daily_counts.map(([day, count]) => (
              <div
                key={day}
                className="flex-1 bg-accent/40 rounded-t hover:bg-accent/60 transition-colors"
                style={{ height: `${Math.max((count / maxDaily) * 100, 4)}%` }}
                title={`${day}: ${count} 条`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Top Tags */}
      {stats.top_tags.length > 0 && (
        <div className="p-4 rounded-xl bg-bg-secondary border border-border">
          <div className="flex items-center gap-2 mb-3 text-[12px] font-medium text-text-secondary">
            <Tag size={14} />
            热门标签 Top 5
          </div>
          <div className="space-y-1.5">
            {stats.top_tags.slice(0, 5).map(([tag, count]) => (
              <Bar key={tag} value={count} max={maxTag} label={tag} />
            ))}
          </div>
        </div>
      )}

      {/* Top Domains */}
      {stats.top_domains.length > 0 && (
        <div className="p-4 rounded-xl bg-bg-secondary border border-border">
          <div className="flex items-center gap-2 mb-3 text-[12px] font-medium text-text-secondary">
            <Globe size={14} />
            主要来源 Top 5
          </div>
          <div className="space-y-1.5">
            {stats.top_domains.slice(0, 5).map(([domain, count]) => (
              <Bar key={domain} value={count} max={maxDomain} label={domain} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
