import { useState } from "react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { WeekReport as WeekReportType } from "../../types";

export default function WeekReport() {
  const [weekReport, setWeekReport] = useState<WeekReportType | null>(null);

  const genWeek = async () => {
    const r = await tauriInvoke<WeekReportType>("report_week_summary");
    setWeekReport(r);
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>周报</h3>
        <button className="btn" onClick={genWeek}>
          生成周报
        </button>
      </div>
      {weekReport ? (
        <div style={{ marginTop: 12 }}>
          <div>
            统计周期：{weekReport.start} → {weekReport.end}
          </div>
          <div>完成任务：{weekReport.tasks_done}</div>
          <div>学习时间：{weekReport.minutes_done} 分钟</div>
          <div>新增笔记：{weekReport.new_notes}</div>
          <div>平均掌握度：{weekReport.avg_mastery.toFixed(1)}</div>
          <div style={{ marginTop: 8 }}>
            <strong>主要差距：</strong>
            <ul>
              {weekReport.top_gaps.map(([name, required, mastery, gap], idx) => (
                <li key={idx}>
                  {name}：要求{required}，掌握{mastery}，差距{gap}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12, color: "#888" }}>尚未生成周报</div>
      )}
    </div>
  );
}
