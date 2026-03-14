import { useState } from "react";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import RadarPanel from "../components/Growth/RadarPanel";
import ContributionsCard from "../components/Growth/ContributionsCard";
import WeekReportCard from "../components/Growth/WeekReport";

export default function GrowthPage() {
  const [radarTick, setRadarTick] = useState(0);
  const [loadingRadar, setLoadingRadar] = useState(false);

  return (
    <div>
      <h2>我的成长</h2>
      <WeekReportCard />
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>能力雷达图</h3>
          <button
            className="btn"
            onClick={async () => {
              setLoadingRadar(true);
              try {
                await tauriInvoke("ai_analyze_topics");
                setRadarTick((v) => v + 1);
              } catch (e) {
                console.error(e);
              } finally {
                setLoadingRadar(false);
              }
            }}
            disabled={loadingRadar}
          >
            {loadingRadar ? "刷新中..." : "刷新雷达"}
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <RadarPanel reloadKey={radarTick} />
        </div>
      </div>
      <ContributionsCard />
    </div>
  );
}
