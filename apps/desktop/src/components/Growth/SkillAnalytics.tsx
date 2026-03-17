import { useState, useEffect } from "react";
import { BarChart3, BookOpen, Clock, Award } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Card from "../ui/Card";
import type { LearningStats } from "../../types";

function RadarChart({ data }: { data: { name: string; progress: number }[] }) {
  if (data.length < 3) return null;

  const cx = 120;
  const cy = 120;
  const maxR = 90;
  const n = data.length;
  const angleStep = (2 * Math.PI) / n;

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1.0];

  // Points for data polygon
  const points = data.map((d, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const r = maxR * d.progress;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  const polygon = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Label positions
  const labels = data.map((d, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const r = maxR + 20;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), name: d.name };
  });

  return (
    <svg width={240} height={240} className="mx-auto">
      {/* Grid rings */}
      {rings.map((f) => (
        <polygon
          key={f}
          points={Array.from({ length: n }, (_, i) => {
            const angle = -Math.PI / 2 + i * angleStep;
            const r = maxR * f;
            return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
          }).join(" ")}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={0.5}
        />
      ))}

      {/* Axis lines */}
      {data.map((_, i) => {
        const angle = -Math.PI / 2 + i * angleStep;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + maxR * Math.cos(angle)}
            y2={cy + maxR * Math.sin(angle)}
            stroke="var(--color-border)"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Data polygon */}
      <polygon
        points={polygon}
        fill="var(--color-accent)"
        fillOpacity={0.15}
        stroke="var(--color-accent)"
        strokeWidth={1.5}
      />

      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="var(--color-accent)" />
      ))}

      {/* Labels */}
      {labels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={10}
          fill="var(--color-text-secondary)"
        >
          {l.name.length > 6 ? l.name.slice(0, 6) + ".." : l.name}
        </text>
      ))}
    </svg>
  );
}

function StatBlock({
  icon: Icon,
  label,
  value,
  unit,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div className="text-center space-y-1">
      <div className="flex items-center justify-center gap-1 text-text-tertiary">
        <Icon size={12} />
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-[20px] font-bold ${accent ? "text-accent" : "text-text"}`}>
        {value}
        {unit && <span className="text-[11px] font-normal text-text-secondary ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

export default function SkillAnalytics() {
  const [stats, setStats] = useState<LearningStats | null>(null);

  useEffect(() => {
    tauriInvoke<LearningStats>("get_learning_stats").then(setStats).catch(console.error);
  }, []);

  if (!stats) return null;

  return (
    <Card>
      <h3 className="text-[17px] font-semibold m-0 mb-4">技能成长概览</h3>

      <div className="flex gap-6 flex-wrap items-start">
        {/* Radar chart */}
        {stats.radar.length >= 3 && (
          <div className="shrink-0">
            <RadarChart data={stats.radar} />
          </div>
        )}

        {/* Stats grid */}
        <div className="flex-1 min-w-[200px]">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <StatBlock icon={BarChart3} label="技能总数" value={stats.total_skills} />
            <StatBlock
              icon={Award}
              label="已掌握"
              value={stats.mastered_skills}
              accent
            />
            <StatBlock
              icon={Clock}
              label="本月学习"
              value={stats.monthly_minutes}
              unit="分钟"
            />
            <StatBlock icon={BookOpen} label="笔记总数" value={stats.total_notes} />
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[12px]">
              <span className="text-text-secondary">整体完成度</span>
              <span className="text-text font-medium">{Math.round(stats.completion_pct * 100)}%</span>
            </div>
            <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{ width: `${Math.round(stats.completion_pct * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-text-tertiary">
              <span>平均进度 {Math.round(stats.avg_progress * 100)}%</span>
              <span>{stats.active_skills} 个技能进行中</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
