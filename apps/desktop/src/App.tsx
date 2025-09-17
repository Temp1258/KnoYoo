import { useEffect, useState } from "react";
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
    <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, marginTop: 16 }}>
      <h2 style={{ margin: "0 0 8px" }}>能力雷达（Top-8 差距）</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button onClick={load} disabled={loading}>刷新</button>
        {msg && <div style={{ fontSize: 12, opacity: 0.8 }}>{msg}</div>}
      </div>

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
      </svg>

      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
        灰色虚线 = 要求（L1~L5→×20），蓝色 = 当前掌握（0~100）。
      </div>
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
    skill_id?: number | null;
    title: string;
    minutes: number;
    due?: string | null;
    status: string;
    horizon: string;
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

  function PlanPanel() {
    const [horizon, setHorizon] = useState<"WEEK" | "QTR">("WEEK");
    const [tasks, setTasks] = useState<PlanTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");

    async function load() {
      setLoading(true);
      setMsg("");
      try {
        const res = (await invoke("list_plan_tasks", { horizon })) as PlanTask[];
        setTasks(res);
      } catch (e: any) {
        setMsg(String(e));
      } finally {
        setLoading(false);
      }
    }

    useEffect(() => {
      load();
    }, [horizon]);

    async function gen(h: "WEEK" | "QTR") {
      setLoading(true);
      setMsg("");
      try {
        const res = (await invoke("generate_plan", { horizon: h })) as any[];
        setMsg(`生成 ${Array.isArray(res) ? res.length : 0} 条计划`);
        await load();
      } catch (e: any) {
        setMsg(String(e));
        setLoading(false);
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

    return (
      <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, marginTop: 16 }}>
        <h2 style={{ margin: "0 0 8px" }}>计划</h2>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <label>
            <input
              type="radio"
              value="WEEK"
              checked={horizon === "WEEK"}
              onChange={() => setHorizon("WEEK")}
            />{" "}
            WEEK
          </label>
          <label>
            <input
              type="radio"
              value="QTR"
              checked={horizon === "QTR"}
              onChange={() => setHorizon("QTR")}
            />{" "}
            QTR
          </label>

          <button onClick={() => gen("WEEK")} disabled={loading}>生成周计划</button>
          <button onClick={() => gen("QTR")} disabled={loading}>生成三月计划</button>
          <button onClick={load} disabled={loading}>刷新</button>
        </div>

        {msg && <div style={{ marginBottom: 8, fontSize: 12, opacity: 0.8 }}>{msg}</div>}
        {loading ? (
          <div>Loading…</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {tasks.map((t) => (
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
                  <div
                    style={{
                      fontWeight: 600,
                      textDecoration: t.status === "DONE" ? "line-through" : "none",
                    }}
                  >
                    {t.title}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {t.minutes ? `min: ${t.minutes}` : "min: -"}
                    {t.due ? ` • due: ${t.due}` : ""}
                    {typeof t.skill_id === "number" ? ` • skill: ${t.skill_id}` : ""}
                  </div>
                </div>
                <span style={{ fontSize: 12, opacity: 0.7 }}>{t.horizon}</span>
                <button onClick={() => del(t)}>删除</button>
              </li>
            ))}
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

      <hr style={{ margin: "16px 0" }} />

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

      <h3 style={{ marginTop: 24 }}>全文搜索（FTS5）</h3>
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
            </div>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
        <button onClick={() => setPage(p => p + 1)}>下一页</button>
        <button onClick={refresh}>刷新</button>
      </div>

      {/* ---- 计划区块（新增） ---- */}
      <h3 style={{ marginTop: 24 }}>计划</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button onClick={onSeedIndustry}>初始化行业树种子</button>
        <button onClick={() => onGenerate("WEEK")}>生成周计划</button>
        <button onClick={() => onGenerate("QTR")}>生成三月计划</button>

        <button onClick={async () => {
          const n = await invoke<number>("cleanup_plan_duplicates", { horizon: planHorizon });
          alert(`已清理重复：${n} 条`);
          await loadPlans();
        }}>清理重复</button>

        <select
          value={planHorizon}
          onChange={(e) => { const v = e.target.value as "WEEK" | "QTR"; setPlanHorizon(v); loadPlans(v, planFilter); }}
          style={{ marginLeft: 12 }}
        >
          <option value="WEEK">WEEK</option>
          <option value="QTR">QTR</option>
        </select>

        <select
          value={planFilter}
          onChange={(e) => { const v = e.target.value as "ALL"|"TODO"|"DONE"; setPlanFilter(v); loadPlans(planHorizon, v); }}
        >
          <option value="ALL">全部</option>
          <option value="TODO">TODO</option>
          <option value="DONE">DONE</option>
        </select>

        <button onClick={() => loadPlans()}>刷新</button>
      </div>

      <ul style={{ marginTop: 8 }}>
        {plans.map(t => (
          <li key={t.id} style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={t.status === "DONE"} onChange={() => toggleDone(t)} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{t.title}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {t.horizon} · {t.minutes} 分钟{t.due ? ` · 截止 ${t.due}` : ""}
              </div>
            </div>
            <span style={{
              fontSize: 12,
              padding: "2px 6px",
              borderRadius: 6,
              background: t.status === "DONE" ? "#e6ffed" : "#fffbe6",
              border: "1px solid #ddd"
            }}>
              {t.status}
            </span>
            <button onClick={async () => {
              const title = window.prompt("新标题：", t.title) ?? t.title;
              const minutesStr = window.prompt("分钟数：", String(t.minutes)) ?? String(t.minutes);
              const due = window.prompt("截止日期(YYYY-MM-DD，可留空)：", t.due ?? "") ?? (t.due ?? "");
              const minutes = parseInt(minutesStr || "0", 10) || 0;
              await invoke("update_plan_task", { id: t.id, title, minutes, due: due || null });
              await loadPlans();
            }}>编辑</button>
            <button onClick={async () => {
              if (confirm("删除这条任务？")) {
                await invoke("delete_plan_task", { id: t.id });
                await loadPlans();
              }
            }} style={{ marginLeft: 6 }}>删除</button>
          </li>
        ))}
      </ul>

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
      <PlanPanel />
      <RadarPanel />
    </div>
  );
}
