import { useState, useRef } from "react";
import { Share2, Download, Loader2 } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Button from "../ui/Button";
import type { ShareCardData } from "../../types";

function renderCardSVG(d: ShareCardData): string {
  const w = 480;
  const h = 320;
  const pct = Math.round(d.avg_progress * 100);
  const hours = (d.total_minutes / 60).toFixed(1);
  const skills = d.top_skills.slice(0, 4).join(" · ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0071e3"/>
        <stop offset="100%" stop-color="#5856d6"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" rx="16" fill="url(#bg)"/>
    <!-- Logo -->
    <rect x="24" y="24" width="36" height="36" rx="8" fill="rgba(255,255,255,0.2)"/>
    <text x="42" y="48" font-family="Inter,system-ui,sans-serif" font-size="18" font-weight="700" fill="white" text-anchor="middle">K</text>
    <text x="68" y="48" font-family="Inter,system-ui,sans-serif" font-size="14" font-weight="600" fill="rgba(255,255,255,0.8)">KnoYoo</text>
    <!-- Date -->
    <text x="${w - 24}" y="45" font-family="Inter,system-ui,sans-serif" font-size="11" fill="rgba(255,255,255,0.6)" text-anchor="end">${d.date}</text>
    <!-- Career Goal -->
    <text x="24" y="90" font-family="Inter,system-ui,sans-serif" font-size="20" font-weight="700" fill="white">${escapeXml(d.career_goal || "成长中...")}</text>
    <!-- Stats Row -->
    <text x="24" y="130" font-family="Inter,system-ui,sans-serif" font-size="11" fill="rgba(255,255,255,0.6)" letter-spacing="0.5">连续学习</text>
    <text x="24" y="158" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="700" fill="white">${d.current_streak}</text>
    <text x="60" y="158" font-family="Inter,system-ui,sans-serif" font-size="13" fill="rgba(255,255,255,0.7)">天</text>

    <text x="130" y="130" font-family="Inter,system-ui,sans-serif" font-size="11" fill="rgba(255,255,255,0.6)" letter-spacing="0.5">完成任务</text>
    <text x="130" y="158" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="700" fill="white">${d.total_tasks_done}</text>

    <text x="240" y="130" font-family="Inter,system-ui,sans-serif" font-size="11" fill="rgba(255,255,255,0.6)" letter-spacing="0.5">学习时长</text>
    <text x="240" y="158" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="700" fill="white">${hours}</text>
    <text x="${240 + String(hours).length * 16}" y="158" font-family="Inter,system-ui,sans-serif" font-size="13" fill="rgba(255,255,255,0.7)">h</text>

    <text x="370" y="130" font-family="Inter,system-ui,sans-serif" font-size="11" fill="rgba(255,255,255,0.6)" letter-spacing="0.5">笔记</text>
    <text x="370" y="158" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="700" fill="white">${d.total_notes}</text>

    <!-- Progress bar -->
    <text x="24" y="200" font-family="Inter,system-ui,sans-serif" font-size="11" fill="rgba(255,255,255,0.6)">技能掌握进度 ${pct}%</text>
    <rect x="24" y="210" width="${w - 48}" height="6" rx="3" fill="rgba(255,255,255,0.15)"/>
    <rect x="24" y="210" width="${Math.round((w - 48) * d.avg_progress)}" height="6" rx="3" fill="rgba(255,255,255,0.8)"/>

    <!-- Top skills -->
    <text x="24" y="250" font-family="Inter,system-ui,sans-serif" font-size="11" fill="rgba(255,255,255,0.5)">核心技能</text>
    <text x="24" y="270" font-family="Inter,system-ui,sans-serif" font-size="13" fill="rgba(255,255,255,0.85)">${escapeXml(skills)}</text>

    <!-- Footer -->
    <text x="${w / 2}" y="${h - 16}" font-family="Inter,system-ui,sans-serif" font-size="10" fill="rgba(255,255,255,0.35)" text-anchor="middle">KnoYoo AI 成长教练 · 用数据驱动职业成长</text>
  </svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default function ShareCard() {
  const [data, setData] = useState<ShareCardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const generate = async () => {
    setLoading(true);
    try {
      const d = await tauriInvoke<ShareCardData>("get_share_card_data");
      setData(d);
      setShowPreview(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const downloadPng = () => {
    if (!data) return;
    const svg = renderCardSVG(data);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = 960;
      canvas.height = 640;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 960, 640);
      URL.revokeObjectURL(url);

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        const pngUrl = URL.createObjectURL(pngBlob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = `KnoYoo-Growth-${data.date}.png`;
        a.click();
        URL.revokeObjectURL(pngUrl);
      }, "image/png");
    };
    img.src = url;
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={generate} disabled={loading}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
          生成成长卡片
        </Button>
        {showPreview && data && (
          <Button size="sm" variant="primary" onClick={downloadPng}>
            <Download size={13} /> 下载 PNG
          </Button>
        )}
      </div>

      {showPreview && data && (
        <div className="mt-3 rounded-xl overflow-hidden border border-border shadow-sm">
          <div dangerouslySetInnerHTML={{ __html: renderCardSVG(data) }} />
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
