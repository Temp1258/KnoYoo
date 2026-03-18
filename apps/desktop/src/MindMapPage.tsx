import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
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
import type { IndustryNode, Point, SkillNote, SkillProgress } from "./types";
import { BASE_NODE_W, MAX_NODE_W, NODE_H, ROW_GAP, PAD_LEFT, COL_GAP_DYNAMIC } from "./constants";
import MindMapCanvas from "./components/MindMap/MindMapCanvas";
import NodePreviewTooltip from "./components/MindMap/NodePreviewTooltip";
import SavedTreesPanel from "./components/MindMap/SavedTreesPanel";
import type { SavedTree } from "./components/MindMap/SavedTreesPanel";
import MindMapToolbar from "./components/MindMap/MindMapToolbar";
import ZoomControls from "./components/MindMap/ZoomControls";
import Card from "./components/ui/Card";
import Button from "./components/ui/Button";

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;

export default function MindMapPage() {
  const { showToast, showConfirm, showPrompt } = useToast();
  const [tree, setTree] = useState<IndustryNode[]>([]);
  const [active, setActive] = useState<IndustryNode | null>(null);
  const [skillInput, setSkillInput] = useState("");
  const [pan, setPan] = useState({ x: 0.3, y: 0.3 });
  const [scale, setScale] = useState(1);
  const [drag, setDrag] = useState<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [roots, setRoots] = useState<IndustryNode[]>([]);
  const [savedTrees, setSavedTrees] = useState<SavedTree[]>([]);
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const [hoverNode, setHoverNode] = useState<{
    node: IndustryNode;
    x: number;
    y: number;
  } | null>(null);
  const [progressMap, setProgressMap] = useState<Map<number, number>>(new Map());
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });

  const width = canvasSize.width;
  const height = canvasSize.height;

  // Responsive canvas sizing
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          setCanvasSize({ width: Math.round(w), height: Math.round(h) });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load skill progress for node coloring
  useEffect(() => {
    tauriInvoke<SkillProgress[]>("list_skill_progress")
      .then((list) => {
        const m = new Map<number, number>();
        for (const sp of list || []) {
          m.set(sp.skill_id, sp.progress);
        }
        setProgressMap(m);
      })
      .catch(console.error);
  }, [tree]);

  const refreshRoots = async () => {
    try {
      const r = await tauriInvoke<IndustryNode[]>("list_root_nodes_v1");
      setRoots(r || []);
    } catch (e) {
      console.error(e);
    }
  };

  // Load roots on mount
  useEffect(() => {
    let cancelled = false;
    tauriInvoke<IndustryNode[]>("list_root_nodes_v1")
      .then((r) => {
        if (!cancelled) setRoots(r || []);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    setDrag({
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    });
  };
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drag) return;
    setPan({
      x: drag.origX + e.clientX - drag.startX,
      y: drag.origY + e.clientY - drag.startY,
    });
  };
  const onMouseUp = () => setDrag(null);

  // Zoom toward cursor position
  const onCanvasWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;

    setScale((prevScale) => {
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prevScale * factor));
      const ratio = newScale / prevScale;
      setPan((prevPan) => ({
        x: mx - (mx - prevPan.x) * ratio,
        y: my - (my - prevPan.y) * ratio,
      }));
      return newScale;
    });
  }, []);

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
  }, [layers, widthMap, height]);

  // Get bounding box of all nodes
  const getTreeBounds = useCallback(() => {
    const ids: number[] = [];
    const gather = (n: IndustryNode) => {
      ids.push(n.id);
      (n.children || []).forEach(gather);
    };
    tree.forEach(gather);
    if (ids.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const p = layout.get(id);
      if (!p) continue;
      const w = widthMap.get(id) ?? BASE_NODE_W;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + w);
      maxY = Math.max(maxY, p.y + NODE_H);
    }
    return { minX, minY, maxX, maxY };
  }, [tree, layout, widthMap]);

  function centerOnNodeIds(ids: number[]) {
    const pts = ids.map((id) => layout.get(id)).filter(Boolean) as Point[];
    if (pts.length === 0) return;
    const minX = Math.min(...ids.map((id) => layout.get(id)?.x ?? 0));
    const maxX = Math.max(
      ...ids.map((id) => {
        const p = layout.get(id);
        const w = widthMap.get(id) ?? BASE_NODE_W;
        return p ? p.x + w : 0;
      }),
    );
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const cxWorld = (minX + maxX) / 2;
    const cyWorld = (minY + maxY) / 2 + NODE_H / 2;
    setPan({
      x: width / 2 - cxWorld * scale,
      y: height / 2 - cyWorld * scale,
    });
  }

  // Fit entire tree into view with padding
  const fitView = useCallback(() => {
    const bounds = getTreeBounds();
    if (!bounds) return;
    const padding = 60;
    const treeW = bounds.maxX - bounds.minX + padding * 2;
    const treeH = bounds.maxY - bounds.minY + padding * 2;
    const scaleX = width / treeW;
    const scaleY = height / treeH;
    const newScale = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_SCALE), MAX_SCALE);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    setScale(newScale);
    setPan({
      x: width / 2 - cx * newScale,
      y: height / 2 - cy * newScale,
    });
  }, [getTreeBounds, width, height]);

  const resetZoom = useCallback(() => {
    setScale(1);
    // Re-center at scale 1
    const bounds = getTreeBounds();
    if (!bounds) return;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    setPan({
      x: width / 2 - cx,
      y: height / 2 - cy,
    });
  }, [getTreeBounds, width, height]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setScale((s) => Math.min(MAX_SCALE, s * 1.2));
      } else if (e.key === "-") {
        e.preventDefault();
        setScale((s) => Math.max(MIN_SCALE, s / 1.2));
      } else if (e.key === "0") {
        e.preventDefault();
        resetZoom();
      } else if (e.key === "1") {
        e.preventDefault();
        fitView();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fitView, resetZoom]);

  const scrollToCanvas = () =>
    canvasRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });

  const onSelect = (node: IndustryNode) => {
    setActive(node);
    const p = layout.get(node.id);
    if (p) {
      const w = widthMap.get(node.id) ?? BASE_NODE_W;
      setPan({
        x: width / 2 - (p.x + w / 2) * scale,
        y: height / 2 - (p.y + NODE_H / 2) * scale,
      });
    }
    scrollToCanvas();
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

  const loadAndDisplay = async (id: number, name: string) => {
    const all = await tauriInvoke<IndustryNode[]>("list_industry_tree_v1");
    const latest = findNodeById(all || [], id) || findNodeByName(all || [], name);
    const sub = latest ? extractSubtree(all || [], latest.id) : null;
    if (sub) {
      setTree([sub]);
      setActive(sub);
      requestAnimationFrame(() =>
        centerOnNodeIds([sub.id, ...(sub.children?.map((c) => c.id) || [])]),
      );
      scrollToCanvas();
    }
    return sub;
  };

  const addCustomRoot = async () => {
    const name = skillInput.trim();
    if (!name) return;
    try {
      const id = await tauriInvoke<number>("save_custom_root_v1", { name });
      await refreshRoots();
      const sub = await loadAndDisplay(id, name);
      if (!sub) {
        const root: IndustryNode = {
          id,
          name,
          required_level: 100,
          importance: 1,
          children: [],
        };
        setTree([root]);
        setActive(root);
        requestAnimationFrame(() => centerOnNodeIds([root.id]));
        scrollToCanvas();
      }
      setSkillInput("");
    } catch (e: any) {
      console.error(e);
      showToast(`保存根节点失败：${e?.message ?? String(e)}`, "error");
    }
  };

  const refreshSavedTrees = async () => {
    try {
      const list = await tauriInvoke<SavedTree[]>("list_saved_industry_trees_v1");
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
    const name = await showPrompt("请输入行业树的名称：");
    if (!name || !name.trim()) return;
    try {
      await tauriInvoke<number>("save_industry_tree_v1", {
        name: name.trim(),
      });
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
      requestAnimationFrame(() =>
        centerOnNodeIds([latestSub.id, ...(latestSub.children?.map((c) => c.id) || [])]),
      );
      setSkillInput("");
      scrollToCanvas();
    } catch (e: any) {
      console.error(e);
      showToast(`AI 生成失败：${e?.message ?? String(e)}`, "error");
    }
  };

  const handleRootClick = async (r: IndustryNode) => {
    try {
      await loadAndDisplay(r.id, r.name);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRootDelete = async (r: IndustryNode) => {
    const ok = await showConfirm(`删除根节点"${r.name}"（含其全部子项）？`);
    if (!ok) return;
    try {
      await tauriInvoke("delete_root_and_subtree_v1", { rootId: r.id });
      await refreshRoots();
      if (tree[0]?.id === r.id) {
        setTree([]);
        setActive(null);
      }
    } catch (e: any) {
      showToast(`删除失败：${e?.message ?? String(e)}`, "error");
    }
  };

  const handleExportTemplate = async () => {
    try {
      const json = await tauriInvoke<string>("export_skill_template");
      // Create a download
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "knoyoo-template.json";
      a.click();
      URL.revokeObjectURL(url);
      showToast("模板已导出");
    } catch (e: any) {
      showToast(`导出失败：${e?.message ?? String(e)}`, "error");
    }
  };

  const handleImportTemplate = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        await tauriInvoke("import_skill_template", { jsonStr: text });
        await refreshRoots();
        const allTrees = await tauriInvoke<IndustryNode[]>("list_industry_tree_v1");
        if (allTrees?.length) {
          setTree(allTrees);
          setActive(allTrees[0]);
        }
        showToast("模板导入成功");
      } catch (e: any) {
        showToast(`导入失败：${e?.message ?? String(e)}`, "error");
      }
    };
    input.click();
  };

  const handleClearAll = async () => {
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
  };

  const handleCenterCanvas = () => {
    const ids: number[] = [];
    const gather = (n: IndustryNode) => {
      ids.push(n.id);
      (n.children || []).forEach(gather);
    };
    tree.forEach(gather);
    if (ids.length > 0) centerOnNodeIds(ids);
  };

  const handleToggleSavedPanel = () => {
    const next = !showSavedPanel;
    if (next) refreshSavedTrees();
    setShowSavedPanel(next);
  };

  const handleLoadTree = async (t: SavedTree) => {
    try {
      const loaded = await tauriInvoke<IndustryNode[]>("get_saved_industry_tree_v1", { id: t.id });
      setTree(loaded || []);
      setActive(null);
      requestAnimationFrame(() => {
        const ids: number[] = [];
        const gather = (n: IndustryNode) => {
          ids.push(n.id);
          (n.children || []).forEach(gather);
        };
        (loaded || []).forEach(gather);
        if (ids.length > 0) centerOnNodeIds(ids);
      });
      setShowSavedPanel(false);
    } catch (e: any) {
      showToast(`加载失败：${e?.message ?? String(e)}`, "error");
    }
  };

  const handleDeleteTree = async (t: SavedTree) => {
    const ok = await showConfirm(`确认删除行业树"${t.name}"吗？`);
    if (!ok) return;
    try {
      await tauriInvoke("delete_saved_industry_tree_v1", { id: t.id });
      refreshSavedTrees();
    } catch (e: any) {
      showToast(`删除失败：${e?.message ?? String(e)}`, "error");
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      <MindMapToolbar
        roots={roots}
        tree={tree}
        skillInput={skillInput}
        onSkillInputChange={setSkillInput}
        onRootClick={handleRootClick}
        onRootDelete={handleRootDelete}
        onClearAll={handleClearAll}
        onCenterCanvas={handleCenterCanvas}
        onAddCustomRoot={addCustomRoot}
        onAiExpand={aiExpand}
        onToggleSavedPanel={handleToggleSavedPanel}
        onExportTemplate={handleExportTemplate}
        onImportTemplate={handleImportTemplate}
        onExportPng={() => {
          const svg = canvasRef.current?.querySelector("svg");
          if (!svg) return;
          const clone = svg.cloneNode(true) as SVGSVGElement;
          const data = new XMLSerializer().serializeToString(clone);
          const blob = new Blob([data], { type: "image/svg+xml;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "mindmap.svg";
          a.click();
          URL.revokeObjectURL(url);
          showToast("已导出 SVG");
        }}
      />

      {showSavedPanel && (
        <SavedTreesPanel
          savedTrees={savedTrees}
          onClose={() => setShowSavedPanel(false)}
          onSaveTree={onSaveTree}
          onLoadTree={handleLoadTree}
          onDeleteTree={handleDeleteTree}
        />
      )}

      <div className="relative flex-1 min-h-[400px]">
        <MindMapCanvas
          canvasRef={canvasRef}
          width={width}
          height={height}
          pan={pan}
          scale={scale}
          drag={drag}
          edges={edges}
          layers={layers}
          layout={layout}
          widthMap={widthMap}
          active={active}
          progressMap={progressMap}
          onCanvasWheel={onCanvasWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onSelect={onSelect}
          onNodeHover={(node, e) => {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            setHoverNode({
              node,
              x: e.clientX - rect.left + 12,
              y: e.clientY - rect.top + 12,
            });
          }}
          onNodeLeave={() => setHoverNode(null)}
        />
        {hoverNode && (
          <NodePreviewTooltip
            nodeId={hoverNode.node.id}
            nodeName={hoverNode.node.name}
            x={hoverNode.x}
            y={hoverNode.y}
          />
        )}
        <ZoomControls
          scale={scale}
          onZoomIn={() => setScale((s) => Math.min(MAX_SCALE, s * 1.2))}
          onZoomOut={() => setScale((s) => Math.max(MIN_SCALE, s / 1.2))}
          onFitView={fitView}
          onResetZoom={resetZoom}
        />
      </div>

      {/* Detail panel */}
      {active && (
        <Card padding="sm">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold text-text">{active.name}</span>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  const notes = await tauriInvoke<SkillNote[]>("list_skill_notes_v1", {
                    skill_id: active.id,
                    limit: 50,
                  });
                  showToast(`该节点关联笔记：${Array.isArray(notes) ? notes.length : 0} 条`);
                } catch (_e) {
                  showToast("加载节点关联笔记失败", "error");
                }
              }}
            >
              查看关联笔记
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
