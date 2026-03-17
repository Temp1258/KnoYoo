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
  progressMap?: Map<number, number>; // skill_id -> progress (0~1)
  onCanvasWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseUp: () => void;
  onSelect: (node: IndustryNode) => void;
  onNodeHover?: (node: IndustryNode, e: React.MouseEvent) => void;
  onNodeLeave?: () => void;
}

/** Get node fill color based on progress: gray (0) -> yellow (partial) -> green (done) */
function getProgressColor(progress: number | undefined): string | null {
  if (progress === undefined || progress <= 0) return null; // use default
  if (progress >= 0.8) return "var(--color-success)"; // green
  if (progress >= 0.3) return "#f59e0b"; // amber/yellow
  return "#fbbf24"; // light yellow
}

function getProgressTextColor(progress: number | undefined): string | null {
  if (progress === undefined || progress <= 0) return null;
  if (progress >= 0.3) return "#ffffff";
  return "var(--color-text)";
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
  progressMap,
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
              const prog = progressMap?.get(n.id);
              const progFill = getProgressColor(prog);
              const progText = getProgressTextColor(prog);
              const nodeW = widthMap.get(n.id) ?? BASE_NODE_W;

              let fill: string;
              let textFill: string;
              let stroke: string;
              let strokeW: number;

              if (selected) {
                fill = "var(--color-accent)";
                textFill = "#ffffff";
                stroke = "var(--color-accent-hover)";
                strokeW = 2;
              } else if (progFill) {
                fill = progFill;
                textFill = progText || "var(--color-text)";
                stroke = progFill;
                strokeW = 1.5;
              } else {
                fill = "var(--color-bg-secondary)";
                textFill = "var(--color-text)";
                stroke = "var(--color-border)";
                strokeW = 1;
              }

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
                    width={nodeW}
                    height={NODE_H}
                    rx={6}
                    ry={6}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={strokeW}
                  />
                  {/* Progress bar background */}
                  {prog !== undefined && prog > 0 && !selected && (
                    <rect
                      x={0}
                      y={NODE_H - 3}
                      width={nodeW * Math.min(prog, 1)}
                      height={3}
                      rx={1.5}
                      fill="rgba(255,255,255,0.4)"
                    />
                  )}
                  <text
                    x={8}
                    y={22}
                    fontSize={13}
                    fill={textFill}
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
