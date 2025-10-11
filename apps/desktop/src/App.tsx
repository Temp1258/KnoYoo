import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import MindMapPage from "./MindMapPage";
// 导入全局样式，确保渐变背景与卡片等样式生效
import "./App.css";
// 引入 FontAwesome 图标以渲染顶部与侧边栏按钮
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTree,
  faHome as faHouse,
  faUser,
  faPlus,
  faSearch,
  faChevronLeft,
  faChevronRight,
  faArrowLeft,
  faEllipsisVertical
} from "@fortawesome/free-solid-svg-icons";

// 本文件是前端的主视图组件，负责记笔记、搜索、计划管理、行业树、个人设置等功能。
// 通过使用 React hooks 管理状态，并与后端 (Tauri) 命令交互完成数据的增删查改。


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

// DebugCounts 组件调用后端接口调试某些计数，并展示返回结果。
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

// RadarPanel 组件渲染一个雷达图，显示八个顶级技能维度的掌握度。
// 通过调用后端接口获取技能得分，并在 SVG 中绘制多边形和交互提示。

 // 渲染雷达图面板，支持外部通过 reloadKey 触发刷新
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
  // App 组件是应用的主要容器，包含记笔记列表、计划管理面板、AI 设置、行业树视图等子面板。
  // 使用大量 useState/useEffect hooks 来管理输入状态、分页、视图切换及与后端的交互。
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
  // 雷达图刷新状态
  const [loadingRadar, setLoadingRadar] = useState(false);

  const pageSize = 10;
  const [totalNotes, setTotalNotes] = useState(0);
  const totalPages = Math.max(1, Math.ceil(totalNotes / pageSize));

  // ===== 新增：全局视图状态与侧栏控制 =====
  // view 表示当前主内容区显示的页面：plan（默认）、note（查看笔记）、mindmap（行业树）、me（个人中心）
  const [view, setView] = useState<'plan' | 'note' | 'mindmap' | 'me'>('plan');
  // 侧边栏是否折叠
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 当前选择查看的笔记 id；null 表示未选择
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const selectedNote: Note | null = selectedNoteId != null ? (list.find(n => n.id === selectedNoteId) || null) : null;

  // 当选择某个笔记时切换到 note 视图并记录 ID
  function handleSelectNote(n: Note) {
    // 选中一条笔记：记录其 id，以便在 Note 视图显示其内容，并隐藏新增笔记表单。
    setSelectedNoteId(n.id);
    setView('note');
    setShowAddNote(false);
  }
  // 返回计划视图
  function handleBackToPlan() {
    // 取消选中的笔记，切换到计划视图。
    setView('plan');
    setSelectedNoteId(null);
  }

  useEffect(() => { refresh(); }, [page]);

  async function refresh() {
    // 从后端获取指定页码的笔记列表与总数，更新状态。
    const rows = await invoke<Note[]>("list_notes", { page, pageSize });
    setList(rows);
    const n = await invoke<number>("count_notes");
    const total = n || 0;
    setTotalNotes(total);
    const tp = Math.max(1, Math.ceil(total / pageSize));
    if (page > tp) setPage(tp);
  }

  async function loadTotalNotes() {
    // 单独统计笔记总数，用于分页计算。
    const n = await invoke<number>("count_notes");
    setTotalNotes(n || 0);
  }
  useEffect(() => { loadTotalNotes(); }, []);

  async function onSave() {
    // 保存或更新当前输入的笔记。
    // 如果 editingId 为 null 则新增，否则更新指定 id 的笔记。
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
    // 调用全文搜索接口，根据关键字检索笔记标题与内容，并高亮命中片段。
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
    // 将搜索结果中的 [mark] 标记替换为 <mark>，用于高亮显示。
    ({ __html: s.replaceAll("[mark]", "<mark>").replaceAll("[/mark]", "</mark>") });

  // ✅ 移到组件内部
  const onExport = async () => {
    // 导出全部笔记为 JSONL 文件，由后端决定路径和记录数。
    try {
      const res = await invoke<{ path: string; count: number }>("export_notes_jsonl");
      alert(`已导出 ${res.count} 条到：\n${res.path}`);
    } catch (e: any) {
      alert("导出失败: " + e);
    }
  };

  // ✅ 移到组件内部，并在成功后调用 refresh()
  async function onImport() {
    // 从文件导入笔记数据（JSONL 格式），后端会返回插入和忽略的条数。
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
    // 起止日期（ISO 字符串）
    start: string;
    end: string;
    // 完成任务数、完成的总分钟数、新增笔记数
    tasks_done: number;
    minutes_done: number;
    new_notes: number;
    // 平均掌握度
    avg_mastery: number;
    // 前 5 个能力差距 (技能名, required_level, mastery, gap)
    top_gaps: [string, number, number, number][];
  };
  const [weekReport, setWeekReport] = React.useState<WeekReport | null>(null);
  const [weekOpen, setWeekOpen] = React.useState(false);

  const genWeek = async () => {
    // 调用后端生成本周数据概要（周报），并在 UI 中展开显示。
    const r = await invoke<WeekReport>("report_week_summary");
    setWeekReport(r);
    setWeekOpen(true);
  };
  const clearWeek = () => setWeekReport(null);
  const toggleWeek = () => setWeekOpen(v => !v);

  function PlanPanel() {
    // PlanPanel 组件负责展示和操作周/季度计划任务列表。
    // 它封装了任务的加载、排序、增加、删除、编辑、切换状态等逻辑。
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
    // 判断任务是否逾期：有到期日期且未完成且到期日期早于今天
    const isOverdue = (t: PlanTask) => t.due != null && t.status !== "DONE" && t.due < todayStr();

    async function load(preserveMsg = false) {
      // 调用 list_plan_tasks 命令加载计划任务列表。
      // 结果按逾期、状态和到期日期排序，更新 tasks 状态。
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


    async function toggle(t: PlanTask) {
      // 切换任务状态：待办 <-> 已完成
      const next = t.status === "DONE" ? "TODO" : "DONE";
      await invoke("update_plan_status", { id: t.id, status: next });
      await load();
    }

    async function del(t: PlanTask) {
      // 删除单个任务
      await invoke("delete_plan_task", { id: t.id });
      await load();
    }

    function startEdit(t: PlanTask) {
      // 初始化编辑模式，将当前任务的字段填入输入框。
      setEditId(t.id);
      setETitle(t.title);
      setEMinutes(String(t.minutes ?? 0));
      setEDue(t.due ?? "");
    }
    function cancelEdit() {
      // 退出编辑模式，清空编辑字段。
      setEditId(null);
      setETitle("");
      setEMinutes("");
      setEDue("");
    }
    async function saveEdit(id: number) {
      // 保存编辑后的任务信息：标题、分钟数、截止日期。
      const minutes = Number.parseInt(eMinutes || "0", 10);
      const due = eDue.trim() === "" ? null : eDue.trim();
      await invoke("update_plan_task", { id, title: eTitle, minutes, due });
      cancelEdit();
      await load();
    }

    async function onAddPlanQuick() {
      // 以当前输入的标题、分钟数和日期新增一条计划任务。
      // 若未指定具体技能，则传入 null。
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
              <div style={{ display: "grid", gap: 8 }}>
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

          <div style={{ display: "flex", gap: 8 }}>
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
        const created = await invoke("ai_generate_plan_by_range", { start: startDate, end: endDate, goal });
        await load(true);
        setMsg(Array.isArray(created) && created.length>0 ? `生成 ${created.length} 条` : "未生成新任务（可能已有未完成或差距不足）");
      } catch (e:any) {
        setMsg(String(e));
      } finally { setLoading(false); }
    }

    return (
      <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, marginTop: 16 }}>


        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label>总目标</label>
            <input value={goal} onChange={e=>setGoal(e.target.value)} placeholder="例如：入门数据分析拿到实习" style={{ width: 260, padding: 6, borderRadius: 6, border: "1px solid #ddd" }}/>
            <button onClick={saveGoal}>确认</button>
          </div>
          {savedGoal && (
            <div style={{ marginTop: 6, color: "#555" }}>
              当前目标：{savedGoal}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
    <div className="app-wrapper">
      {/* 顶部导航：右侧图标（行业树、主页、我） */}
      <div className="topbar">
        <button
          className={view === 'mindmap' ? 'active' : ''}
          onClick={() => { setView('mindmap'); setSelectedNoteId(null); }}
          title="行业树"
        >
          <FontAwesomeIcon icon={faTree} />
        </button>
        <button
          className={view === 'plan' && selectedNoteId == null ? 'active' : ''}
          onClick={() => { setView('plan'); setSelectedNoteId(null); }}
          title="主页"
        >
          <FontAwesomeIcon icon={faHouse} />
        </button>
        <button
          className={view === 'me' ? 'active' : ''}
          onClick={() => { setView('me'); setSelectedNoteId(null); }}
          title="我"
        >
          <FontAwesomeIcon icon={faUser} />
        </button>
      </div>
      <div className="main-layout">
        {/* 侧边栏：笔记列表与新增/搜索等 */}
        <aside className={
          isSidebarCollapsed ? 'sidebar collapsed' : 'sidebar'
        }>
          {isSidebarCollapsed ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <button className="expand-btn" onClick={() => setSidebarCollapsed(false)} title="展开笔记栏">
                <FontAwesomeIcon icon={faChevronRight} />
              </button>
            </div>
          ) : (
            <>
              <div className="sidebar-header">
                {/* 折叠状态下不显示搜索输入框，避免与按钮重叠 */}
                {!isSidebarCollapsed && (
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="搜索笔记…"
                  />
                )}
                <button className="btn" onClick={onSearch} title="搜索">
                  <FontAwesomeIcon icon={faSearch} />
                </button>
                <button className="btn" onClick={() => setShowAddNote(v => !v)} title="新增笔记">
                  <FontAwesomeIcon icon={faPlus} />
                </button>
              </div>
              {/* 新增笔记表单 */}
              {showAddNote && (
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="标题"
                  />
                  <textarea
                    className="textarea"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="正文内容…"
                    rows={4}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn primary" onClick={onSave} disabled={saving}>
                      {saving ? '保存中…' : (editingId ? '更新' : '保存')}
                    </button>
                    {editingId && (
                      <button className="btn" onClick={() => { setEditingId(null); setTitle(''); setContent(''); }}>
                        取消
                      </button>
                    )}
                  </div>
                </div>
              )}
              {/* 笔记列表 */}
              <div className="note-list">
                {list.map(n => (
                  <SidebarNoteItem
                    key={n.id}
                    note={n}
                    onChanged={refresh}
                    onSelect={() => handleSelectNote(n)}
                    isActive={selectedNoteId === n.id}
                  />
                ))}
              </div>
              {/* 侧栏底部：翻页、导入导出、折叠 */}
              <div className="sidebar-footer">
                <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                  <button className="btn" onClick={onExport} title="导出笔记">
                    导出
                  </button>
                  <button className="btn" onClick={onImport} title="导入笔记">
                    导入
                  </button>
                </div>
                <div className="pagination">
                  <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
                    <FontAwesomeIcon icon={faChevronLeft} />
                  </button>
                  <span>{page} / {totalPages}</span>
                  <button className="btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                    <FontAwesomeIcon icon={faChevronRight} />
                  </button>
                </div>
                <button className="collapse-btn" onClick={() => setSidebarCollapsed(true)} title="折叠笔记栏">
                  <FontAwesomeIcon icon={faChevronLeft} />
                </button>
              </div>
            </>
          )}
        </aside>
        {/* 主内容 */}
        <div className="content-area">
          {view === 'mindmap' && <MindMapPage />}
          {view === 'me' && (
            <div>
              <h2>我的成长</h2>
              {/* 周报区域 */}
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0 }}>周报</h3>
                  <button className="btn" onClick={genWeek}>生成周报</button>
                </div>
                {weekReport ? (
                  <div style={{ marginTop: 12 }}>
                    <div>统计周期：{weekReport.start} → {weekReport.end}</div>
                    <div>完成任务：{weekReport.tasks_done}</div>
                    <div>学习时间：{weekReport.minutes_done} 分钟</div>
                    <div>新增笔记：{weekReport.new_notes}</div>
                    <div>平均掌握度：{weekReport.avg_mastery.toFixed(1)}</div>
                    <div style={{ marginTop: 8 }}>
                      <strong>主要差距：</strong>
                      <ul>
                        {weekReport.top_gaps.map(([name, required, mastery, gap], idx) => (
                          <li key={idx}>{name}：要求{required}，掌握{mastery}，差距{gap}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 12, color: '#888' }}>尚未生成周报</div>
                )}
              </div>
              {/* 雷达图区域 */}
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0 }}>能力雷达图</h3>
                  <button
                    className="btn"
                    onClick={async () => {
                      setLoadingRadar(true);
                      try {
                        await invoke('ai_analyze_topics');
                        setRadarTick(v => v + 1);
                      } catch (e) {
                        console.error(e);
                        alert('刷新雷达失败');
                      } finally {
                        setLoadingRadar(false);
                      }
                    }}
                    disabled={loadingRadar}
                  >
                    {loadingRadar ? '刷新中…' : '刷新雷达'}
                  </button>
                </div>
                <div style={{ marginTop: 12 }}>
                  <RadarPanel reloadKey={radarTick} />
                </div>
              </div>
            </div>
          )}
          {view === 'note' && selectedNote && (
            <NoteDetail note={selectedNote} onBack={handleBackToPlan} onChanged={refresh} />
          )}
          {view === 'plan' && selectedNoteId == null && (
            <div>
              <h2 style={{ marginBottom: 8 }}> Know More About You! </h2>
              {/* AI 设置折叠 */}
              <div style={{ marginTop: 8, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn" onClick={async () => { setShowAISettings(v => !v); if (!showAISettings) await loadAIConfig(); }}>
                  {showAISettings ? '收起 AI 设置' : 'AI 设置'}
                </button>
                {aiMsg && <div style={{ fontSize: 12, opacity: 0.8 }}>{aiMsg}</div>}
              </div>
              {showAISettings && (
                <div className="card" style={{ marginTop: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 8, columnGap: 8, alignItems: 'center' }}>
                    <div>Provider</div>
                    <select
                      value={aiCfg.provider || ''}
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
                      className="input"
                      placeholder="https://api.openai.com/v1 或兼容地址"
                      value={aiCfg.api_base || ''}
                      onChange={e => setAiCfg({ ...aiCfg, api_base: e.target.value })}
                    />
                    <div>API Key</div>
                    <input
                      className="input"
                      placeholder="sk-..."
                      value={aiCfg.api_key || ''}
                      onChange={e => setAiCfg({ ...aiCfg, api_key: e.target.value })}
                      style={{ fontFamily: 'monospace' }}
                    />
                    <div>Model</div>
                    <input
                      className="input"
                      placeholder="如 gpt-4o-mini / deepseek-chat / claude-3-5-sonnet 等"
                      value={aiCfg.model || ''}
                      onChange={e => setAiCfg({ ...aiCfg, model: e.target.value })}
                    />
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                    <button className="btn primary" onClick={saveAIConfig}>保存</button>
                    <button className="btn" onClick={smokeAI}>冒烟自检</button>
                  </div>
                </div>
              )}
              {/* 搜索结果区块 */}
              {results.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <h3>搜索结果</h3>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {results.map(hit => (
                      <li key={hit.id} style={{ marginBottom: 16 }}>
                        <div style={{ fontWeight: 600 }} onClick={() => handleSelectNote({ id: hit.id, title: hit.title, content: '', created_at: '' })}>{hit.title}</div>
                        <div dangerouslySetInnerHTML={renderSnippet(hit.snippet)} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* 计划区块 */}
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0 }}>计划</h3>
                  <button className="btn" onClick={() => setShowPlans(v => !v)}>
                    {showPlans ? '隐藏' : '显示'}
                  </button>
                </div>
                {showPlans && <PlanPanel />}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* AI 聊天按钮与抽屉 */}
      {/* 当聊天窗口关闭时，显示浮动的聊天按钮；展开后隐藏 */}
      {!chatOpen && (
        <button
          className="chat-toggle"
          onClick={() => setChatOpen(true)}
        >
          KnoYoo AI
        </button>
      )}
      {/* 聊天抽屉 */}
      <div className={chatOpen ? 'chat-drawer open' : 'chat-drawer'}>
        {/* 聊天头部：标题 + 折叠按钮 */}
        {chatOpen && (
          <div
            style={{
              padding: 12,
              borderBottom: `1px solid var(--border-color)`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span style={{ fontWeight: 600 }}>与 AI 对话</span>
            <button className="collapse-btn" onClick={() => setChatOpen(false)} title="收起聊天">
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
          </div>
        )}
        {!chatOpen && (
          <div style={{ padding: 12, borderBottom: `1px solid var(--border-color)`, fontWeight: 600 }}>与 AI 对话</div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {chatMsgs.map((m, i) => (
            <div key={i} style={{ marginBottom: 10, whiteSpace: 'pre-wrap' }}>
              <div style={{ fontSize: 12, color: '#888' }}>{m.role === 'user' ? '我' : 'AI'}</div>
              <div>{m.content}</div>
            </div>
          ))}
          {chatMsgs.length === 0 && <div style={{ color: '#999' }}>开始提问吧～</div>}
        </div>
        <div style={{ padding: 12, borderTop: `1px solid var(--border-color)` }}>
          <textarea
            rows={3}
            style={{ width: '100%', boxSizing: 'border-box', borderRadius: 8, padding: 8, border: '1px solid var(--border-color)', resize: 'vertical', background: 'rgba(255,255,255,0.8)', color: 'var(--text-color)' }}
            placeholder="输入消息…"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault(); sendChat();
              }
            }}
          />
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn primary" onClick={sendChat}>发送（Ctrl/Cmd+Enter）</button>
          </div>
        </div>
      </div>
    </div>
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

// 新侧边栏笔记项组件，带高亮与选择逻辑
function SidebarNoteItem({
  note,
  onChanged,
  onSelect,
  isActive = false,
}: {
  note: Note;
  onChanged: () => void;
  onSelect?: () => void;
  isActive?: boolean;
}) {
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

  const handleSelect = () => {
    if (!editing && !menuOpen) {
      onSelect?.();
    }
  };

  return (
    <li
      className={"note-row" + (isActive ? " active" : "")}
      onClick={handleSelect}
      style={{ position: "relative" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="note-title" style={{ flex: 1, fontWeight: 600 }}>
          {note.title}
        </span>
        <button
          className="menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          title="更多"
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            ref={menuRef}
            className="menu"
            onClick={(e) => e.stopPropagation()}
          >
            {!editing && (
              <>
                <button onClick={() => setEditing(true)}>编辑</button>
                <button onClick={del}>删除</button>
                <button onClick={autoClassify}>自动归类</button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="note-date">{note.created_at}</div>
      {editing && (
        <div
          className="note-editor-inline"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" onClick={save}>保存</button>
            <button className="btn" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * 笔记详情视图：在主内容区展示单条笔记，提供查看、编辑、删除和自动归类等操作。
 */
function NoteDetail({
  note,
  onBack,
  onChanged,
}: {
  note: Note;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(note.title);
  const [content, setContent] = React.useState(note.content);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await invoke("update_note", { id: note.id, title, content });
      setEditing(false);
      onChanged();
    } catch (e) {
      console.error(e);
      alert("保存失败：" + e);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (confirm("确认删除这条笔记？")) {
      try {
        await invoke("delete_note", { id: note.id });
        onChanged();
        onBack();
      } catch (e) {
        console.error(e);
        alert("删除失败：" + e);
      }
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
    <div className="card" style={{ position: "relative" }}>
      {/* 返回按钮 */}
      <button
        className="btn"
        onClick={onBack}
        style={{ position: "absolute", top: 0, left: 0, margin: 8 }}
      >
        <FontAwesomeIcon icon={faArrowLeft} /> 返回
      </button>
      {/* 主体内容 */}
      <div style={{ paddingTop: 32 }}>
        {editing ? (
          <>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="标题"
            />
            <textarea
              className="textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="正文内容…"
              rows={8}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                className="btn primary"
                onClick={save}
                disabled={saving}
              >
                {saving ? "保存中…" : "保存"}
              </button>
              <button className="btn" onClick={() => setEditing(false)}>取消</button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>{note.title}</h3>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{note.content}</div>
          </>
        )}
        {!editing && (
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn" onClick={() => setEditing(true)}>编辑</button>
            <button className="btn" onClick={autoClassify}>自动归类</button>
            <button className="btn" onClick={del}>删除</button>
          </div>
        )}
      </div>
    </div>
  );
}
