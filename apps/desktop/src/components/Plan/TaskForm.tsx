import { useState } from "react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/Toast";
import Card from "../ui/Card";
import Input from "../ui/Input";
import Button from "../ui/Button";

interface Props {
  horizon: string;
  groupId?: number | null;
  parentId?: number | null;
  onAdded: () => void;
}

export default function TaskForm({ horizon, groupId, parentId, onAdded }: Props) {
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [description, setDescription] = useState("");

  async function submit() {
    const t = title.trim();
    if (!t) {
      showToast("标题必填", "error");
      return;
    }
    try {
      await tauriInvoke<number>("add_plan_task", {
        horizon,
        skillId: null,
        title: t,
        minutes: 60,
        due: due || null,
        groupId: groupId ?? null,
        parentId: parentId ?? null,
        description: description.trim() || null,
      });
      setTitle("");
      setDue("");
      setDescription("");
      showToast(parentId ? "子任务已添加" : "计划已添加");
      onAdded();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("新增失败：" + message, "error");
    }
  }

  return (
    <Card padding="sm">
      <div className="space-y-2">
        {parentId && <div className="text-[11px] text-text-tertiary">添加子任务</div>}
        <div className="flex items-center gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={parentId ? "子任务标题..." : "新增计划标题..."}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <Input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="w-36"
          />
          <Button variant="primary" onClick={submit}>
            添加
          </Button>
        </div>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="描述（可选）"
        />
      </div>
    </Card>
  );
}
