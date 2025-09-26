import React, { useEffect, useMemo, useState } from "react";

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

  // 手动添加一个“自定义根节点”（仅前端内存，后续我们会做持久化+AI生成）
  const addCustomRoot = () => {
    if (!skillInput.trim()) return;
    const newNode: IndustryNode = {
      id: Date.now(), name: skillInput.trim(),
      required_level: 100, importance: 1, mastery: 0, children: []
    };
    setTree(prev => {
       const next = [newNode, ...prev];
      // 下一帧等 layout 更新后再计算坐标居中，避免首次添加时取不到位置
       requestAnimationFrame(() => {
         // 这里用最新的 tree 重算过的 layout 进行定位
         const p = layout.get(newNode.id);
         if (p) {
           const cx = width / 2 - (p.x + nodeW / 2) * scale;
           const cy = height / 2 - (p.y + nodeH / 2) * scale;
           setPan({ x: cx, y: cy });
           setActive(newNode);
         }
       });
       return next;
     });
    setSkillInput("");
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>行业图谱（思维导图 · 最小可用版）</h2>
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
                const query = (skillInput || active?.name || "").trim();
                if (!query) {
                  alert("请先在左侧输入一个行业/能力，或点击某个节点后再生成。");
                  return;
                }
                try {
                  // 构造扁平参数：只有在有选中节点时才传 parent_id（避免传 null）
                  const args: any = { query };
                  if (active) args.parent_id = active.id;

                  const freshTree = await tauriInvoke<IndustryNode[]>("ai_generate_industry_tree_v1", args);
                  setTree(freshTree || []);

                  // 如果当前无选中，则把新建的根作为选中并居中
                  if (!active) {
                    const root = (freshTree || []).find(
                      n => n.name.toLowerCase() === query.toLowerCase()
                    );
                    if (root) {
                      setActive(root);
                      const p = layout.get(root.id);
                      if (p) {
                        const cx = width / 2 - (p.x + nodeW / 2) * scale;
                        const cy = height / 2 - (p.y + nodeH / 2) * scale;
                        setPan({ x: cx, y: cy });
                      }
                    }
                  }
                  setSkillInput("");
                } catch (e: any) {
                  console.error(e);
                  alert(`AI 生成失败：${e?.message ?? String(e)}`);
                }
              }}
            >
              从AI生成
            </button>

        </div>
      </div>

      {/* 画布 */}
      <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", position: "relative" }}>
        <svg
        width={width}
        height={height}
        style={{ background: "#f8fafc", cursor: drag ? "grabbing" : "grab" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
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
                {/* 悬浮信息卡（显示在被选节点附近） */}
        {active && (() => {
        const p = layout.get(active.id);
        if (!p) return null;
        // 需要把节点坐标应用 pan/scale 转换成屏幕坐标
        const screenX = pan.x + (p.x + nodeW + 8) * scale; // 节点右侧 8px
        const screenY = pan.y + (p.y) * scale;

        return (
            <div
            style={{
                position: "absolute",
                left: screenX,
                top: screenY,
                background: "#fff",
                border: "1px solid #e5e7eb",
                boxShadow: "0 6px 16px rgba(0,0,0,0.08)",
                borderRadius: 8,
                padding: "8px 10px",
                pointerEvents: "none", // 仅显示；真的需要交互再开启
            }}
            >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{active.name}</div>
            <div style={{ color: "#6b7280", fontSize: 12 }}>
                required={active.required_level} · importance={active.importance}
                {typeof active.mastery === "number" ? ` · mastery=${active.mastery}` : ""}
            </div>
            <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
              下一步：点击上方“从AI生成”，根据【{active.name}】自动补全子树
            </div>
            </div>
        );
        })()}

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
          <div style={{ color: "#6b7280" }}>点击导图节点查看详情</div>
        )}
      </div>
    </div>
  );
}
