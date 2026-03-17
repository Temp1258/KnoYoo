import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Button from "../ui/Button";
import DayPopover from "./DayPopover";
import type { PlanTask } from "../../types";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function firstDayOffset(year: number, month: number): number {
  // Monday = 0
  const d = new Date(year, month - 1, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

export default function CalendarView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await tauriInvoke<PlanTask[]>("list_plan_tasks_by_month", {
          year,
          month,
        });
        setTasks(res || []);
      } catch {
        setTasks([]);
      }
    })();
  }, [year, month]);

  const tasksByDay = useMemo(() => {
    const map = new Map<number, PlanTask[]>();
    for (const t of tasks) {
      if (!t.due) continue;
      const day = parseInt(t.due.split("-")[2], 10);
      const arr = map.get(day) || [];
      arr.push(t);
      map.set(day, arr);
    }
    return map;
  }, [tasks]);

  const totalDays = daysInMonth(year, month);
  const offset = firstDayOffset(year, month);
  const todayStr = now.toISOString().slice(0, 10);
  const todayDay = year === now.getFullYear() && month === now.getMonth() + 1 ? now.getDate() : -1;

  function prevMonth() {
    setSelectedDay(null);
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  }

  function nextMonth() {
    setSelectedDay(null);
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={prevMonth}>
          <ChevronLeft size={16} />
        </Button>
        <span className="text-[15px] font-semibold text-text">
          {year}年{month}月
        </span>
        <Button variant="ghost" size="sm" onClick={nextMonth}>
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-[11px] font-medium text-text-tertiary py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {/* Offset blanks */}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`blank-${i}`} className="h-16" />
        ))}

        {Array.from({ length: totalDays }).map((_, i) => {
          const day = i + 1;
          const dayTasks = tasksByDay.get(day) || [];
          const hasTasks = dayTasks.length > 0;
          const isToday = day === todayDay;
          const doneCount = dayTasks.filter((t) => t.status === "DONE").length;
          const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isPast = dateStr < todayStr && !isToday;
          const hasOverdue = dayTasks.some((t) => t.status !== "DONE" && isPast);

          return (
            <button
              key={day}
              onClick={() => setSelectedDay(selectedDay === day ? null : day)}
              className={`h-16 rounded-md flex flex-col items-center justify-start pt-1 transition-colors cursor-pointer ${
                selectedDay === day
                  ? "bg-accent-light border border-accent"
                  : isToday
                    ? "bg-bg-tertiary border border-accent/30"
                    : "hover:bg-bg-tertiary border border-transparent"
              }`}
            >
              <span
                className={`text-[12px] ${
                  isToday ? "font-bold text-accent" : isPast ? "text-text-tertiary" : "text-text"
                }`}
              >
                {day}
              </span>
              {hasTasks && (
                <div className="flex gap-0.5 mt-1 flex-wrap justify-center">
                  {dayTasks.length <= 3 ? (
                    dayTasks.map((t) => (
                      <div
                        key={t.id}
                        className={`w-1.5 h-1.5 rounded-full ${
                          t.status === "DONE"
                            ? "bg-accent"
                            : hasOverdue
                              ? "bg-danger"
                              : "bg-text-tertiary"
                        }`}
                      />
                    ))
                  ) : (
                    <span className="text-[9px] text-text-tertiary">
                      {doneCount}/{dayTasks.length}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Day popover */}
      {selectedDay && (
        <DayPopover
          date={`${year}-${String(month).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`}
          tasks={tasksByDay.get(selectedDay) || []}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}
