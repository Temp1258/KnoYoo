import { useState, useEffect } from "react";
import { Lightbulb } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";

export default function DailyTip() {
  const [tip, setTip] = useState("");

  useEffect(() => {
    tauriInvoke<string>("get_daily_tip").then(setTip).catch(console.error);
  }, []);

  if (!tip) return null;

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-accent/5 border border-accent/15">
      <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
        <Lightbulb size={16} className="text-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-accent font-medium uppercase tracking-wide mb-0.5">
          今日教练寄语
        </div>
        <div className="text-[14px] text-text leading-relaxed">{tip}</div>
      </div>
    </div>
  );
}
