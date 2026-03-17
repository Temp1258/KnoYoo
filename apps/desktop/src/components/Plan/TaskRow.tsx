import { Pencil, Trash2, Check, X, Plus } from "lucide-react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Badge from "../ui/Badge";
import type { PlanTask } from "../../types";

interface Props {
  task: PlanTask;
  isOverdue: boolean;
  editing: boolean;
  eTitle: string;
  eDue: string;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onETitle: (v: string) => void;
  onEDue: (v: string) => void;
  hasChildren?: boolean;
  childProgress?: string;
  onAddChild?: () => void;
}

export default function TaskRow({
  task,
  isOverdue,
  editing,
  eTitle,
  eDue,
  onToggle,
  onEdit,
  onDelete,
  onSaveEdit,
  onCancelEdit,
  onETitle,
  onEDue,
  hasChildren,
  childProgress,
  onAddChild,
}: Props) {
  const done = task.status === "DONE";

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 group">
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
          done ? "bg-accent border-accent" : "border-border hover:border-accent"
        }`}
      >
        {done && <Check size={11} className="text-white" strokeWidth={3} />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {!editing ? (
          <>
            <div className="flex items-center gap-2">
              <span
                className={`text-[13px] leading-snug truncate ${
                  done ? "line-through text-text-tertiary" : "text-text"
                } ${hasChildren ? "font-medium" : ""}`}
              >
                {task.title}
              </span>
              {childProgress && <Badge variant="default">{childProgress}</Badge>}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {task.due && <Badge variant={isOverdue ? "danger" : "default"}>{task.due}</Badge>}
              {task.description && (
                <span className="text-[11px] text-text-tertiary truncate max-w-[200px]">
                  {task.description}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex gap-2">
            <Input
              value={eTitle}
              onChange={(e) => onETitle(e.target.value)}
              placeholder="标题"
              className="flex-1"
            />
            <Input
              type="date"
              value={eDue}
              onChange={(e) => onEDue(e.target.value)}
              className="w-36"
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {!editing ? (
          <>
            {onAddChild && (
              <Button variant="ghost" size="sm" onClick={onAddChild} title="添加子任务">
                <Plus size={13} />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil size={13} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 size={13} />
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={onSaveEdit}>
              <Check size={13} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancelEdit}>
              <X size={13} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
