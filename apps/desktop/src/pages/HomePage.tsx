import { useState } from "react";
import PlanPanel from "../components/Plan/PlanPanel";
import CalendarView from "../components/Plan/CalendarView";
import AISettingsPanel from "../components/AI/AISettingsPanel";
import { useAIConfig } from "../hooks/useAIConfig";
import { Settings, ChevronDown, ChevronUp } from "lucide-react";
import Button from "../components/ui/Button";
import SegmentedControl from "../components/ui/SegmentedControl";

export default function HomePage() {
  const [showAISettings, setShowAISettings] = useState(false);
  const [view, setView] = useState<"list" | "calendar">("list");
  const { loadConfig } = useAIConfig();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-[28px] font-bold tracking-tight m-0">计划</h1>
          <SegmentedControl
            options={[
              { value: "list" as const, label: "列表" },
              { value: "calendar" as const, label: "日历" },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            setShowAISettings((v) => !v);
            if (!showAISettings) await loadConfig();
          }}
        >
          <Settings size={14} />
          {showAISettings ? "收起设置" : "AI 设置"}
          {showAISettings ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </Button>
      </div>

      {showAISettings && (
        <div className="mb-6">
          <AISettingsPanel />
        </div>
      )}

      {view === "list" ? <PlanPanel /> : <CalendarView />}
    </div>
  );
}
