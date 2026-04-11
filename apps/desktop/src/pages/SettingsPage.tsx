import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import SegmentedControl from "../components/ui/SegmentedControl";
import AISettingsPanel from "../components/AI/AISettingsPanel";

type Tab = "ai" | "display" | "about";

const TABS = [
  { value: "ai" as Tab, label: "AI 配置" },
  { value: "display" as Tab, label: "显示" },
  { value: "about" as Tab, label: "关于" },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("ai");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("knoyoo-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight mb-4">设置</h1>

      <SegmentedControl options={TABS} value={tab} onChange={setTab} className="mb-6" />

      {tab === "ai" && <AISettingsPanel />}

      {tab === "display" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-bg-secondary border border-border">
            <div>
              <div className="text-[14px] font-medium text-text">主题</div>
              <div className="text-[12px] text-text-tertiary mt-0.5">切换亮色或暗色模式</div>
            </div>
            <button
              onClick={() => setDark((d) => !d)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-[12px] text-text-secondary hover:border-accent/30 transition-colors cursor-pointer"
            >
              {dark ? <Moon size={14} /> : <Sun size={14} />}
              {dark ? "暗色" : "亮色"}
            </button>
          </div>
        </div>
      )}

      {tab === "about" && (
        <div className="space-y-3">
          <div className="p-4 rounded-xl bg-bg-secondary border border-border">
            <div className="text-[14px] font-medium text-text mb-3">KnoYoo</div>
            <div className="space-y-2 text-[12px] text-text-secondary">
              <div className="flex justify-between">
                <span>版本</span>
                <span className="text-text-tertiary">0.3.0</span>
              </div>
              <div className="flex justify-between">
                <span>技术栈</span>
                <span className="text-text-tertiary">Tauri + React + SQLite</span>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-text-tertiary text-center">
            专注于将浏览内容转化为个人知识
          </p>
        </div>
      )}
    </div>
  );
}
