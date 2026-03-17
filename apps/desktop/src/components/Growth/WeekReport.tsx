import { useState } from "react";
import { FileText } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Card from "../ui/Card";
import Button from "../ui/Button";
import type { WeekReport as WeekReportType } from "../../types";

export default function WeekReport() {
  const [weekReport, setWeekReport] = useState<WeekReportType | null>(null);

  const genWeek = async () => {
    const r = await tauriInvoke<WeekReportType>("report_week_summary");
    setWeekReport(r);
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[17px] font-semibold m-0">周报</h3>
        <Button size="sm" onClick={genWeek}>
          <FileText size={13} /> 生成周报
        </Button>
      </div>
      {weekReport ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wide">统计周期</div>
            <div className="text-[14px] font-medium">
              {weekReport.start} → {weekReport.end}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wide">完成任务</div>
            <div className="text-[20px] font-bold text-accent">{weekReport.tasks_done}</div>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wide">学习时间</div>
            <div className="text-[20px] font-bold">
              {weekReport.minutes_done}{" "}
              <span className="text-[13px] font-normal text-text-secondary">分钟</span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wide">新增笔记</div>
            <div className="text-[20px] font-bold">{weekReport.new_notes}</div>
          </div>
        </div>
      ) : (
        <div className="text-[13px] text-text-tertiary py-6 text-center">尚未生成周报</div>
      )}
    </Card>
  );
}
