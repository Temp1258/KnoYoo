import React from "react";
import type { IndustryNode, Point } from "../../types";
import { BASE_NODE_W, NODE_H } from "../../constants";

export interface MindMapCanvasProps {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  height: number;
  pan: { x: number; y: number };
  scale: number;
  drag: {
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null;
  edges: Array<{ from: Point; to: Point }>;
  layers: IndustryNode[][];
  layout: Map<number, Point>;
  widthMap: Map<number, number>;
  active: IndustryNode | null;
  onCanvasWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseUp: () => void;
  onSelect: (node: IndustryNode) => void;
  onNodeHover?: (node: IndustryNode, e: React.MouseEvent) => void;
  onNodeLeave?: () => void;
}

export default React.memo(function MindMapCanvas({
  canvasRef,
  width,
  height,
  pan,
  scale,
  drag,
  edges,
  layers,
  layout,
  widthMap,
  active,
  onCanvasWheel,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onSelect,
  onNodeHover,
  onNodeLeave,
}: MindMapCanvasProps) {
  return (
    <div
      ref={canvasRef}
      onWheel={onCanvasWheel}
      onWheelCapture={onCanvasWheel}
      className="mindmap-canvas rounded-lg border border-border overflow-hidden"
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        className="bg-bg-secondary"
        style={{ cursor: drag ? "grabbing" : "grab" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
          {/* Edges */}
          <g>
            {edges.map((e, idx) => {
              const c1x = e.from.x + 40;
              const c2x = e.to.x - 40;
              const d = `M ${e.from.x} ${e.from.y} C ${c1x} ${e.from.y}, ${c2x} ${e.to.y}, ${e.to.x} ${e.to.y}`;
              return (
                <path key={idx} d={d} stroke="var(--color-border)" strokeWidth={1.5} fill="none" />
              );
            })}
          </g>
          {/* Nodes */}
          <g>
            {layers.flat().map((n) => {
              const p = layout.get(n.id)!;
              const selected = active?.id === n.id;
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x}, ${p.y})`}
                  onClick={() => onSelect(n)}
                  onMouseEnter={(e) => onNodeHover?.(n, e)}
                  onMouseLeave={() => onNodeLeave?.()}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    width={widthMap.get(n.id) ?? BASE_NODE_W}
                    height={NODE_H}
                    rx={6}
                    ry={6}
                    fill={selected ? "var(--color-accent)" : "var(--color-bg-secondary)"}
                    stroke={selected ? "var(--color-accent-hover)" : "var(--color-border)"}
                    strokeWidth={selected ? 2 : 1}
                  />
                  <text
                    x={8}
                    y={22}
                    fontSize={13}
                    fill={selected ? "#ffffff" : "var(--color-text)"}
                  >
                    {n.name}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
});
