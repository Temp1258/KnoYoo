import { useState, useEffect, useMemo } from "react";
import { Plus, FolderPlus } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/Toast";
import TaskRow from "./TaskRow";
import TaskForm from "./TaskForm";
import PlanGroupHeader from "./PlanGroupHeader";
import SegmentedControl from "../ui/SegmentedControl";
import Button from "../ui/Button";
import Card from "../ui/Card";
import type { PlanTask, PlanGroup } from "../../types";

export default function PlanPanel() {
  const { showConfirm, showToast, showPrompt } = useToast();
  const [horizon] = useState<"WEEK" | "QTR">("WEEK");
  const [filter, setFilter] = useState<"all" | "todo" | "done">("all");
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [groups, setGroups] = useState<PlanGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addParentId, setAddParentId] = useState<number | null>(null);
  const [addGroupId, setAddGroupId] = useState<number | null>(null);

  const [editId, setEditId] = useState<number | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eDue, setEDue] = useState("");

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const todayStr = () => new Date().toISOString().slice(0, 10);
  const isOverdue = (t: PlanTask) => t.due != null && t.status !== "DONE" && t.due < todayStr();

  async function loadGroups() {
    try {
      const res = await tauriInvoke<PlanGroup[]>("list_plan_groups");
      setGroups(res || []);
    } catch {
      /* ignore */
    }
  }

  async function load(preserveMsg = false) {
    setLoading(true);
    if (!preserveMsg) setMsg("");
    try {
      const onlyTodo = filter === "todo";
      const args = onlyTodo ? { horizon, status: "TODO" } : { horizon };
      const res = (await tauriInvoke("list_plan_tasks", args)) as PlanTask[];
      let filtered = res;
      if (filter === "done") filtered = res.filter((t) => t.status === "DONE");
      const sorted = [...filtered].sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        const aOver = isOverdue(a),
          bOver = isOverdue(b);
        if (aOver !== bOver) return aOver ? -1 : 1;
        if (a.status !== b.status) return a.status === "DONE" ? 1 : -1;
        const ad = a.due ?? "9999-12-31";
        const bd = b.due ?? "9999-12-31";
        return ad.localeCompare(bd);
      });
      setTasks(sorted);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setMsg(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    loadGroups();
  }, [horizon, filter]);

  async function toggle(t: PlanTask) {
    const next = t.status === "DONE" ? "TODO" : "DONE";
    await tauriInvoke("update_plan_status", { id: t.id, status: next });
    await load();
  }

  async function del(t: PlanTask) {
    const ok = await showConfirm("确认删除这个任务？");
    if (!ok) return;
    await tauriInvoke("delete_plan_task", { id: t.id });
    await load();
  }

  function startEdit(t: PlanTask) {
    setEditId(t.id);
    setETitle(t.title);
    setEDue(t.due ?? "");
  }

  function cancelEdit() {
    setEditId(null);
    setETitle("");
    setEDue("");
  }

  async function saveEdit(id: number) {
    const due = eDue.trim() === "" ? null : eDue.trim();
    await tauriInvoke("update_plan_task", {
      id,
      title: eTitle,
      minutes: 60,
      due,
    });
    cancelEdit();
    await load();
  }

  async function createGroup() {
    const name = await showPrompt("输入分组名称：");
    if (!name?.trim()) return;
    try {
      await tauriInvoke<PlanGroup>("create_plan_group", {
        name: name.trim(),
        color: null,
      });
      await loadGroups();
      showToast("分组已创建");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("创建失败: " + message, "error");
    }
  }

  function toggleGroupCollapse(gid: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }

  // Build hierarchy: group tasks by group_id, then parent/child
  const { groupedData, ungroupedTasks } = useMemo(() => {
    const topLevel = tasks.filter((t) => t.parent_id == null);
    const childMap = new Map<number, PlanTask[]>();
    for (const t of tasks) {
      if (t.parent_id != null) {
        const arr = childMap.get(t.parent_id) || [];
        arr.push(t);
        childMap.set(t.parent_id, arr);
      }
    }

    const byGroup = new Map<number, PlanTask[]>();
    const ungrouped: PlanTask[] = [];
    for (const t of topLevel) {
      if (t.group_id != null) {
        const arr = byGroup.get(t.group_id) || [];
        arr.push(t);
        byGroup.set(t.group_id, arr);
      } else {
        ungrouped.push(t);
      }
    }

    return {
      groupedData: { byGroup, childMap },
      ungroupedTasks: ungrouped,
    };
  }, [tasks]);

  function renderTask(t: PlanTask, indent = 0) {
    const children = groupedData.childMap.get(t.id) || [];
    const hasChildren = children.length > 0;
    const doneChildren = children.filter((c) => c.status === "DONE").length;

    return (
      <div key={t.id}>
        <div style={{ paddingLeft: indent * 20 }}>
          <TaskRow
            task={t}
            isOverdue={isOverdue(t)}
            editing={editId === t.id}
            eTitle={eTitle}
            eDue={eDue}
            onToggle={() => toggle(t)}
            onEdit={() => startEdit(t)}
            onDelete={() => del(t)}
            onSaveEdit={() => saveEdit(t.id)}
            onCancelEdit={cancelEdit}
            onETitle={setETitle}
            onEDue={setEDue}
            hasChildren={hasChildren}
            childProgress={hasChildren ? `${doneChildren}/${children.length}` : undefined}
            onAddChild={() => {
              setAddParentId(t.id);
              setAddGroupId(t.group_id);
              setShowAdd(true);
            }}
          />
        </div>
        {children.map((c) => renderTask(c, indent + 1))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <SegmentedControl
          options={[
            { value: "all" as const, label: "全部" },
            { value: "todo" as const, label: "未完成" },
            { value: "done" as const, label: "已完成" },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={createGroup}>
            <FolderPlus size={14} />
            分组
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setAddParentId(null);
              setAddGroupId(null);
              setShowAdd((v) => !v);
            }}
          >
            <Plus size={14} />
            新增
          </Button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <TaskForm
          horizon={horizon}
          groupId={addGroupId}
          parentId={addParentId}
          onAdded={() => {
            setShowAdd(false);
            setAddParentId(null);
            setAddGroupId(null);
            load();
          }}
        />
      )}

      {msg && <div className="text-[13px] text-danger px-1">{msg}</div>}

      {/* Task list */}
      {loading ? (
        <div className="text-[13px] text-text-secondary py-8 text-center">加载中...</div>
      ) : (
        <div className="space-y-3">
          {/* Grouped tasks */}
          {groups.map((g) => {
            const groupTasks = groupedData.byGroup.get(g.id) || [];
            const allInGroup = tasks.filter(
              (t) => t.group_id === g.id || groupTasks.some((gt) => gt.id === t.parent_id),
            );
            const doneCount = allInGroup.filter((t) => t.status === "DONE").length;
            const isExpanded = !collapsed.has(g.id);

            return (
              <div key={g.id}>
                <Card padding="sm">
                  <PlanGroupHeader
                    group={g}
                    expanded={isExpanded}
                    taskCount={allInGroup.length}
                    doneCount={doneCount}
                    onToggle={() => toggleGroupCollapse(g.id)}
                    onChanged={() => {
                      loadGroups();
                      load();
                    }}
                  />
                  {isExpanded && groupTasks.length > 0 && (
                    <div className="divide-y divide-border border-t border-border">
                      {groupTasks.map((t) => renderTask(t))}
                    </div>
                  )}
                </Card>
              </div>
            );
          })}

          {/* Ungrouped tasks */}
          {ungroupedTasks.length > 0 && (
            <div>
              {groups.length > 0 && (
                <div className="text-[12px] font-medium text-text-secondary uppercase tracking-wide mb-2 px-1">
                  未分组
                </div>
              )}
              <Card padding="sm" className="divide-y divide-border">
                {ungroupedTasks.map((t) => renderTask(t))}
              </Card>
            </div>
          )}

          {tasks.length === 0 && (
            <div className="text-[13px] text-text-tertiary py-12 text-center">暂无任务</div>
          )}
        </div>
      )}
    </div>
  );
}
