import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2, Check, X } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/Toast";
import Input from "../ui/Input";
import type { PlanGroup } from "../../types";

const GROUP_COLORS = ["#0071e3", "#34c759", "#ff9500", "#ff3b30", "#af52de", "#5ac8fa"];

interface Props {
  group: PlanGroup;
  expanded: boolean;
  taskCount: number;
  doneCount: number;
  onToggle: () => void;
  onChanged: () => void;
}

export default function PlanGroupHeader({
  group,
  expanded,
  taskCount,
  doneCount,
  onToggle,
  onChanged,
}: Props) {
  const { showToast, showConfirm } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState(group.color || GROUP_COLORS[0]);

  const save = async () => {
    if (!name.trim()) return;
    try {
      await tauriInvoke("update_plan_group", {
        id: group.id,
        name: name.trim(),
        color,
      });
      setEditing(false);
      onChanged();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("更新分组失败: " + message, "error");
    }
  };

  const del = async () => {
    const ok = await showConfirm(`确认删除分组"${group.name}"？（任务不会被删除）`);
    if (!ok) return;
    try {
      await tauriInvoke("delete_plan_group", { id: group.id });
      onChanged();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("删除分组失败: " + message, "error");
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 py-2 px-3">
        <div className="flex gap-1">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              className={`w-4 h-4 rounded-full cursor-pointer border-2 ${
                color === c ? "border-text" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <button
          onClick={save}
          className="p-1 rounded text-accent hover:bg-bg-tertiary cursor-pointer"
        >
          <Check size={14} />
        </button>
        <button
          onClick={() => setEditing(false)}
          className="p-1 rounded text-text-tertiary hover:bg-bg-tertiary cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-2 px-3 group cursor-pointer" onClick={onToggle}>
      <div
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: group.color || GROUP_COLORS[0] }}
      />
      {expanded ? (
        <ChevronDown size={14} className="text-text-secondary" />
      ) : (
        <ChevronRight size={14} className="text-text-secondary" />
      )}
      <span className="text-[13px] font-semibold text-text flex-1">{group.name}</span>
      <span className="text-[11px] text-text-tertiary">
        {doneCount}/{taskCount}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="p-1 rounded text-text-tertiary hover:text-text hover:bg-bg-tertiary cursor-pointer"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            del();
          }}
          className="p-1 rounded text-text-tertiary hover:text-danger hover:bg-bg-tertiary cursor-pointer"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
