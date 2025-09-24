import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import MindMapPage from "./MindMapPage";


// 给控制台用的临时桥
declare global {
  interface Window {
    __TAURI__?: any;
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

function RadarPanel({ reloadKey = 0 }: { reloadKey?: number }) {
  const [data, setData] = useState<SkillGapRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [, setMsg] = useState("");

  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; html: string } | null>(null);

  function showTip(e: React.MouseEvent, html: string) {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left + 8, y: e.clientY - r.top + 8, html });
  }
  function hideTip() { setTip(null); }

  async function loadRadar() {
    setLoading(true); setMsg("");
    try {
      const res = await invoke<Array<{name:string; score:number}>>("list_ai_topics_top8");
      const mapped = res.map(r => ({ name: r.name, mastery: r.score, required_level: 0, gap: 0 }));
      setData(mapped);
    } catch (e:any) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }
  // 初次挂载 & 外部刷新信号变化时重新加载
  useEffect(() => { loadRadar(); }, [reloadKey]);

  if (!loading && (!data || data.length === 0)) {
    return <div style={{ padding: 32, textAlign: "center", color: "#888" }}>暂无数据</div>;
  }

  // 固定八个维度（AI 已返回 Top8），不足则占位
  const facets =
    data.length >= 8
      ? data.slice(0, 8)
      : [
          ...data,
          ...Array(8 - data.length).fill({
            name: "",
            mastery: 0,
            required_level: 0,
            gap: 0,
          }),
        ];
  const N = 8;
  const cx = 140, cy = 140, R = 110;

  function polar(r: number, i: number) {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / N;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  }

  function ringPolygon(f: number) {
    const r = R * f;
    return Array.from({length: N}, (_, i) => {
      const [x, y] = polar(r, i);
      return `${x},${y}`;
    }).join(" ");
  }

  const reqPoints = facets.map((d, i) => {
    const r = Math.max(0, Math.min(100, d.required_level * 20)) * (R / 100);
    const [x, y] = polar(r, i);
    return `${x},${y}`;
  }).join(" ");

  const masPoints = facets.map((d, i) => {
    const r = Math.max(0, Math.min(100, d.mastery)) * (R / 100);
    const [x, y] = polar(r, i);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div ref={wrapRef} style={{ position: "relative", width: 280, height: 280 }}>
      <svg width={280} height={280} viewBox="0 0 280 280">
        {/* 八边形网格（4 圈） */}
        {[0.25, 0.5, 0.75, 1].map((p, idx) => (
          <polygon key={idx} points={ringPolygon(p)} fill="none" stroke="#eee" />
        ))}
        {/* 轴线 + 标签（按 facets 渲染） */}
        {facets.map((d, i) => {
          const [x, y] = polar(R, i);
          const [lx, ly] = polar(R + 16, i);
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="#eee" />
              {d.name && (
                <text x={lx} y={ly} fontSize={10} textAnchor="middle" dominantBaseline="middle">{d.name}</text>
              )}
            </g>
          );
        })}
        {/* required 多边形（半透明边框） */}
        {facets.length >= 3 && (
          <polygon points={reqPoints} fill="none" stroke="#999" strokeDasharray="4 3" />
        )}
        {/* mastery 多边形（实心） */}
        {facets.length >= 3 && (
          <polygon points={masPoints} fill="rgba(33,150,243,0.25)" stroke="#2196f3" />
        )}
        {/* 中心点 */}
        <circle cx={cx} cy={cy} r={2} fill="#999" />
        {/* 交互圆点和透明命中圈 */}
        {facets.map((d, i) => {
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
  const [showAISettings, setShowAISettings] = useState(false);
  type AIConfig = { provider?: string; api_base?: string; api_key?: string; model?: string };
  const [aiCfg, setAiCfg] = useState<AIConfig>({});
  const [aiMsg, setAiMsg] = useState("");

  // 给雷达用的“刷新信号”
  const [radarTick, setRadarTick] = useState(0);

  const pageSize = 10;
  const [totalNotes, setTotalNotes] = useState(0);
  const totalPages = Math.max(1, Math.ceil(totalNotes / pageSize));

  useEffect(() => { refresh(); }, [page]);

  async function refresh() {
    const rows = await invoke<Note[]>("list_notes", { page, pageSize });
    setList(rows);
    const n = await invoke<number>("count_notes");
    const total = n || 0;
    setTotalNotes(total);
    const tp = Math.max(1, Math.ceil(total / pageSize));
    if (page > tp) setPage(tp);
  }

  async function loadTotalNotes() {
    const n = await invoke<number>("count_notes");
    setTotalNotes(n || 0);
  }
  useEffect(() => { loadTotalNotes(); }, []);

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

  // async function onEdit(n: Note) {
  //   setEditingId(n.id);
  //   setTitle(n.title);
  //   setContent(n.content);
  // }

  // async function onDelete(id: number) {
  //   if (!confirm("确认删除？")) return;
  //   await invoke("delete_note", { id });
  //   await refresh();
  // }

  // async function aiClassifyLocal(noteId: number) {
  //   try {
  //     const hits = await invoke<Array<{ skill_id:number; name:string; delta:number; new_mastery:number }>>(
  //       "classify_note_embed", { noteId }
  //     );
  //     if (Array.isArray(hits) && hits.length > 0) {
  //       const msg = hits.map(h => `${h.name} +${h.delta} → ${h.new_mastery}`).join("，");
  //       alert("AI归类（本地）：" + msg);
  //     } else {
  //       alert("AI未找到明显匹配（分数低于阈值）");
  //     }
  //   } catch (e:any) {
  //     alert("AI归类失败：" + String(e));
  //     console.error(e);
  //   }
  // }

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

  // ---- 周报简版区块 ----
  type WeekReport = {
    start: string;
    end: string;
    tasks_done: number;
    minutes_done: number;
    new_notes: number;
    avg_mastery: number;
    top_gaps: [string, number, number, number][];
  };
  const [weekReport, setWeekReport] = React.useState<WeekReport | null>(null);
  const [weekOpen, setWeekOpen] = React.useState(false);

  const genWeek = async () => {
    const r = await invoke<WeekReport>("report_week_summary");
    setWeekReport(r);
    setWeekOpen(true);
  };
  const clearWeek = () => setWeekReport(null);
  const toggleWeek = () => setWeekOpen(v => !v);

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

    const [horizon] = useState<"WEEK" | "QTR">("WEEK");
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

    // async function gen(h: "WEEK" | "QTR") {
    //   setLoading(true);
    //   try {
    //     const created = (await invoke("generate_plan", { horizon: h })) as any[];
    //     const n = Array.isArray(created) ? created.length : 0;

    //     let tip = "";
    //     if (n === 0) {
    //       const open = (await invoke("list_plan_tasks", { horizon: h, status: "TODO" })) as PlanTask[];
    //       const gaps = (await invoke("list_skill_gaps", { limit: 5 })) as SkillGapRow[];
    //       const hasGap = gaps.some(g => g.gap > 0);

    //       const reasons: string[] = [];
    //       if (open.length > 0) reasons.push(`该周期已有未完成任务 ${open.length} 条`);
    //       if (!hasGap) reasons.push("当前无明显能力差距（已满足或掌握度≥要求）");
    //       if (reasons.length === 0) reasons.push("可能被去重规则或唯一索引拦截");

    //       tip = "未生成新任务：" + reasons.join("；");
    //     } else {
    //       tip = `生成 ${n} 条`;
    //     }

    //     await load(true);   // 刷新列表，但“保留消息”
    //     setMsg(tip);        // 刷新后再设置提示，避免被清空
    //   } catch (e: any) {
    //     setMsg(String(e));
    //   } finally {
    //     setLoading(false);
    //   }
    // }

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

    const [goal, setGoal] = useState("");
    const [savedGoal, setSavedGoal] = useState("");
    const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0,10));
    const [endDate, setEndDate] = useState(() => {
      const d = new Date(Date.now() + 6*86400000); return d.toISOString().slice(0,10);
    });
    useEffect(() => {
      (async () => {
        try {
          const g = await invoke<string>("get_plan_goal");
          setGoal(g || "");
          setSavedGoal(g || "");
        } catch {}
      })();
    }, []);
    async function saveGoal() {
      try {
        await invoke("set_plan_goal", { goal });
        setSavedGoal(goal);
      } catch(e){}
    }
    async function genByRange() {
      setLoading(true);
      try {
        const created = await invoke("generate_plan_by_range", { start: startDate, end: endDate, goal });
        await load(true);
        setMsg(Array.isArray(created) && created.length>0 ? `生成 ${created.length} 条` : "未生成新任务（可能已有未完成或差距不足）");
      } catch (e:any) {
        setMsg(String(e));
      } finally { setLoading(false); }
    }

    return (
      <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, marginTop: 16 }}>


        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <label>总目标</label>
            <input value={goal} onChange={e=>setGoal(e.target.value)} placeholder="例如：入门数据分析拿到实习" style={{ width: 260, padding: 6, borderRadius: 6, border: "1px solid #ddd" }}/>
            <button onClick={saveGoal}>确认</button>
          </div>
          {savedGoal && (
            <div style={{ marginTop: 6, color: "#555" }}>
              当前目标：{savedGoal}
            </div>
          )}

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span>起止</span>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
            <span>→</span>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} />
            <button onClick={genByRange} disabled={loading}>生成计划</button>
          </div>

          <label style={{ marginLeft: 8 }}>
            <input type="checkbox" checked={onlyTodo} onChange={e=>setOnlyTodo(e.target.checked)} /> 只看未完成
          </label>
          <label style={{ marginLeft: 8 }}>
            <input type="checkbox" checked={grouped} onChange={e=>setGrouped(e.target.checked)} /> 分组显示
          </label>
        </div>

        {/* 顶部工具条（筛选你已有的保持不动），在它后面加一个“新增计划”按钮 */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
          <button onClick={() => setShowAddPlan(v => !v)}>
            {showAddPlan ? "收起" : "+计划"}
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
            <button onClick={onAddPlanQuick}>添加计划</button>
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

  async function loadAIConfig() {
    try {
      const cfg = await invoke<AIConfig>("get_ai_config");
      setAiCfg(cfg || {});
    } catch (e: any) {
      setAiMsg(String(e));
    }
  }

  async function saveAIConfig() {
    try {
      await invoke("set_ai_config", { cfg: aiCfg });
      setAiMsg("已保存");
    } catch (e: any) {
      setAiMsg(String(e));
    }
  }

  async function smokeAI() {
    try {
      const r = await invoke<string>("ai_smoketest");
      setAiMsg(r);
      alert(r);
    } catch (e: any) {
      setAiMsg(String(e));
      alert(String(e));
    }
  }

  // === AI 聊天抽屉相关 ===
  const [chatOpen, setChatOpen] = React.useState(false);
  type Msg = { role: "user" | "assistant", content: string };
  const [chatMsgs, setChatMsgs] = React.useState<Msg[]>([]);
  const [chatInput, setChatInput] = React.useState("");

  async function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    const next = [...chatMsgs, { role: "user" as const, content: text }];
    setChatMsgs(next);
    setChatInput("");
    try {
      const reply = await invoke<string>("ai_chat", { messages: next });
      setChatMsgs(m => [...m, { role: "assistant", content: reply || "（空）" }]);
    } catch (e) {
      setChatMsgs(m => [...m, { role: "assistant", content: "请求失败，请检查 AI 设置。" }]);
    }
  }

  return (
    // ====== 新增导航分支 begin ======
    (() => {
      const [tab, setTab] = React.useState<"home" | "mindmap">("home");
      (window as any).__knoyoo_setTab = setTab; // 调试用，可删
      return (
        <div>
          <div style={{ display: "flex", gap: 12, padding: "8px 12px", borderBottom: "1px solid #eee", position: "sticky", top: 0, background: "#fff", zIndex: 9 }}>
            <button onClick={() => setTab("home")} style={{ fontWeight: tab === "home" ? 700 : 400 }}>主页</button>
            <button onClick={() => setTab("mindmap")} style={{ fontWeight: tab === "mindmap" ? 700 : 400 }}>行业图谱</button>
          </div>
          {tab === "home" ? (
            <>
              {/* 这里渲染你原有的主页内容（保持不变） */}
              <h2 style={{marginBottom: 8}}>很高兴见到你，我们一同成长吧！</h2>
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={async () => { setShowAISettings(v => !v); if (!showAISettings) await loadAIConfig(); }}>
                  {showAISettings ? "收起 AI 设置" : "AI 设置"}
                </button>
                {aiMsg && <div style={{ fontSize: 12, opacity: 0.8 }}>{aiMsg}</div>}
              </div>
              {showAISettings && (
                <div style={{ marginTop: 8, padding: 12, border: "1px dashed #ddd", borderRadius: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 8, columnGap: 8, alignItems: "center" }}>
                    <div>Provider</div>
                    <select
                      value={aiCfg.provider || ""}
                      onChange={e => setAiCfg({ ...aiCfg, provider: e.target.value })}
                    >
                      <option value="">（未设置）</option>
                      <option value="openai">OpenAI / 兼容</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="silicon">SiliconCloud</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="ollama">Ollama（本地）</option>
                    </select>

                    <div>API Base</div>
                    <input
                      placeholder="https://api.openai.com/v1 或兼容地址"
                      value={aiCfg.api_base || ""}
                      onChange={e => setAiCfg({ ...aiCfg, api_base: e.target.value })}
                    />

                    <div>API Key</div>
                    <input
                      placeholder="sk-..."
                      value={aiCfg.api_key || ""}
                      onChange={e => setAiCfg({ ...aiCfg, api_key: e.target.value })}
                      style={{ fontFamily: "monospace" }}
                    />

                    <div>Model</div>
                    <input
                      placeholder="如 gpt-4o-mini / deepseek-chat / claude-3-5-sonnet 等"
                      value={aiCfg.model || ""}
                      onChange={e => setAiCfg({ ...aiCfg, model: e.target.value })}
                    />
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <button onClick={saveAIConfig}>保存</button>
                    <button onClick={smokeAI}>冒烟自检</button>
                  </div>
                </div>
              )}

              {/* ---- 全文搜索区块移到顶部 ---- */}
              <h3>笔记搜索</h3>
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
              <h3 style={{ marginTop: 24 }}>笔记仓库</h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
                <button onClick={onExport}>导出到本地</button>
                <button onClick={onImport}>从本地导入</button>
              </div>
              <ul>
                {list.map(n => (
                  <NoteItem key={n.id} note={n} onChanged={refresh} />
                ))}
              </ul>
              {/* 删除“刷新”按钮（笔记列表分页区块） */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
                <span>第 {page} / {totalPages} 页</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>下一页</button>
              </div>

              {/* ---- 新增记录折叠按钮 ---- */}
              <div style={{ marginTop: 24 }}>
                <button onClick={() => setShowAddNote(v => !v)}>
                  {showAddNote ? "收起新笔记" : "+笔记"}
                </button>
              </div>
              {/* ---- 新增/编辑表单折叠区块 ---- */}
              {showAddNote && (
                <div style={{ marginTop: 12 }}>
                  <h3>{editingId ? "编辑笔记" : "新笔记"}</h3>
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
              <h2>周报简版</h2>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button onClick={genWeek}>生成本周简报</button>
                <button onClick={toggleWeek} disabled={!weekReport}>
                  {weekOpen ? "隐藏" : "展开"}
                </button>
                <button onClick={clearWeek} disabled={!weekReport}>清空</button>
              </div>
              {weekReport && weekOpen && (
                <div>
                  <div>本周范围：{weekReport.start} ~ {weekReport.end}</div>
                  <div>完成任务：{weekReport.tasks_done} 个；累计 {weekReport.minutes_done} 分钟</div>
                  <div>新增笔记：{weekReport.new_notes} 条；平均掌握度：{weekReport.avg_mastery.toFixed(1)}</div>
                  <div style={{marginTop:8}}>短板TOP5：</div>
                  <ol>
                    {weekReport.top_gaps?.map((x, i) => (
                      <li key={i}>{x[0]}（需求L{x[1]}，当前{x[2]}，差距{x[3]}）</li>
                    ))}
                  </ol>
                </div>
              )}
              <DebugCounts />
              <div style={{ marginTop: 24, border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <h3 style={{ margin: 0 }}>擅长点雷达图</h3>
                  <button
                    onClick={async () => {
                      try {
                        await invoke("ai_analyze_topics");
                        setRadarTick(t => t + 1);
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                  >
                    AI云刷新
                  </button>
                </div>
                <RadarPanel reloadKey={radarTick} />
              </div>

              {/* 右下角开关按钮 */}
              <button
                style={{
                  position: "fixed", right: 16, bottom: 16, zIndex: 9999,
                  padding: "10px 12px", borderRadius: 8
                }}
                onClick={() => setChatOpen(v => !v)}
              >
                {chatOpen ? "关闭聊天" : "AI 聊天"}
              </button>

              {/* 右侧抽屉 */}
              <div
                style={{
                  position: "fixed",
                  top: 0, right: 0, height: "100vh",
                  width: chatOpen ? 360 : 0,
                  transition: "width .25s ease",
                  overflow: "hidden",
                  background: "#fff",
                  borderLeft: "1px solid #eee",
                  zIndex: 9998,
                  display: "flex",
                  flexDirection: "column"
                }}
              >
                <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 600 }}>
                  与 AI 对话
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
                  {chatMsgs.map((m, i) => (
                    <div key={i} style={{ marginBottom: 10, whiteSpace: "pre-wrap" }}>
                      <div style={{ fontSize: 12, color: "#888" }}>
                        {m.role === "user" ? "我" : "AI"}
                      </div>
                      <div>{m.content}</div>
                    </div>
                  ))}
                  {chatMsgs.length === 0 && <div style={{ color: "#999" }}>开始提问吧～</div>}
                </div>
                <div style={{ padding: 12, borderTop: "1px solid #eee" }}>
                  <textarea
                    rows={3}
                    style={{ width: "100%", boxSizing: "border-box" }}
                    placeholder="输入消息…"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault(); sendChat();
                      }
                    }}
                  />
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={sendChat}>发送（Ctrl/Cmd+Enter）</button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <MindMapPage />
          )}
        </div>
      );
    })()
    // ====== 新增导航分支 end ======
  );
}

function NoteItem({ note, onChanged }: { note: Note; onChanged: () => void }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(note.title);
  const [content, setContent] = React.useState(note.content);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const save = async () => {
    await invoke("update_note", { id: note.id, title, content });
    setEditing(false);
    onChanged();
  };

  const del = async () => {
    if (confirm("确认删除这条笔记？")) {
      await invoke("delete_note", { id: note.id });
      onChanged();
    }
  };

  const autoClassify = async () => {
    try {
      await invoke("classify_note_embed", { noteId: note.id });
    } catch {
      await invoke("classify_and_update", { noteId: note.id });
    }
    onChanged();
  };

  return (
    <li className="note-item" style={{ position: "relative", paddingRight: 48 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <strong>{note.title}</strong>
        <button
          className="more-btn"
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
          title="更多"
          style={{ marginLeft: "auto", border: "1px solid #ddd", width: 28, height: 28, borderRadius: 6, cursor: "pointer" }}
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            ref={menuRef}
            style={{ position: "absolute", right: 0, top: 28, background: "#fff", border: "1px solid #e5e5e5", borderRadius: 8, padding: 6, display: "flex", flexDirection: "column", gap: 4, zIndex: 10, boxShadow: "0 6px 16px rgba(0,0,0,.12)" }}
          >
            <button onClick={() => setEditing(true)}>编辑</button>
            <button onClick={del}>删除</button>
            <button onClick={autoClassify}>自动归类</button>
          </div>
        )}
      </div>
      <div style={{ color: "#777", fontSize: 12, marginTop: 4 }}>{note.created_at}</div>
      {editing && (
        <div className="inline-editor" style={{ marginTop: 8, border: "1px solid #eee", borderRadius: 8, padding: 8 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
          <textarea rows={6} value={content} onChange={e => setContent(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save}>保存</button>
            <button onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}
    </li>
  );
}
