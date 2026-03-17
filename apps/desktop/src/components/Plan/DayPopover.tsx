import { X, Check } from "lucide-react";
import Badge from "../ui/Badge";
import Card from "../ui/Card";
import type { PlanTask } from "../../types";

interface Props {
  date: string;
  tasks: PlanTask[];
  onClose: () => void;
}

export default function DayPopover({ date, tasks, onClose }: Props) {
  return (
    <Card padding="sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold text-text">{date}</span>
        <button
          onClick={onClose}
          className="p-1 rounded text-text-tertiary hover:text-text hover:bg-bg-tertiary cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
      {tasks.length === 0 ? (
        <div className="text-[12px] text-text-tertiary py-2">当天没有任务</div>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <div
                className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                  t.status === "DONE" ? "bg-accent border-accent" : "border-border"
                }`}
              >
                {t.status === "DONE" && <Check size={9} className="text-white" strokeWidth={3} />}
              </div>
              <span
                className={`text-[12px] truncate ${
                  t.status === "DONE" ? "line-through text-text-tertiary" : "text-text"
                }`}
              >
                {t.title}
              </span>
              {t.status !== "DONE" && t.minutes > 0 && (
                <Badge variant="default">{t.minutes}min</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
