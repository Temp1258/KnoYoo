import React, {useEffect, useMemo, useState, useRef } from "react";

type IndustryNode = {
  id: number;
  name: string;
  required_level: number;
  importance: number;
  mastery?: number | null;
  children: IndustryNode[];
};

type Point = { x: number; y: number };

type SkillNote = {
    id: number;
    title: string;
    created_at: string;
    snippet?: string | null;
    };

// 统一调用：优先 window.__TAURI__.invoke；否则动态导入 @tauri-apps/api/core
async function tauriInvoke<T = any>(cmd: string, args?: Record<string, any>): Promise<T> {
  const w = window as any;
  if (w?.__TAURI__?.invoke) {
    return w.__TAURI__.invoke(cmd, args);
  }
  const mod = await import(/* @vite-ignore */ "@tauri-apps/api/core");
  const inv = (mod as any).invoke as <U = any>(c: string, a?: Record<string, any>) => Promise<U>;
  if (typeof inv !== "function") {
    throw new Error("Tauri invoke not found on window or '@tauri-apps/api/core'.");
  }
  return inv<T>(cmd, args);
}



// 简单把树拍扁成“层级数组”
function flattenByDepth(roots: IndustryNode[]): IndustryNode[][] {
  const layers: IndustryNode[][] = [];
  const dfs = (n: IndustryNode, d: number) => {
    if (!layers[d]) layers[d] = [];
    layers[d].push(n);
    (n.children || []).forEach(c => dfs(c, d + 1));
  };
  roots.forEach(r => dfs(r, 0));
  return layers;
}

// 按“导图风格”在每层纵向排布节点，并用贝塞尔曲线相连
export default function MindMapPage() {
  const [tree, setTree] = useState<IndustryNode[]>([]);
  const [active, setActive] = useState<IndustryNode | null>(null);
  const [skillInput, setSkillInput] = useState("");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [drag, setDrag] = useState<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [notes, setNotes] = useState<SkillNote[]>([]);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [roots, setRoots] = useState<IndustryNode[]>([]);

  // 保存行业树的列表与面板状态
  const [savedTrees, setSavedTrees] = useState<{ id: number; name: string; created_at: string }[]>([]);
  const [showSavedPanel, setShowSavedPanel] = useState(false);


  const refreshRoots = async () => {
    try {
      const r = await tauriInvoke<IndustryNode[]>("list_root_nodes_v1");
      setRoots(r || []);
    } catch (e) { console.error(e); }
  };
  useEffect(() => { refreshRoots(); }, []);


  // 拖拽开始
  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    setDrag({ startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y });
  };


  // 拖拽中
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setPan({ x: drag.origX + dx, y: drag.origY + dy });
  };


  // 拖拽结束
  const onMouseUp = () => setDrag(null);

  
  // 滚轮缩放（以鼠标位置为中心缩放的简化版）
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const k = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(3, Math.max(0.3, scale * k));
    setScale(newScale);
  };

  
  const onCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();     // 阻止页面滚动
    e.stopPropagation();
    const k = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(3, Math.max(0.3, scale * k));
    setScale(newScale);
  };


  const layers = useMemo(() => flattenByDepth(tree), [tree]);

  // 画布大小
  const width = 1200;
  const height = 800;
  const colGap = 260;
  const rowGap = 66;
  const nodeW = 160;
  const nodeH = 36;
  const padLeft = 40;

  // 计算每个节点坐标
  const layout = useMemo(() => {
    const pos = new Map<number, Point>();
    layers.forEach((nodes, depth) => {
      const totalH = (nodes.length - 1) * rowGap;
      const offsetY = (height - totalH) / 2;
      nodes.forEach((n, i) => {
        pos.set(n.id, {
          x: padLeft + depth * colGap,
          y: offsetY + i * rowGap
        });
      });
    });
    return pos;
  }, [layers]);

// 递归在树中寻找指定 id 的节点
function findNodeById(roots: IndustryNode[], id: number): IndustryNode | null {
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    if (n.children?.length) stack.push(...n.children);
  }
  return null;
}

// 在整棵树里按名字（不区分大小写）寻找节点
function findNodeByName(roots: IndustryNode[], name: string): IndustryNode | null {
  const key = name.trim().toLowerCase();
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.name.trim().toLowerCase() === key) return n;
    if (n.children?.length) stack.push(...n.children);
  }
  return null;
}

// 寻找某个节点从根到它的路径，返回节点数组
function findPathToNode(roots: IndustryNode[], id: number): IndustryNode[] | null {
  for (const r of roots) {
    const stack: { node: IndustryNode; path: IndustryNode[] }[] = [];
    stack.push({ node: r, path: [r] });
    while (stack.length) {
      const { node, path } = stack.pop()!;
      if (node.id === id) return path;
      if (node.children && node.children.length) {
        for (const c of node.children) {
          stack.push({ node: c, path: [...path, c] });
        }
      }
    }
  }
  return null;
}


// 从整棵树里提取以 id 为根的子树（深拷贝），用于“单根聚焦”
function extractSubtree(roots: IndustryNode[], id: number): IndustryNode | null {
  const src = findNodeById(roots, id);
  if (!src) return null;
  const clone = (n: IndustryNode): IndustryNode => ({
    id: n.id,
    name: n.name,
    required_level: n.required_level,
    importance: n.importance,
    mastery: n.mastery ?? null,
    children: (n.children || []).map(clone),
  });
  return clone(src);
}


// 把一组节点的“包围盒中心”居中显示（基于当前 layout/scale）
function centerOnNodeIds(ids: number[]) {
  const pts = ids.map(id => layout.get(id)).filter(Boolean) as Point[];
  if (pts.length === 0) return;
  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));
  const cxWorld = (minX + maxX) / 2 + nodeW / 2;
  const cyWorld = (minY + maxY) / 2 + nodeH / 2;

  const cx = width / 2 - cxWorld * scale;
  const cy = height / 2 - cyWorld * scale;
  setPan({ x: cx, y: cy });
}

  // 选择节点
  const onSelect = (node: IndustryNode) => {
    setActive(node);
  
    // 自动居中到被点击的节点
    const p = layout.get(node.id);
    if (p) {
      const cx = width / 2 - (p.x + nodeW / 2) * scale;
      const cy = height / 2 - (p.y + nodeH / 2) * scale;
      setPan({ x: cx, y: cy });
    }
    // 不滚动页面，避免画布操作导致页面整体滚动
    canvasRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    // 暂不加载笔记。后续点击“从AI生成”来补全该节点的子树。
  };

  
  // 收集边（父->子）
  const edges = useMemo(() => {
    const list: Array<{ from: Point; to: Point }> = [];
    const walk = (n: IndustryNode) => {
      const p = layout.get(n.id);
      (n.children || []).forEach(c => {
        const q = layout.get(c.id);
        if (p && q) list.push({ from: { x: p.x + nodeW, y: p.y + nodeH / 2 }, to: { x: q.x, y: q.y + nodeH / 2 } });
        walk(c);
      });
    };
    tree.forEach(walk);
    return list;
  }, [tree, layout]);

  
  const addCustomRoot = async () => {
    const name = skillInput.trim();
    if (!name) return;
    try {
      const id = await tauriInvoke<number>("save_custom_root_v1", { name });
      await refreshRoots();

      // 取整棵树 → 只抽取该根做“单根聚焦”
      const all = await tauriInvoke<IndustryNode[]>("list_industry_tree_v1");
      const latest = (all && (findNodeById(all, id) || findNodeByName(all, name))) || null;
      const sub = latest ? extractSubtree(all, latest.id) : null;

      const root = sub ?? { id, name, required_level: 100, importance: 1, mastery: 0, children: [] };
      setTree([root]);
      setActive(root);

      requestAnimationFrame(() => {
        const ids = [root.id, ...(root.children?.map(c => c.id) || [])];
        centerOnNodeIds(ids);
      });

      setSkillInput("");
      // 不滚动页面，避免画布操作导致页面整体滚动
      canvasRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (e:any) {
      console.error(e);
      alert(`保存根节点失败：${e?.message ?? String(e)}`);
    }
  };

  // 获取所有已保存的行业树信息
  const refreshSavedTrees = async () => {
    try {
      const list = await tauriInvoke<any[]>("list_saved_industry_trees_v1");
      setSavedTrees(list || []);
    } catch (e) {
      console.error(e);
    }
  };

  // 保存当前行业树
  const onSaveTree = async () => {
    if (!tree || tree.length === 0) {
      alert("当前没有可以保存的行业树");
      return;
    }
    const name = prompt("请输入行业树的名称：");
    if (!name || !name.trim()) return;
    try {
      await tauriInvoke<number>("save_industry_tree_v1", { name: name.trim() });
      alert("保存成功");
      refreshSavedTrees();
    } catch (e: any) {
      console.error(e);
      alert(`保存失败：${e?.message ?? String(e)}`);
    }
  };
  
  

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          whiteSpace: "nowrap",
          overflowX: "auto",
          overflowY: "hidden",
          paddingBottom: 6,
          borderBottom: "1px dashed #e5e7eb",
        }}
      >
        <span style={{ color: "#6b7280", flex: "0 0 auto" }}>我的根节点：</span>
        {roots.length === 0 ? (
          <span style={{ color: "#9ca3af" }}>暂无，先在右侧输入框添加</span>
        ) : (
          <>
            {roots.map(r => (
              <span
                key={r.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 999,
                  background: tree[0]?.id === r.id ? "#e0f2fe" : "#fff",
                  flex: "0 0 auto",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <a
                  onClick={async () => {
                    // 单根聚焦：切换到该根
                    try {
                      const all = await tauriInvoke<IndustryNode[]>("list_industry_tree_v1");
                      const latest = findNodeById(all || [], r.id) || findNodeByName(all || [], r.name);
                      const sub = latest ? extractSubtree(all || [], latest.id) : null;
                      if (sub) {
                        setTree([sub]); setActive(sub);
                        requestAnimationFrame(() => centerOnNodeIds([sub.id, ...(sub.children?.map(c=>c.id)||[])]));
                        // 不滚动页面，避免画布操作导致页面整体滚动
                        canvasRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
                      }
                    } catch (e) { console.error(e); }
                  }}
                  style={{
                    cursor: "pointer",
                    textDecoration: "none",
                    color: "#0369a1",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={r.name}
                >
                  {r.name}
                </a>
                <button
                  onClick={async () => {
                    if (!confirm(`删除根节点“${r.name}”（含其全部子项）？`)) return;
                    try {
                      await tauriInvoke("delete_root_and_subtree_v1", { rootId: r.id });
                      await refreshRoots();
                      if (tree[0]?.id === r.id) { setTree([]); setActive(null); }
                    } catch (e:any) {
                      console.error(e); alert(`删除失败：${e?.message ?? String(e)}`);
                    }
                  }}
                  style={{ border: "none", background: "transparent", color: "#ef4444", cursor: "pointer" }}
                  title="删除该根"
                >×</button>
              </span>
            ))}
            {/* 根列表右侧，新增一键清空 */}
            <button
              onClick={async () => {
                if (!roots.length) return;
                if (!confirm(`确认清空 ${roots.length} 个根节点及其子树？该操作不可撤销。`)) return;
                try {
                  await tauriInvoke("clear_all_roots_v1");
                  await refreshRoots();
                  setTree([]);
                  setActive(null);
                } catch (e: any) {
                  console.error(e);
                  alert(`清空失败：${e?.message ?? String(e)}`);
                }
              }}
              style={{ marginLeft: 8, flex: "0 0 auto" }}
            >
              清空根节点
            </button>
            <button
              onClick={() => {
                // 收集所有节点 ID 并居中整个树
                const ids: number[] = [];
                const gather = (n: IndustryNode) => {
                  ids.push(n.id);
                  (n.children || []).forEach(gather);
                };
                tree.forEach(gather);
                if (ids.length > 0) {
                  centerOnNodeIds(ids);
                }
              }}
              style={{ marginLeft: 8, flex: "0 0 auto" }}
            >
              画布居中
            </button>
          </>
        )}
      </div>
      {/* 侧边保存/加载行业树面板 */}
      {showSavedPanel && (
        <div
          style={{
            position: "fixed",
            top: 80,
            right: 0,
            width: 280,
            height: "80vh",
            background: "#ffffff",
            borderLeft: "1px solid #e5e7eb",
            boxShadow: "-4px 0 8px rgba(0,0,0,0.05)",
            padding: 12,
            zIndex: 100,
            overflowY: "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>我的行业树</strong>
            <button
              onClick={() => setShowSavedPanel(false)}
              style={{ border: "none", background: "transparent", cursor: "pointer" }}
            >
              ×
            </button>
          </div>
          <button onClick={onSaveTree} style={{ marginTop: 8, marginBottom: 12 }}>
            保存当前行业树
          </button>
          {savedTrees.length === 0 ? (
            <div style={{ color: "#6b7280" }}>暂无保存的行业树</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {savedTrees.map(t => (
                <li key={t.id} style={{ borderBottom: "1px solid #f3f4f6", padding: "6px 0" }}>
                  <div
                    style={{
                      fontSize: 14,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={t.name}
                  >
                    {t.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>
                    {new Date(t.created_at).toLocaleString()}
                  </div>
                  <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                    <button
                      onClick={async () => {
                        try {
                          const loaded = await tauriInvoke<IndustryNode[]>(
                            "get_saved_industry_tree_v1",
                            { id: t.id }
                          );
                          setTree(loaded || []);
                          setActive(null);
                          // 居中整个树
                          requestAnimationFrame(() => {
                            const ids: number[] = [];
                            const gather = (n: IndustryNode) => {
                              ids.push(n.id);
                              (n.children || []).forEach(gather);
                            };
                            (loaded || []).forEach(gather);
                            if (ids.length > 0) {
                              centerOnNodeIds(ids);
                            }
                          });
                          setShowSavedPanel(false);
                        } catch (e: any) {
                          console.error(e);
                          alert(`加载失败：${e?.message ?? String(e)}`);
                        }
                      }}
                    >
                      加载
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`确认删除行业树“${t.name}”吗？`)) return;
                        try {
                          await tauriInvoke("delete_saved_industry_tree_v1", { id: t.id });
                          refreshSavedTrees();
                        } catch (e: any) {
                          console.error(e);
                          alert(`删除失败：${e?.message ?? String(e)}`);
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>行业树</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="手动输入一个行业/能力，如 Data Scientist"
            value={skillInput}
            onChange={e => setSkillInput(e.target.value)}
            style={{ width: 320, height: 32, padding: "0 8px" }}
          />
          <button onClick={addCustomRoot}>添加为根节点</button>
          <button
            onClick={async () => {
              // 目标：优先选中；否则当画布仅有一个根时用它
              let target = active;
              if (!target && tree.length === 1) target = tree[0];
              if (!target) {
                alert("请先点击画布中的一个节点（或先添加一个根节点）再生成。");
                return;
              }
            
              try {
                // 生成路径：从根到选中节点，作为 AI 提示上下文
                const path = findPathToNode(tree, target.id)?.map(n => n.name) || [target.name];
                const freshWhole = await tauriInvoke<IndustryNode[]>("ai_expand_node_v2", {
                  name: target.name,
                  parentId: target.id,
                  pathNames: path
                });
            
                // 在返回的整棵树里，按名字找到刚刚的那个节点，然后提取它的子树
                const latestRoot = findNodeByName(freshWhole || [], target.name);
                if (!latestRoot) {
                  console.warn("not found by name in fresh tree:", target.name);
                  alert("生成完成，但未找到对应节点，请重试或更换名称。");
                  return;
                }
                const latestSub = extractSubtree(freshWhole || [], latestRoot.id)!;
            
                // 进入“单根聚焦”：只保留该子树
                setTree([latestSub]);
                setActive(latestSub);
            
                // 等布局更新后，把【父节点 + 直接子技能】作为包围盒居中
                requestAnimationFrame(() => {
                  const ids = [latestSub.id, ...(latestSub.children?.map(c => c.id) || [])];
                  centerOnNodeIds(ids);
                });
            
                setSkillInput("");
                // 不滚动页面，避免画布操作导致页面整体滚动
                canvasRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
              } catch (e: any) {
                console.error(e);
                alert(`AI 生成失败：${e?.message ?? String(e)}`);
              }
            }}            

          >
            从AI生成
          </button>

          {/* 打开保存/管理行业树面板 */}
          <button
            onClick={() => {
              const next = !showSavedPanel;
              if (next) {
                refreshSavedTrees();
              }
              setShowSavedPanel(next);
            }}
          >
            我的行业树
          </button>

        </div>
      </div>

      {/* 画布 */}
      <div
        ref={canvasRef}
        onWheel={onCanvasWheel}
        onWheelCapture={onCanvasWheel}
        style={{
          marginTop: 12,
          border: "1px solid #e5e7eb",
          // 统一与计划卡片相同的圆角，让行业树画布更加柔和
          borderRadius: 16,
          overflow: "hidden",
          position: "relative",
          /* 宽度占据剩余空间，避免右侧留白 */
          flex: 1,
          width: '100%',
          /* 固定画布高度，滚轮只在画布内生效 */
          height: "70vh"
        }}
      >
        <svg
        width={width}
        height={height}
        style={{ background: "#f8fafc", cursor: drag ? "grabbing" : "grab" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
            {/* 边（贝塞尔曲线） */}
            <g>
            {edges.map((e, idx) => {
                const c1x = e.from.x + 40;
                const c2x = e.to.x - 40;
                const d = `M ${e.from.x} ${e.from.y} C ${c1x} ${e.from.y}, ${c2x} ${e.to.y}, ${e.to.x} ${e.to.y}`;
                return <path key={idx} d={d} stroke="#cbd5e1" strokeWidth={2} fill="none" />;
            })}
            </g>

            {/* 节点 */}
            <g>
            {layers.flat().map(n => {
                const p = layout.get(n.id)!;
                const selected = active?.id === n.id;
                return (
                <g key={n.id} transform={`translate(${p.x}, ${p.y})`} onClick={() => onSelect(n)} style={{ cursor: "pointer" }}>
                    <rect width={nodeW} height={nodeH} rx={8} ry={8}
                        fill={selected ? "#0ea5e9" : "#ffffff"}
                        stroke={selected ? "#0284c7" : "#cbd5e1"} strokeWidth={selected ? 2 : 1} />
                    <text x={8} y={22} fontSize={13} fill={selected ? "#ffffff" : "#111827"}>{n.name}</text>
                </g>
                );
            })}
            </g>
        </g>
        </svg>
                {/* 已移除悬浮信息卡 */}

      </div>

      {/* 右侧详情（简单版） */}
      <div style={{ marginTop: 10, padding: 10, border: "1px dashed #e5e7eb", borderRadius: 8 }}>
        {active ? (
          <div>
            <div style={{ fontWeight: 600 }}>{active.name}</div>
            <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
              required={active.required_level} · importance={active.importance}
              {typeof active.mastery === "number" ? ` · mastery=${active.mastery}` : ""}
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button
                onClick={async () => {
                  try {
                    const notes = await tauriInvoke<any[]>("list_skill_notes_v1", { skill_id: active.id, limit: 50 });
                    console.log("[MindMap] 节点关联笔记", notes);
                    alert(`该节点关联笔记：${Array.isArray(notes) ? notes.length : 0} 条（详情见控制台）`);
                  } catch (e) {
                    console.error(e);
                    alert("加载节点关联笔记失败");
                  }
                }}
              >
                查看关联笔记
              </button>
              <button
                title="下一轮加入：加入到计划"
                onClick={() => alert("下一轮将加入：把该节点添加到计划")}
              >
                加入计划（即将支持）
              </button>
            </div>
          </div>
        ) : (
          null
        )}
      </div>
    </div>
  );
}
