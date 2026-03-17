import { useState, useEffect } from "react";
import { Flame, Trophy, Calendar } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Card from "../ui/Card";
import type { StreakInfo } from "../../types";

export default function StreakCard() {
  const [streak, setStreak] = useState<StreakInfo | null>(null);

  useEffect(() => {
    // Record activity on page visit, then load streak
    tauriInvoke("record_activity")
      .then(() => tauriInvoke<StreakInfo>("get_streak_info"))
      .then(setStreak)
      .catch(console.error);
  }, []);

  if (!streak) return null;

  return (
    <Card>
      <div className="flex items-center gap-4">
        {/* Streak flame */}
        <div
          className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
            streak.current_streak >= 7
              ? "bg-orange-500/10"
              : streak.current_streak > 0
                ? "bg-amber-500/10"
                : "bg-bg-tertiary"
          }`}
        >
          <Flame
            size={28}
            className={
              streak.current_streak >= 7
                ? "text-orange-500"
                : streak.current_streak > 0
                  ? "text-amber-500"
                  : "text-text-tertiary"
            }
          />
        </div>

        {/* Main streak number */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[32px] font-bold text-text leading-none">
              {streak.current_streak}
            </span>
            <span className="text-[14px] text-text-secondary">天连续学习</span>
          </div>
          {!streak.active_today && streak.current_streak > 0 && (
            <div className="text-[12px] text-amber-500 mt-1">
              今天还没有学习记录，别断了连续哦!
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="flex gap-4 shrink-0">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-text-tertiary mb-0.5">
              <Trophy size={12} />
              <span className="text-[10px] uppercase tracking-wide">最长</span>
            </div>
            <div className="text-[18px] font-bold text-text">{streak.best_streak}</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-text-tertiary mb-0.5">
              <Calendar size={12} />
              <span className="text-[10px] uppercase tracking-wide">总天数</span>
            </div>
            <div className="text-[18px] font-bold text-text">{streak.total_active_days}</div>
          </div>
        </div>
      </div>
    </Card>
  );
}
