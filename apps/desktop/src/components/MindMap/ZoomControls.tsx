import { ZoomIn, ZoomOut, Maximize, RotateCcw } from "lucide-react";

interface Props {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onResetZoom: () => void;
}

export default function ZoomControls({ scale, onZoomIn, onZoomOut, onFitView, onResetZoom }: Props) {
  const pct = Math.round(scale * 100);

  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-bg-secondary/90 backdrop-blur-sm border border-border rounded-lg px-1.5 py-1 shadow-sm">
      <button
        onClick={onZoomOut}
        className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors cursor-pointer"
        title="缩小 (Ctrl+-)"
      >
        <ZoomOut size={15} />
      </button>
      <button
        onClick={onResetZoom}
        className="flex items-center justify-center min-w-[42px] h-7 px-1 rounded-md text-[12px] font-medium text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors cursor-pointer"
        title="重置缩放 (Ctrl+0)"
      >
        {pct}%
      </button>
      <button
        onClick={onZoomIn}
        className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors cursor-pointer"
        title="放大 (Ctrl+=)"
      >
        <ZoomIn size={15} />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button
        onClick={onFitView}
        className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors cursor-pointer"
        title="适应画布 (Ctrl+1)"
      >
        <Maximize size={14} />
      </button>
    </div>
  );
}
