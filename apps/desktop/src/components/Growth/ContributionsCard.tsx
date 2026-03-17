import { useState, useEffect } from "react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Card from "../ui/Card";
import type { DateCount } from "../../types";

function colorForCount(cnt: number): string {
  if (cnt === 0) return "var(--color-bg-tertiary)";
  if (cnt === 1) return "var(--color-accent-light)";
  if (cnt === 2) return "color-mix(in srgb, var(--color-accent) 40%, transparent)";
  if (cnt === 3) return "color-mix(in srgb, var(--color-accent) 65%, transparent)";
  return "var(--color-accent)";
}

export default function ContributionsCard() {
  const [counts, setCounts] = useState<DateCount[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await tauriInvoke<DateCount[]>("list_note_contributions", { days: 120 });
        setCounts(res || []);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const today = new Date();
  const dates: DateCount[] = [];
  for (let i = 111; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const ds = d.toISOString().slice(0, 10);
    const found = counts.find((c) => c.date === ds);
    dates.push({ date: ds, count: found ? found.count : 0 });
  }
  const maxCount = dates.reduce((m, c) => Math.max(m, c.count), 0) || 1;

  const chartWidth = 320;
  const chartHeight = 80;
  const pts = dates.map((c, idx) => {
    const x = (chartWidth / (dates.length - 1)) * idx;
    const y = chartHeight - (c.count / maxCount) * chartHeight;
    return [x, y];
  });
  const pathD = pts.map((p, idx) => `${idx === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");

  return (
    <Card>
      <h3 className="text-[17px] font-semibold m-0 mb-4">每日贡献</h3>
      <div className="flex gap-6 flex-wrap">
        {/* Grid */}
        <div
          className="grid gap-[3px]"
          style={{
            gridTemplateColumns: "repeat(16, 12px)",
            gridAutoRows: "12px",
          }}
        >
          {dates.map((c) => (
            <div
              key={c.date}
              title={`${c.date} : ${c.count}`}
              className="rounded-[2px]"
              style={{ background: colorForCount(c.count) }}
            />
          ))}
        </div>

        {/* Line chart */}
        <div className="flex-1 min-w-[200px]">
          <svg width={chartWidth} height={chartHeight + 20}>
            <path d={pathD} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />
            {pts.map((p, idx) => (
              <circle key={idx} cx={p[0]} cy={p[1]} r={1.5} fill="var(--color-accent)" />
            ))}
            {[0.25, 0.5, 0.75, 1].map((f, i) => {
              const y = chartHeight - f * chartHeight;
              const val = Math.round(f * maxCount);
              return (
                <g key={i}>
                  <line
                    x1={0}
                    y1={y}
                    x2={chartWidth}
                    y2={y}
                    stroke="var(--color-border)"
                    strokeDasharray="2 2"
                  />
                  <text x={chartWidth + 4} y={y + 4} fontSize={9} fill="var(--color-text-tertiary)">
                    {val}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </Card>
  );
}
