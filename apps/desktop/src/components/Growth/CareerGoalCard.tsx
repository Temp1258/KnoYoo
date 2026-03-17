import { useState, useEffect } from "react";
import { Target, Pencil, Check } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Card from "../ui/Card";
import Input from "../ui/Input";

export default function CareerGoalCard() {
  const [goal, setGoal] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    tauriInvoke<string>("get_career_goal").then((g) => {
      if (g) setGoal(g);
    }).catch(console.error);
  }, []);

  const save = async () => {
    const trimmed = draft.trim();
    if (trimmed) {
      await tauriInvoke("set_career_goal", { goal: trimmed });
      setGoal(trimmed);
    }
    setEditing(false);
  };

  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
          <Target size={20} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-text-tertiary uppercase tracking-wide mb-0.5">我的职业目标</div>
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                placeholder="描述你的职业目标..."
                autoFocus
              />
              <button
                onClick={save}
                className="p-1.5 rounded-md text-accent hover:bg-accent/10 transition-colors cursor-pointer"
              >
                <Check size={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[16px] font-semibold text-text">
                {goal || "未设置"}
              </span>
              <button
                onClick={() => { setDraft(goal); setEditing(true); }}
                className="p-1 rounded-md text-text-tertiary hover:text-text hover:bg-bg-tertiary transition-colors cursor-pointer"
              >
                <Pencil size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
