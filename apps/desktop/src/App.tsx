import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hello } from "@knoyoo/shared";

// 给控制台用的临时桥
declare global {
  interface Window {
    tauriInvoke?: (cmd: string, args?: any) => Promise<any>;
  }
}
window.tauriInvoke = (cmd, args) => invoke(cmd, args);


type Hit = { id: number; title: string; snippet: string };
type Note = { id: number; title: string; content: string; created_at: string };

function DebugCounts() {
  const [msg, setMsg] = useState<string>("");

  async function handleClick() {
    try {
      const res = await invoke("debug_counts") as {industry:number; growth:number; plans:number};
      setMsg(`industry=${res.industry}, growth=${res.growth}, plans=${res.plans}`);
      alert(msg || JSON.stringify(res));
    } catch (e:any) {
      setMsg(String(e));
      alert(String(e));
      console.error(e);
    }
  }

  return (
    <div style={{marginTop: 12}}>
      <button onClick={handleClick}>Debug counts</button>
      {msg && <div style={{marginTop: 8}}>{msg}</div>}
    </div>
  );
}

type SkillGapRow = { name: string; required_level: number; mastery: number; gap: number };

function RadarPanel() {
  const [data, setData] = useState<SkillGapRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; html: string } | null>(null);

  function showTip(e: React.MouseEvent, html: string) {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left + 8, y: e.clientY - r.top + 8, html });
  }
  function hideTip() { setTip(null); }

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const res = (await invoke("list_skill_gaps", { limit: 8 })) as SkillGapRow[];
      setData(res);
    } catch (e: any) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // 简单雷达：把 required_level(1~5) 映射到 0~100（*20），mastery 已经是 0~100
  const N = Math.max(3, data.length);
  const cx = 140, cy = 140, R = 110;

  function polar(r: number, i: number) {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / N;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  }

  const reqPoints = data.map((d, i) => {
    const r = Math.max(0, Math.min(100, d.required_level * 20)) * (R / 100);
    const [x, y] = polar(r, i);
    return `${x},${y}`;
  }).join(" ");

  const masPoints = data.map((d, i) => {
    const r = Math.max(0, Math.min(100, d.mastery)) * (R / 100);
    const [x, y] = polar(r, i);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div ref={wrapRef} style={{ position: "relative", width: 280, height: 280 }}>
      <svg width={280} height={280} viewBox="0 0 280 280">
        {/* 圆环网格 */}
        {[0.25, 0.5, 0.75, 1].map((p, idx) => (
          <circle key={idx} cx={cx} cy={cy} r={R * p} fill="none" stroke="#eee" />
        ))}
        {/* 轴线 + 标签 */}
        {data.map((d, i) => {
          const [x, y] = polar(R, i);
          const [lx, ly] = polar(R + 16, i);
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="#eee" />
              <text x={lx} y={ly} fontSize={10} textAnchor="middle" dominantBaseline="middle">
                {d.name}
              </text>
            </g>
          );
        })}
        {/* required 多边形（半透明边框） */}
        {data.length >= 3 && (
          <polygon points={reqPoints} fill="none" stroke="#999" strokeDasharray="4 3" />
        )}
        {/* mastery 多边形（实心） */}
        {data.length >= 3 && (
          <polygon points={masPoints} fill="rgba(33,150,243,0.25)" stroke="#2196f3" />
        )}
        {/* 中心点 */}
        <circle cx={cx} cy={cy} r={2} fill="#999" />
        {/* 交互圆点和透明命中圈 */}
        {data.map((d, i) => {
          const req = Math.max(0, Math.min(100, d.required_level * 20)) * (R / 100);
          const mas = Math.max(0, Math.min(100, d.mastery)) * (R / 100);
          const [xReq, yReq] = polar(req, i);
          const [xMas, yMas] = polar(mas, i);
          const tipReq = `${d.name}<br/>要求：${d.required_level * 20}`;
          const tipMas = `${d.name}<br/>掌握：${Math.round(d.mastery)}`;
          return (
            <g key={`pts-${i}`}>
              <circle cx={xReq} cy={yReq} r={3} fill="#999" />
              <circle cx={xMas} cy={yMas} r={3} fill="#2196f3" />
              <circle
                cx={xReq} cy={yReq} r={10} fill="transparent"
                onMouseEnter={(e) => showTip(e, tipReq)}
                onMouseMove={(e) => showTip(e, tipReq)}
                onMouseLeave={hideTip}
              />
              <circle
                cx={xMas} cy={yMas} r={10} fill="transparent"
                onMouseEnter={(e) => showTip(e, tipMas)}
                onMouseMove={(e) => showTip(e, tipMas)}
                onMouseLeave={hideTip}
              />
            </g>
          );
        })}
      </svg>
      {tip && (
        <div
          style={{
            position: "absolute",
            left: tip.x, top: tip.y,
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            fontSize: 12,
            padding: "6px 8px",
            borderRadius: 6,
            pointerEvents: "none",
            maxWidth: 180,
            lineHeight: 1.4,
            boxShadow: "0 6px 16px rgba(0,0,0,0.2)"
          }}
          dangerouslySetInnerHTML={{ __html: tip.html }}
        />
      )}
    </div>
  );
}

export default function App() {
  const [name, setName] = useState("KnoYoo");

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [list, setList] = useState<Note[]>([]);
  const [page, setPage] = useState(1);

  // 顶部“新增记录”折叠
  const [showAddNote, setShowAddNote] = useState(false);
  // 整个计划面板的显示/隐藏
  const [showPlans, setShowPlans] = useState(true);

  useEffect(() => { refresh(); }, [page]);

  async function refresh() {
    const rows = await invoke<Note[]>("list_notes", { page, pageSize: 10 });
    setList(rows);
  }

  async function onSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      if (editingId == null) {
        const id = await invoke<number>("add_note", { title, content });
        const hits = await invoke<Array<{ skill_id: number; name: string; delta: number; new_mastery: number }>>(
          "classify_and_update",
          { noteId: id }
        );
        if (Array.isArray(hits) && hits.length > 0) {
          const msg = hits.map(h => `${h.name} +${h.delta} → ${h.new_mastery}`).join("，");
          alert(`已自动归类：${msg}`);
        } else {
          alert("未命中任何技能（可增补行业树关键词或稍后用 AI 分类升级）");
        }
      } else {
        await invoke("update_note", { id: editingId, title, content });
        setEditingId(null);
      }
      setTitle("");
      setContent("");
      await refresh();
      alert("已保存！");
    } catch (e) {
      console.error(e);
      alert("保存失败: " + e);
    } finally {
      setSaving(false);
    }
  }

  async function onEdit(n: Note) {
    setEditingId(n.id);
    setTitle(n.title);
    setContent(n.content);
  }

  async function onDelete(id: number) {
    if (!confirm("确认删除？")) return;
    await invoke("delete_note", { id });
    await refresh();
  }

  async function aiClassifyLocal(noteId: number) {
    try {
      const hits = await invoke<Array<{ skill_id:number; name:string; delta:number; new_mastery:number }>>(
        "classify_note_embed", { noteId }
      );
      if (Array.isArray(hits) && hits.length > 0) {
        const msg = hits.map(h => `${h.name} +${h.delta} → ${h.new_mastery}`).join("，");
        alert("AI归类（本地）：" + msg);
      } else {
        alert("AI未找到明显匹配（分数低于阈值）");
      }
    } catch (e:any) {
      alert("AI归类失败：" + String(e));
      console.error(e);
    }
  }

  async function onSearch() {
    try {
      const q2 = q.trim();
      if (!q2) { setResults([]); return; }
      const rows = await invoke<Hit[]>("search_notes", { query: q2 });
      setResults(rows);
    } catch (e) {
      console.error(e);
      alert("搜索失败: " + e);
    }
  }

  const renderSnippet = (s: string) =>
    ({ __html: s.replaceAll("[mark]", "<mark>").replaceAll("[/mark]", "</mark>") });

  // ✅ 移到组件内部
  const onExport = async () => {
    try {
      const res = await invoke<{ path: string; count: number }>("export_notes_jsonl");
      alert(`已导出 ${res.count} 条到：\n${res.path}`);
    } catch (e: any) {
      alert("导出失败: " + e);
    }
  };

  // ✅ 移到组件内部，并在成功后调用 refresh()
  async function onImport() {
    try {
      const res = await invoke<[number, number]>("import_notes_jsonl");
      const [inserted, ignored] = res;
      alert(`已导入：${inserted} 条；忽略：${ignored} 条（已存在的重复）`);
      await refresh();
    } catch (e: any) {
      alert("导入失败: " + e);
    }
  }

  // 放在组件里其它 state 后面
  type PlanTask = {
    id: number;
    skill_id: number | null;
    title: string;
    minutes: number;
    due: string | null;
    status: "TODO" | "DONE";
    horizon: "WEEK" | "QTR";
  };

  const [plans, setPlans] = useState<PlanTask[]>([]);
  const [planHorizon, setPlanHorizon] = useState<"WEEK" | "QTR">("WEEK");
  const [planFilter, setPlanFilter] = useState<"ALL" | "TODO" | "DONE">("ALL");

  async function loadPlans(h?: "WEEK" | "QTR", s?: "ALL" | "TODO" | "DONE") {
    const horizon = h ?? planHorizon;
    const status = (s ?? planFilter) === "ALL" ? null : (s ?? planFilter);
    const rows = await invoke<PlanTask[]>("list_plan_tasks", {
      horizon, status
    });
    setPlans(rows);
  }

  async function onSeedIndustry() {
    const n = await invoke<number>("seed_industry_v1");
    alert(`行业树种子写入：${n} 项`);
  }

  async function onGenerate(h: "WEEK" | "QTR") {
    await invoke<PlanTask[]>("generate_plan", { horizon: h });
    await loadPlans(h, planFilter);
    alert(h === "WEEK" ? "已生成周计划" : "已生成三月计划");
  }

  async function toggleDone(t: PlanTask) {
    const next = t.status === "DONE" ? "TODO" : "DONE";
    await invoke("update_plan_status", { id: t.id, status: next });
    await loadPlans();
  }

  useEffect(() => { loadPlans(); }, []);

  // ---- 周报简版区块 ----
  type WeekReport = {
    start: string; end: string;
    tasks_done: number; minutes_done: number;
    new_notes: number; avg_mastery: number;
    top_gaps: [string, number, number, number][];
  };

  const [report, setReport] = useState<WeekReport | null>(null);

  async function loadWeekReport() {
    const r = await invoke<WeekReport>("report_week_summary");
    setReport(r);
  }

  function WeekReportPanel() {
    const [rep, setRep] = useState<WeekReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");

    async function load() {
      setLoading(true);
      setMsg("");
      try {
        const r = await invoke<WeekReport>("report_week_summary");
        setRep(r);
      } catch (e: any) {
        setMsg(String(e));
      } finally {
        setLoading(false);
      }
    }

    async function saveAsNote() {
      if (!rep) return;
      const title = `周报 ${rep.start}~${rep.end}`;
      const lines = [
        `- 完成任务：${rep.tasks_done}`,
        `- 投入分钟：${rep.minutes_done}`,
        `- 新增笔记：${rep.new_notes}`,
        `- 平均掌握度：${rep.avg_mastery.toFixed(1)}`,
        "",
        "短板 Top5：",
        ...rep.top_gaps.map(([name, req, mastery, gap]) => `- ${name}｜要求${req}｜当前${mastery}｜差距${gap}`),
      ];
      const content = lines.join("\n");
      try {
        const id = (await invoke("add_note", { title, content })) as number;
        setMsg(`已保存为笔记 #${id}`);
      } catch (e: any) {
        setMsg(String(e));
      }
    }

    return (
      <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, marginTop: 16 }}>
        <h2 style={{ margin: "0 0 8px" }}>周报简版</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <button onClick={load} disabled={loading}>刷新</button>
          <button onClick={saveAsNote} disabled={loading || !rep}>保存为笔记</button>
          {msg && <div style={{ fontSize: 12, opacity: 0.8 }}>{msg}</div>}
        </div>
        {rep && (
          <div style={{ lineHeight: 1.6 }}>
            <div>统计范围：{rep.start} ~ {rep.end}</div>
            <div>完成任务：{rep.tasks_done} 个（约 {rep.minutes_done} 分钟）</div>
            <div>新增笔记：{rep.new_notes} 条</div>
            <div>当前平均掌握度：{rep.avg_mastery.toFixed(1)}</div>
            <div style={{ marginTop: 8, fontWeight: 600 }}>短板 Top5：</div>
            <ol>
              {rep.top_gaps.map(([name, req, m, gap], i) => (
                <li key={i}>{name}：要求 {req}，当前 {m}，差距 {gap}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  }

  function PlanPanel() {
    // 放在组件内部，避免和外部类型重名冲突
    type PlanTask = {
      id: number;
      skill_id: number | null;
      title: string;
      minutes: number;
      due: string | null;
      status: "TODO" | "DONE";
      horizon: "WEEK" | "QTR";
    };

    const [horizon, setHorizon] = useState<"WEEK" | "QTR">("WEEK");
    const [onlyTodo, setOnlyTodo] = useState(false);
    const [grouped, setGrouped] = useState(true); // 默认分组显示
    const [tasks, setTasks] = useState<PlanTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");

    // 编辑态
    const [editId, setEditId] = useState<number | null>(null);
    const [eTitle, setETitle] = useState("");
    const [eMinutes, setEMinutes] = useState("");
    const [eDue, setEDue] = useState("");

    const [newTitle, setNewTitle] = useState("");
    const [newMinutes, setNewMinutes] = useState<number>(60);
    const [newDue, setNewDue] = useState<string>(""); // 形如 "2025-09-19"

    // 新增计划的折叠
    const [showAddPlan, setShowAddPlan] = useState(false);

    const todayStr = () => new Date().toISOString().slice(0, 10);
    const isOverdue = (t: PlanTask) => t.due != null && t.status !== "DONE" && t.due < todayStr();

    async function load(preserveMsg = false) {
      setLoading(true);
      if (!preserveMsg) setMsg("");
      try {
        const args = onlyTodo ? { horizon, status: "TODO" } : { horizon };
        const res = (await invoke("list_plan_tasks", args)) as PlanTask[];

        // 排序：逾期优先 → 其它按 due 升序 → DONE 最后
        const sorted = [...res].sort((a, b) => {
          const aOver = isOverdue(a), bOver = isOverdue(b);
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
    useEffect(() => { load(); }, [horizon, onlyTodo]);

    async function gen(h: "WEEK" | "QTR") {
      setLoading(true);
      try {
        const created = (await invoke("generate_plan", { horizon: h })) as any[];
        const n = Array.isArray(created) ? created.length : 0;

        let tip = "";
        if (n === 0) {
          const open = (await invoke("list_plan_tasks", { horizon: h, status: "TODO" })) as PlanTask[];
          const gaps = (await invoke("list_skill_gaps", { limit: 5 })) as SkillGapRow[];
          const hasGap = gaps.some(g => g.gap > 0);

          const reasons: string[] = [];
          if (open.length > 0) reasons.push(`该周期已有未完成任务 ${open.length} 条`);
          if (!hasGap) reasons.push("当前无明显能力差距（已满足或掌握度≥要求）");
          if (reasons.length === 0) reasons.push("可能被去重规则或唯一索引拦截");

          tip = "未生成新任务：" + reasons.join("；");
        } else {
          tip = `生成 ${n} 条`;
        }

        await load(true);   // 刷新列表，但“保留消息”
        setMsg(tip);        // 刷新后再设置提示，避免被清空
      } catch (e: any) {
        setMsg(String(e));
      } finally {
        setLoading(false);
      }
    }

    async function cleanupDup() {
      try {
        const n = (await invoke("cleanup_plan_duplicates", { horizon })) as number;
        const tip = `清理重复：${n}`;
        await load(true);
        setMsg(tip);
      } catch (e: any) {
        setMsg(String(e));
      }
    }

    async function toggle(t: PlanTask) {
      const next = t.status === "DONE" ? "TODO" : "DONE";
      await invoke("update_plan_status", { id: t.id, status: next });
      await load();
    }

    async function del(t: PlanTask) {
      await invoke("delete_plan_task", { id: t.id });
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
      await invoke("update_plan_task", { id, title: eTitle, minutes, due });
      cancelEdit();
      await load();
    }

    async function onAddPlanQuick() {
      const t = newTitle.trim();
      if (!t) { alert("标题必填"); return; }
      try {
        await invoke<number>("add_plan_task", {
          horizon: horizon,
          skillId: null,           // 若后续想支持绑定具体 skill，可在此传 id
          title: t,
          minutes: newMinutes || 60,
          due: newDue || null
        });
        setNewTitle(""); setNewMinutes(60); setNewDue("");
        await load();
      } catch (e:any) {
        alert("新增失败：" + String(e));
      }
    }

    function renderRow(t: PlanTask) {
      const editing = editId === t.id;
      return (
        <li
          key={t.id}
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto auto",
            gap: 8,
            alignItems: "center",
            padding: "8px 0",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <input type="checkbox" checked={t.status === "DONE"} onChange={() => toggle(t)} />

          <div>
            {!editing ? (
              <>
                <div style={{ fontWeight: 600, textDecoration: t.status === "DONE" ? "line-through" : "none" }}>
                  {t.title}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {`min: ${t.minutes ?? "-"}`}
                  {t.due ? (
                    <>
                      {" • due: "}
                      <span style={{ color: isOverdue(t) ? "#d32f2f" : "inherit" }}>{t.due}</span>
                    </>
                  ) : ""}
                  {typeof t.skill_id === "number" ? ` • skill: ${t.skill_id}` : ""}
                </div>
              </>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                <input
                  value={eTitle}
                  onChange={(e) => setETitle(e.target.value)}
                  placeholder="title"
                  style={{ padding: 6, borderRadius: 6, border: "1px solid #ddd" }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number"
                    min={0}
                    value={eMinutes}
                    onChange={(e) => setEMinutes(e.target.value)}
                    placeholder="minutes"
                    style={{ padding: 6, borderRadius: 6, border: "1px solid #ddd", width: 120 }}
                  />
                  <input
                    type="date"
                    value={eDue}
                    onChange={(e) => setEDue(e.target.value)}
                    style={{ padding: 6, borderRadius: 6, border: "1px solid #ddd" }}
                  />
                </div>
              </div>
            )}
          </div>

          <span style={{ fontSize: 12, opacity: 0.7 }}>{t.horizon}</span>

          <div style={{ display: "flex", gap: 6 }}>
            {!editing ? (
              <>
                <button onClick={() => startEdit(t)}>编辑</button>
                <button onClick={() => del(t)}>删除</button>
              </>
            ) : (
              <>
                <button onClick={() => saveEdit(t.id)}>保存</button>
                <button onClick={cancelEdit}>取消</button>
              </>
            )}
          </div>
        </li>
      );
    }

    function groupTasks(list: PlanTask[]): Array<[string, PlanTask[]]> {
      const today = new Date().toISOString().slice(0, 10);              // YYYY-MM-DD
      const endOfWeek = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);

      const buckets: Record<string, PlanTask[]> = {
        overdue: [], today: [], week: [], later: [], nodue: [], done: []
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
        ["today",   "今天"],
        ["week",    "本周"],
        ["later",   "以后"],
        ["nodue",   "无截止"],
        ["done",    "已完成"],
      ];

      return order
        .filter(([k]) => !(onlyTodo && k === "done"))
        .map(([k, label]) => [label, buckets[k]]);
    }

    return (
      <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, marginTop: 16 }}>
        <h2 style={{ margin: "0 0 8px" }}>计划</h2>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <label>
            <input type="radio" value="WEEK" checked={horizon === "WEEK"} onChange={() => setHorizon("WEEK")} /> WEEK
          </label>
          <label>
            <input type="radio" value="QTR" checked={horizon === "QTR"} onChange={() => setHorizon("QTR")} /> QTR
          </label>

          <button onClick={() => gen("WEEK")} disabled={loading}>生成周计划</button>
          <button onClick={() => gen("QTR")} disabled={loading}>生成三月计划</button>
          <button onClick={cleanupDup} disabled={loading}>清理重复</button>
          <button onClick={() => load()} disabled={loading}>刷新</button>

          <label style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={onlyTodo}
              onChange={(e) => setOnlyTodo(e.target.checked)}
            /> 只看未完成
          </label>
          <label style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={grouped}
              onChange={(e) => setGrouped(e.target.checked)}
            /> 分组显示
          </label>
        </div>

        {/* 顶部工具条（筛选你已有的保持不动），在它后面加一个“新增计划”按钮 */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
          <button onClick={() => setShowAddPlan(v => !v)}>
            {showAddPlan ? "收起新增计划" : "新增计划"}
          </button>
        </div>

        {/* 折叠表单，仅在展开时渲染 */}
        {showAddPlan && (
          <div style={{
            display: "flex", gap: 8, alignItems: "center",
            margin: "8px 0", padding: 8, border: "1px dashed #ddd", borderRadius: 8
          }}>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="新增任务标题..."
              style={{ padding: 6, borderRadius: 6, width: 240 }}
            />
            <input
              type="number"
              value={newMinutes}
              onChange={(e) => setNewMinutes(parseInt(e.target.value || "0", 10))}
              placeholder="分钟"
              style={{ width: 90, padding: 6, borderRadius: 6 }}
            />
            <input
              type="date"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <button onClick={onAddPlanQuick}>新增</button>
          </div>
        )}

        {msg && <div style={{ marginBottom: 8, fontSize: 12, opacity: 0.8 }}>{msg}</div>}

        {loading ? (
          <div>Loading…</div>
        ) : grouped ? (
          <>
            {groupTasks(tasks).map(([label, items]) =>
              items.length === 0 ? null : (
                <div key={label} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, opacity: 0.7, margin: "6px 0" }}>
                    {label} · {items.length}
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {items.map((t) => renderRow(t))}
                  </ul>
                </div>
              )
            )}
            {tasks.length === 0 && <div style={{ opacity: 0.6, padding: "8px 0" }}>暂无任务</div>}
          </>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {tasks.map((t) => renderRow(t))}
            {tasks.length === 0 && <li style={{ opacity: 0.6, padding: "8px 0" }}>暂无任务</li>}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>{hello(name)}</h2>
      <input
        value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Enter a name..." style={{ padding: 8, borderRadius: 8, marginBottom: 16 }}
      />

      {/* ---- 全文搜索区块移到顶部 ---- */}
      <h3>全文搜索（FTS5）</h3>
      <input
        value={q} onChange={(e) => setQ(e.target.value)} placeholder='关键字 / "短语" / a OR b'
        style={{ padding: 8, borderRadius: 8, width: "100%" }}
      />
      <div style={{ marginTop: 8 }}>
        <button onClick={onSearch} style={{ padding: "8px 12px" }}>搜索</button>
      </div>
      <ul style={{ marginTop: 16, lineHeight: 1.6 }}>
        {results.map((hit) => (
          <li key={hit.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{hit.title}</div>
            <div dangerouslySetInnerHTML={renderSnippet(hit.snippet)} />
          </li>
        ))}
      </ul>

      {/* ---- 最近记录区块 ---- */}
      <h3 style={{ marginTop: 24 }}>最近记录</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>最近记录</h3>
        <button onClick={onExport}>导出 JSONL</button>
        <button onClick={onImport}>导入 JSONL</button>
      </div>
      <ul style={{ marginTop: 8 }}>
        {list.map(n => (
          <li key={n.id} style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 600 }}>{n.title}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{n.created_at}</div>
            <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
              <button onClick={() => onEdit(n)}>编辑</button>
              <button onClick={() => onDelete(n.id)}>删除</button>
              <button onClick={() => aiClassifyLocal(n.id)}>AI归类（本地）</button>
            </div>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
        <button onClick={() => setPage(p => p + 1)}>下一页</button>
        <button onClick={refresh}>刷新</button>
      </div>

      {/* ---- 新增记录折叠按钮 ---- */}
      <div style={{ marginTop: 24 }}>
        <button onClick={() => setShowAddNote(v => !v)}>
          {showAddNote ? "收起新增记录" : "新增记录"}
        </button>
      </div>
      {/* ---- 新增/编辑表单折叠区块 ---- */}
      {showAddNote && (
        <div style={{ marginTop: 12 }}>
          <h3>{editingId ? "编辑记录" : "新增记录"}</h3>
          <input
            value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题"
            style={{ width: "100%", padding: 8, borderRadius: 8, marginBottom: 8 }}
          />
          <textarea
            value={content} onChange={(e) => setContent(e.target.value)} placeholder="正文内容..."
            rows={4} style={{ width: "100%", padding: 8, borderRadius: 8 }}
          />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button onClick={onSave} disabled={saving} style={{ padding: "8px 12px" }}>
              {saving ? "保存中..." : (editingId ? "更新" : "保存")}
            </button>
            {editingId && (
              <button onClick={() => { setEditingId(null); setTitle(""); setContent(""); }}>
                取消编辑
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---- 计划区块卡片包裹+可折叠 ---- */}
      <div style={{ marginTop: 24, border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8
        }}>
          <h3 style={{ margin: 0 }}>计划</h3>
          <button onClick={() => setShowPlans(v => !v)}>
            {showPlans ? "隐藏" : "显示"}
          </button>
        </div>
        {showPlans && <PlanPanel />}
      </div>

      {/* ---- 周报简版区块 ---- */}
      <h3 style={{ marginTop: 24 }}>周报简版</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button onClick={loadWeekReport}>生成本周简报</button>
      </div>
      {report && (
        <div style={{ lineHeight: 1.6 }}>
          <div>统计范围：{report.start} ~ {report.end}</div>
          <div>完成任务：{report.tasks_done} 个（约 {report.minutes_done} 分钟）</div>
          <div>新增笔记：{report.new_notes} 条</div>
          <div>当前平均掌握度：{report.avg_mastery.toFixed(1)}</div>
          <div style={{ marginTop: 8, fontWeight: 600 }}>短板 Top5：</div>
          <ol>
            {report.top_gaps.map(([name, req, m, gap], i) => (
              <li key={i}>{name}：要求 {req}，当前 {m}，差距 {gap}</li>
            ))}
          </ol>
        </div>
      )}
      <DebugCounts />
      <RadarPanel />
    </div>
  );
}
