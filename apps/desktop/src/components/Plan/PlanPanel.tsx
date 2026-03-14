import { useState, useEffect } from "react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/Toast";
import type { PlanTask } from "../../types";

export default function PlanPanel() {
  const { showToast, showConfirm } = useToast();
  const [horizon] = useState<"WEEK" | "QTR">("WEEK");
  const [onlyTodo, setOnlyTodo] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [editId, setEditId] = useState<number | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eMinutes, setEMinutes] = useState("");
  const [eDue, setEDue] = useState("");

  const [newTitle, setNewTitle] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [showAddPlan, setShowAddPlan] = useState(false);

  const todayStr = () => new Date().toISOString().slice(0, 10);
  const isOverdue = (t: PlanTask) => t.due != null && t.status !== "DONE" && t.due < todayStr();

  async function load(preserveMsg = false) {
    setLoading(true);
    if (!preserveMsg) setMsg("");
    try {
      const args = onlyTodo ? { horizon, status: "TODO" } : { horizon };
      const res = (await tauriInvoke("list_plan_tasks", args)) as PlanTask[];
      const sorted = [...res].sort((a, b) => {
        const aOver = isOverdue(a),
          bOver = isOverdue(b);
        if (aOver !== bOver) return aOver ? -1 : 1;
        if (a.status !== b.status) return a.status === "DONE" ? 1 : -1;
        const ad = a.due ?? "9999-12-31";
        const bd = b.due ?? "9999-12-31";
        return ad.localeCompare(bd);
      });
      setTasks(sorted);
    } catch (e: any) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [horizon, onlyTodo]);

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
    setEMinutes(String(t.minutes ?? 0));
    setEDue(t.due ?? "");
  }
  function cancelEdit() {
    setEditId(null);
    setETitle("");
    setEMinutes("");
    setEDue("");
  }
  async function saveEdit(id: number) {
    const minutes = Number.parseInt(eMinutes || "0", 10);
    const due = eDue.trim() === "" ? null : eDue.trim();
    await tauriInvoke("update_plan_task", { id, title: eTitle, minutes, due });
    cancelEdit();
    await load();
  }

  async function onAddPlanQuick() {
    const t = newTitle.trim();
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
        due: newEnd || null,
      });
      setNewTitle("");
      setNewStart("");
      setNewEnd("");
      await load();
      showToast("计划已添加");
    } catch (e: any) {
      showToast("新增失败：" + String(e), "error");
    }
  }

  function renderRow(t: PlanTask) {
    const editing = editId === t.id;
    return (
      <li key={t.id} className="plan-task-row">
        <input type="checkbox" checked={t.status === "DONE"} onChange={() => toggle(t)} />
        <div>
          {!editing ? (
            <>
              <div className={`plan-task-title ${t.status === "DONE" ? "done" : ""}`}>{t.title}</div>
              <div className="plan-task-meta">
                {t.due ? (
                  <>
                    {"截止日期: "}
                    <span className={isOverdue(t) ? "overdue" : ""}>{t.due}</span>
                  </>
                ) : (
                  ""
                )}
                {typeof t.skill_id === "number" ? ` · skill: ${t.skill_id}` : ""}
              </div>
            </>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <input
                value={eTitle}
                onChange={(e) => setETitle(e.target.value)}
                placeholder="标题"
                className="input"
              />
              <input
                type="date"
                value={eDue}
                onChange={(e) => setEDue(e.target.value)}
                className="input"
              />
            </div>
          )}
        </div>
        <span className="plan-task-horizon">{t.horizon}</span>
        <div className="plan-task-actions">
          {!editing ? (
            <>
              <button className="btn" onClick={() => startEdit(t)}>编辑</button>
              <button className="btn" onClick={() => del(t)}>删除</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => saveEdit(t.id)}>保存</button>
              <button className="btn" onClick={cancelEdit}>取消</button>
            </>
          )}
        </div>
      </li>
    );
  }

  function groupTasks(list: PlanTask[]): Array<[string, PlanTask[]]> {
    const today = new Date().toISOString().slice(0, 10);
    const endOfWeek = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    const buckets: Record<string, PlanTask[]> = {
      overdue: [],
      today: [],
      week: [],
      later: [],
      nodue: [],
      done: [],
    };

    for (const t of list) {
      if (t.status === "DONE") { buckets.done.push(t); continue; }
      if (!t.due) { buckets.nodue.push(t); continue; }
      if (t.due < today) buckets.overdue.push(t);
      else if (t.due === today) buckets.today.push(t);
      else if (t.due <= endOfWeek) buckets.week.push(t);
      else buckets.later.push(t);
    }

    const order: Array<[keyof typeof buckets, string]> = [
      ["overdue", "逾期"],
      ["today", "今天"],
      ["week", "本周"],
      ["later", "以后"],
      ["nodue", "无截止"],
      ["done", "已完成"],
    ];

    return order
      .filter(([k]) => !(onlyTodo && k === "done"))
      .map(([k, label]) => [label, buckets[k]]);
  }

  return (
    <div className="plan-panel">
      <div className="plan-filters">
        <label className="filter-label">
          <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} /> 只看未完成
        </label>
        <label className="filter-label">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> 分组显示
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
        <button className="btn" onClick={() => setShowAddPlan((v) => !v)}>
          {showAddPlan ? "收起" : "+计划"}
        </button>
      </div>

      {showAddPlan && (
        <div className="plan-add-form">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="新增计划标题..."
            className="input"
            style={{ width: 240 }}
          />
          <input
            type="date"
            value={newStart}
            onChange={(e) => setNewStart(e.target.value)}
            className="input"
          />
          <input
            type="date"
            value={newEnd}
            onChange={(e) => setNewEnd(e.target.value)}
            className="input"
          />
          <button className="btn" onClick={onAddPlanQuick}>添加计划</button>
        </div>
      )}

      {msg && <div className="plan-msg">{msg}</div>}

      {loading ? (
        <div>Loading...</div>
      ) : grouped ? (
        <>
          {groupTasks(tasks).map(([label, items]) =>
            items.length === 0 ? null : (
              <div key={label} style={{ marginBottom: 12 }}>
                <div className="plan-group-label">
                  {label} · {items.length}
                </div>
                <ul className="plan-task-list">
                  {items.map((t) => renderRow(t))}
                </ul>
              </div>
            )
          )}
          {tasks.length === 0 && <div className="plan-empty">暂无任务</div>}
        </>
      ) : (
        <ul className="plan-task-list">
          {tasks.map((t) => renderRow(t))}
          {tasks.length === 0 && <li className="plan-empty">暂无任务</li>}
        </ul>
      )}
    </div>
  );
}
