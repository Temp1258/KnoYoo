import React, { useEffect, useMemo, useState, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleXmark } from "@fortawesome/free-solid-svg-icons";
import { tauriInvoke } from "./hooks/useTauriInvoke";
import { useToast } from "./components/common/Toast";
import {
  flattenByDepth,
  findNodeById,
  findNodeByName,
  findPathToNode,
  extractSubtree,
  getNodeWidth,
} from "./utils/treeUtils";
import type { IndustryNode, Point, SkillNote } from "./types";

const BASE_NODE_W = 160;
const MAX_NODE_W = 400;
const NODE_H = 36;
const ROW_GAP = 66;
const PAD_LEFT = 40;
const COL_GAP_DYNAMIC = 60;

export default function MindMapPage() {
  const { showToast, showConfirm } = useToast();
  const [tree, setTree] = useState<IndustryNode[]>([]);
  const [active, setActive] = useState<IndustryNode | null>(null);
  const [skillInput, setSkillInput] = useState("");
  const [pan, setPan] = useState({ x: 0.3, y: 0.3 });
  const [scale, setScale] = useState(1);
  const [drag, setDrag] = useState<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [roots, setRoots] = useState<IndustryNode[]>([]);
  const [savedTrees, setSavedTrees] = useState<{ id: number; name: string; created_at: string }[]>([]);
  const [showSavedPanel, setShowSavedPanel] = useState(false);

  const width = 1200;
  const height = 800;

  const refreshRoots = async () => {
    try {
      const r = await tauriInvoke<IndustryNode[]>("list_root_nodes_v1");
      setRoots(r || []);
    } catch (e) {
      console.error(e);
    }
  };
  useEffect(() => { refreshRoots(); }, []);

  // Drag handlers
  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    setDrag({ startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y });
  };
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drag) return;
    setPan({ x: drag.origX + e.clientX - drag.startX, y: drag.origY + e.clientY - drag.startY });
  };
  const onMouseUp = () => setDrag(null);
  const onCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const k = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.min(3, Math.max(0.3, s * k)));
  };

  const layers = useMemo(() => flattenByDepth(tree), [tree]);

  const widthMap = useMemo(() => {
    const map = new Map<number, number>();
    const traverse = (n: IndustryNode) => {
      map.set(n.id, getNodeWidth(n.name, BASE_NODE_W, MAX_NODE_W));
      (n.children || []).forEach(traverse);
    };
    tree.forEach(traverse);
    return map;
  }, [tree]);

  const layout = useMemo(() => {
    const pos = new Map<number, Point>();
    const colWidths: number[] = [];
    layers.forEach((nodes, depth) => {
      let maxW = 0;
      nodes.forEach((n) => {
        const w = widthMap.get(n.id) ?? BASE_NODE_W;
        if (w > maxW) maxW = w;
      });
      colWidths[depth] = maxW;
    });
    const xPositions: number[] = [];
    let x = PAD_LEFT;
    colWidths.forEach((w, depth) => {
      xPositions[depth] = x;
      x += w + COL_GAP_DYNAMIC;
    });
    layers.forEach((nodes, depth) => {
      const totalH = (nodes.length - 1) * ROW_GAP;
      const offsetY = (height - totalH) / 2;
      nodes.forEach((n, i) => {
        pos.set(n.id, { x: xPositions[depth], y: offsetY + i * ROW_GAP });
      });
    });
    return pos;
  }, [layers, widthMap]);

  function centerOnNodeIds(ids: number[]) {
    const pts = ids.map((id) => layout.get(id)).filter(Boolean) as Point[];
    if (pts.length === 0) return;
    const minX = Math.min(...ids.map((id) => layout.get(id)?.x ?? 0));
    const maxX = Math.max(...ids.map((id) => {
      const p = layout.get(id);
      const w = widthMap.get(id) ?? BASE_NODE_W;
      return p ? p.x + w : 0;
    }));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const cxWorld = (minX + maxX) / 2;
    const cyWorld = (minY + maxY) / 2 + NODE_H / 2;
    setPan({ x: width / 2 - cxWorld * scale, y: height / 2 - cyWorld * scale });
  }

  const onSelect = (node: IndustryNode) => {
    setActive(node);
    const p = layout.get(node.id);
    if (p) {
      const w = widthMap.get(node.id) ?? BASE_NODE_W;
      setPan({ x: width / 2 - (p.x + w / 2) * scale, y: height / 2 - (p.y + NODE_H / 2) * scale });
    }
    canvasRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const edges = useMemo(() => {
    const list: Array<{ from: Point; to: Point }> = [];
    const walk = (n: IndustryNode) => {
      const p = layout.get(n.id);
      (n.children || []).forEach((c) => {
        const q = layout.get(c.id);
        if (p && q) {
          const parentW = widthMap.get(n.id) ?? BASE_NODE_W;
          list.push({
            from: { x: p.x + parentW, y: p.y + NODE_H / 2 },
            to: { x: q.x, y: q.y + NODE_H / 2 },
          });
        }
        walk(c);
      });
    };
    tree.forEach(walk);
    return list;
  }, [tree, layout, widthMap]);

  const addCustomRoot = async () => {
    const name = skillInput.trim();
    if (!name) return;
    try {
      const id = await tauriInvoke<number>("save_custom_root_v1", { name });
      await refreshRoots();
      const all = await tauriInvoke<IndustryNode[]>("list_industry_tree_v1");
      const latest = (all && (findNodeById(all, id) || findNodeByName(all, name))) || null;
      const sub = latest ? extractSubtree(all, latest.id) : null;
      const root = sub ?? { id, name, required_level: 100, importance: 1, mastery: 0, children: [] };
      setTree([root]);
      setActive(root);
      requestAnimationFrame(() => centerOnNodeIds([root.id, ...(root.children?.map((c) => c.id) || [])]));
      setSkillInput("");
      canvasRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (e: any) {
      console.error(e);
      showToast(`保存根节点失败：${e?.message ?? String(e)}`, "error");
    }
  };

  const refreshSavedTrees = async () => {
    try {
      const list = await tauriInvoke<any[]>("list_saved_industry_trees_v1");
      setSavedTrees(list || []);
    } catch (e) {
      console.error(e);
    }
  };

  const onSaveTree = async () => {
    if (!tree || tree.length === 0) {
      showToast("当前没有可以保存的行业树", "error");
      return;
    }
    const name = prompt("请输入行业树的名称：");
    if (!name || !name.trim()) return;
    try {
      await tauriInvoke<number>("save_industry_tree_v1", { name: name.trim() });
      showToast("保存成功");
      refreshSavedTrees();
    } catch (e: any) {
      showToast(`保存失败：${e?.message ?? String(e)}`, "error");
    }
  };

  const aiExpand = async () => {
    let target = active;
    if (!target && tree.length === 1) target = tree[0];
    if (!target) {
      showToast("请先点击画布中的一个节点再生成", "error");
      return;
    }
    try {
      const path = findPathToNode(tree, target.id)?.map((n) => n.name) || [target.name];
      const freshWhole = await tauriInvoke<IndustryNode[]>("ai_expand_node_v2", {
        name: target.name,
        parentId: target.id,
        pathNames: path,
      });
      const latestRoot = findNodeByName(freshWhole || [], target.name);
      if (!latestRoot) {
        showToast("生成完成，但未找到对应节点，请重试", "error");
        return;
      }
      const latestSub = extractSubtree(freshWhole || [], latestRoot.id)!;
      setTree([latestSub]);
      setActive(latestSub);
      requestAnimationFrame(() => {
        centerOnNodeIds([latestSub.id, ...(latestSub.children?.map((c) => c.id) || [])]);
      });
      setSkillInput("");
      canvasRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (e: any) {
      console.error(e);
      showToast(`AI 生成失败：${e?.message ?? String(e)}`, "error");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      {/* Root nodes bar */}
      <div className="root-nodes-bar">
        <span style={{ color: "#6b7280", flex: "0 0 auto" }}>我的根节点：</span>
        {roots.length === 0 ? (
          <span style={{ color: "#9ca3af" }}>暂无，先在右侧输入框添加</span>
        ) : (
          <>
            {roots.map((r) => (
              <span
                key={r.id}
                className={`root-chip ${tree[0]?.id === r.id ? "active" : ""}`}
              >
                <a
                  onClick={async () => {
                    try {
                      const all = await tauriInvoke<IndustryNode[]>("list_industry_tree_v1");
                      const latest = findNodeById(all || [], r.id) || findNodeByName(all || [], r.name);
                      const sub = latest ? extractSubtree(all || [], latest.id) : null;
                      if (sub) {
                        setTree([sub]);
                        setActive(sub);
                        requestAnimationFrame(() => centerOnNodeIds([sub.id, ...(sub.children?.map((c) => c.id) || [])]));
                        canvasRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
                      }
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                  className="root-chip-link"
                  title={r.name}
                >
                  {r.name}
                </a>
                <button
                  onClick={async () => {
                    const ok = await showConfirm(`删除根节点"${r.name}"（含其全部子项）？`);
                    if (!ok) return;
                    try {
                      await tauriInvoke("delete_root_and_subtree_v1", { rootId: r.id });
                      await refreshRoots();
                      if (tree[0]?.id === r.id) { setTree([]); setActive(null); }
                    } catch (e: any) {
                      showToast(`删除失败：${e?.message ?? String(e)}`, "error");
                    }
                  }}
                  className="root-delete-btn"
                  title="删除该根"
                >
                  <FontAwesomeIcon icon={faCircleXmark} />
                </button>
              </span>
            ))}
            <button
              onClick={async () => {
                if (!roots.length) return;
                const ok = await showConfirm(`确认清空 ${roots.length} 个根节点及其子树？该操作不可撤销。`);
                if (!ok) return;
                try {
                  await tauriInvoke("clear_all_roots_v1");
                  await refreshRoots();
                  setTree([]);
                  setActive(null);
                } catch (e: any) {
                  showToast(`清空失败：${e?.message ?? String(e)}`, "error");
                }
              }}
              className="btn"
              style={{ marginLeft: 8, flex: "0 0 auto" }}
            >
              清空历史记录
            </button>
            <button
              className="btn"
              onClick={() => {
                const ids: number[] = [];
                const gather = (n: IndustryNode) => { ids.push(n.id); (n.children || []).forEach(gather); };
                tree.forEach(gather);
                if (ids.length > 0) centerOnNodeIds(ids);
              }}
              style={{ marginLeft: 8, flex: "0 0 auto" }}
            >
              画布居中
            </button>
          </>
        )}
      </div>

      {/* Saved trees panel */}
      {showSavedPanel && (
        <div className="saved-trees-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>我的行业树</strong>
            <button onClick={() => setShowSavedPanel(false)} className="btn">×</button>
          </div>
          <button className="btn" onClick={onSaveTree} style={{ marginTop: 8, marginBottom: 12 }}>
            保存当前行业树
          </button>
          {savedTrees.length === 0 ? (
            <div style={{ color: "#6b7280" }}>暂无保存的行业树</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {savedTrees.map((t) => (
                <li key={t.id} className="saved-tree-item">
                  <div className="saved-tree-name" title={t.name}>{t.name}</div>
                  <div className="saved-tree-date">{new Date(t.created_at).toLocaleString()}</div>
                  <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          const loaded = await tauriInvoke<IndustryNode[]>("get_saved_industry_tree_v1", { id: t.id });
                          setTree(loaded || []);
                          setActive(null);
                          requestAnimationFrame(() => {
                            const ids: number[] = [];
                            const gather = (n: IndustryNode) => { ids.push(n.id); (n.children || []).forEach(gather); };
                            (loaded || []).forEach(gather);
                            if (ids.length > 0) centerOnNodeIds(ids);
                          });
                          setShowSavedPanel(false);
                        } catch (e: any) {
                          showToast(`加载失败：${e?.message ?? String(e)}`, "error");
                        }
                      }}
                    >
                      加载
                    </button>
                    <button
                      className="btn"
                      onClick={async () => {
                        const ok = await showConfirm(`确认删除行业树"${t.name}"吗？`);
                        if (!ok) return;
                        try {
                          await tauriInvoke("delete_saved_industry_tree_v1", { id: t.id });
                          refreshSavedTrees();
                        } catch (e: any) {
                          showToast(`删除失败：${e?.message ?? String(e)}`, "error");
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Header with input */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>行业树</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            placeholder="手动输入一个行业/能力，如 Data Scientist"
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            style={{ width: 320, height: 32, padding: "0 8px" }}
          />
          <button className="btn" onClick={addCustomRoot}>添加根节点</button>
          <button className="btn primary" onClick={aiExpand}>从AI生成</button>
          <button
            className="btn"
            onClick={() => {
              const next = !showSavedPanel;
              if (next) refreshSavedTrees();
              setShowSavedPanel(next);
            }}
          >
            我的行业树
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        onWheel={onCanvasWheel}
        onWheelCapture={onCanvasWheel}
        className="mindmap-canvas"
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${width} ${height}`}
          style={{ background: "#f8fafc", cursor: drag ? "grabbing" : "grab" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
            <g>
              {edges.map((e, idx) => {
                const c1x = e.from.x + 40;
                const c2x = e.to.x - 40;
                const d = `M ${e.from.x} ${e.from.y} C ${c1x} ${e.from.y}, ${c2x} ${e.to.y}, ${e.to.x} ${e.to.y}`;
                return <path key={idx} d={d} stroke="#cbd5e1" strokeWidth={2} fill="none" />;
              })}
            </g>
            <g>
              {layers.flat().map((n) => {
                const p = layout.get(n.id)!;
                const selected = active?.id === n.id;
                return (
                  <g key={n.id} transform={`translate(${p.x}, ${p.y})`} onClick={() => onSelect(n)} style={{ cursor: "pointer" }}>
                    <rect
                      width={widthMap.get(n.id) ?? BASE_NODE_W}
                      height={NODE_H}
                      rx={8}
                      ry={8}
                      fill={selected ? "#0ea5e9" : "#ffffff"}
                      stroke={selected ? "#0284c7" : "#cbd5e1"}
                      strokeWidth={selected ? 2 : 1}
                    />
                    <text x={8} y={22} fontSize={13} fill={selected ? "#ffffff" : "#111827"}>
                      {n.name}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      </div>

      {/* Detail panel */}
      <div className="mindmap-detail">
        {active ? (
          <div>
            <div style={{ fontWeight: 600 }}>{active.name}</div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    const notes = await tauriInvoke<SkillNote[]>("list_skill_notes_v1", { skill_id: active.id, limit: 50 });
                    showToast(`该节点关联笔记：${Array.isArray(notes) ? notes.length : 0} 条`);
                  } catch (e) {
                    showToast("加载节点关联笔记失败", "error");
                  }
                }}
              >
                查看关联笔记
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
