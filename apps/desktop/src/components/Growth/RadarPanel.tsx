import React, { useState, useEffect, useRef } from "react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { SkillGapRow } from "../../types";

export default function RadarPanel({ reloadKey = 0 }: { reloadKey?: number }) {
  const [data, setData] = useState<SkillGapRow[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; name: string; label: string; value: number } | null>(null);

  function showTip(e: React.MouseEvent, name: string, label: string, value: number) {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left + 8, y: e.clientY - r.top + 8, name, label, value });
  }
  function hideTip() {
    setTip(null);
  }

  async function loadRadar() {
    setLoading(true);
    try {
      const res = await tauriInvoke<Array<{ name: string; score: number }>>("list_ai_topics_top8");
      const mapped = res.map((r) => ({
        name: r.name,
        mastery: r.score,
        required_level: 0,
        gap: 0,
      }));
      setData(mapped);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRadar();
  }, [reloadKey]);

  if (!loading && (!data || data.length === 0)) {
    return <div style={{ padding: 32, textAlign: "center", color: "#888" }}>暂无数据</div>;
  }

  const facets =
    data.length >= 8
      ? data.slice(0, 8)
      : [...data, ...Array(8 - data.length).fill({ name: "", mastery: 0, required_level: 0, gap: 0 })];

  const N = 8;
  const cx = 140,
    cy = 140,
    R = 110;

  function polar(r: number, i: number) {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / N;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  }

  function ringPolygon(f: number) {
    const r = R * f;
    return Array.from({ length: N }, (_, i) => {
      const [x, y] = polar(r, i);
      return `${x},${y}`;
    }).join(" ");
  }

  const reqPoints = facets
    .map((d, i) => {
      const r = Math.max(0, Math.min(100, d.required_level * 20)) * (R / 100);
      const [x, y] = polar(r, i);
      return `${x},${y}`;
    })
    .join(" ");

  const masPoints = facets
    .map((d, i) => {
      const r = Math.max(0, Math.min(100, d.mastery)) * (R / 100);
      const [x, y] = polar(r, i);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div ref={wrapRef} style={{ position: "relative", width: 280, height: 280 }}>
      <svg width={280} height={280} viewBox="0 0 280 280">
        {[0.25, 0.5, 0.75, 1].map((p, idx) => (
          <polygon key={idx} points={ringPolygon(p)} fill="none" stroke="#eee" />
        ))}
        {facets.map((d, i) => {
          const [x, y] = polar(R, i);
          const [lx, ly] = polar(R + 16, i);
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="#eee" />
              {d.name && (
                <text x={lx} y={ly} fontSize={10} textAnchor="middle" dominantBaseline="middle">
                  {d.name}
                </text>
              )}
            </g>
          );
        })}
        {facets.length >= 3 && (
          <polygon points={reqPoints} fill="none" stroke="#999" strokeDasharray="4 3" />
        )}
        {facets.length >= 3 && (
          <polygon points={masPoints} fill="rgba(33,150,243,0.25)" stroke="#2196f3" />
        )}
        <circle cx={cx} cy={cy} r={2} fill="#999" />
        {facets.map((d, i) => {
          const req = Math.max(0, Math.min(100, d.required_level * 20)) * (R / 100);
          const mas = Math.max(0, Math.min(100, d.mastery)) * (R / 100);
          const [xReq, yReq] = polar(req, i);
          const [xMas, yMas] = polar(mas, i);
          return (
            <g key={`pts-${i}`}>
              <circle cx={xReq} cy={yReq} r={3} fill="#999" />
              <circle cx={xMas} cy={yMas} r={3} fill="#2196f3" />
              <circle
                cx={xReq}
                cy={yReq}
                r={10}
                fill="transparent"
                onMouseEnter={(e) => showTip(e, d.name, "要求", d.required_level * 20)}
                onMouseMove={(e) => showTip(e, d.name, "要求", d.required_level * 20)}
                onMouseLeave={hideTip}
              />
              <circle
                cx={xMas}
                cy={yMas}
                r={10}
                fill="transparent"
                onMouseEnter={(e) => showTip(e, d.name, "掌握", Math.round(d.mastery))}
                onMouseMove={(e) => showTip(e, d.name, "掌握", Math.round(d.mastery))}
                onMouseLeave={hideTip}
              />
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="tooltip-popup">
          <div>{tip.name}</div>
          <div>
            {tip.label}：{tip.value}
          </div>
        </div>
      )}
    </div>
  );
}
