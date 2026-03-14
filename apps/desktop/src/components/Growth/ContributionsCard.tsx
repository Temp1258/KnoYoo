import { useState, useEffect } from "react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { DateCount } from "../../types";

function colorForCount(cnt: number): string {
  if (cnt === 0) return "#e5e7eb";
  if (cnt === 1) return "#c7d2fe";
  if (cnt === 2) return "#a5b4fc";
  if (cnt === 3) return "#818cf8";
  return "#6366f1";
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
    <div className="card">
      <h3 style={{ marginTop: 0 }}>每日贡献</h3>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="contribution-grid">
          {dates.map((c) => (
            <div
              key={c.date}
              title={`${c.date} : ${c.count}`}
              className="contribution-cell"
              style={{ background: colorForCount(c.count) }}
            />
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <svg width={chartWidth} height={chartHeight + 20}>
            <path d={pathD} fill="none" stroke="#4f46e5" strokeWidth={2} />
            {pts.map((p, idx) => (
              <circle key={idx} cx={p[0]} cy={p[1]} r={2} fill="#4f46e5" />
            ))}
            {[0.25, 0.5, 0.75, 1].map((f, i) => {
              const y = chartHeight - f * chartHeight;
              const val = Math.round(f * maxCount);
              return (
                <g key={i}>
                  <line x1={0} y1={y} x2={chartWidth} y2={y} stroke="#e5e7eb" strokeDasharray="2 2" />
                  <text x={chartWidth + 4} y={y + 4} fontSize={9} fill="#6b7280">
                    {val}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
