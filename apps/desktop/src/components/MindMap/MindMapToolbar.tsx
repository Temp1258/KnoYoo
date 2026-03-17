import React from "react";
import {
  XCircle,
  Sparkles,
  Save,
  Crosshair,
  Trash2,
  Download,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { IndustryNode } from "../../types";
import Input from "../ui/Input";
import Button from "../ui/Button";

export interface MindMapToolbarProps {
  roots: IndustryNode[];
  tree: IndustryNode[];
  skillInput: string;
  onSkillInputChange: (value: string) => void;
  onRootClick: (root: IndustryNode) => void;
  onRootDelete: (root: IndustryNode) => void;
  onClearAll: () => void;
  onCenterCanvas: () => void;
  onAddCustomRoot: () => void;
  onAiExpand: () => void;
  onToggleSavedPanel: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onExportPng?: () => void;
}

export default React.memo(function MindMapToolbar({
  roots,
  tree,
  skillInput,
  onSkillInputChange,
  onRootClick,
  onRootDelete,
  onClearAll,
  onCenterCanvas,
  onAddCustomRoot,
  onAiExpand,
  onToggleSavedPanel,
  onZoomIn,
  onZoomOut,
  onExportPng,
}: MindMapToolbarProps) {
  return (
    <div className="space-y-3">
      {/* Root nodes */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-text-secondary shrink-0">根节点：</span>
        {roots.length === 0 ? (
          <span className="text-[12px] text-text-tertiary">暂无，请输入添加</span>
        ) : (
          <>
            {roots.map((r) => (
              <span
                key={r.id}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium cursor-pointer transition-colors ${
                  tree[0]?.id === r.id
                    ? "bg-accent text-white"
                    : "bg-bg-tertiary text-text hover:bg-border"
                }`}
              >
                <a onClick={() => onRootClick(r)} className="cursor-pointer" title={r.name}>
                  {r.name}
                </a>
                <button
                  onClick={() => onRootDelete(r)}
                  className="cursor-pointer hover:text-danger transition-colors"
                  title="删除"
                >
                  <XCircle size={12} />
                </button>
              </span>
            ))}
            <Button variant="ghost" size="sm" onClick={onClearAll}>
              <Trash2 size={12} /> 清空
            </Button>
            <Button variant="ghost" size="sm" onClick={onCenterCanvas}>
              <Crosshair size={12} /> 居中
            </Button>
            {onZoomIn && (
              <Button variant="ghost" size="sm" onClick={onZoomIn}>
                <ZoomIn size={12} />
              </Button>
            )}
            {onZoomOut && (
              <Button variant="ghost" size="sm" onClick={onZoomOut}>
                <ZoomOut size={12} />
              </Button>
            )}
            {onExportPng && (
              <Button variant="ghost" size="sm" onClick={onExportPng}>
                <Download size={12} /> PNG
              </Button>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-bold tracking-tight m-0">知识树</h2>
        <div className="flex items-center gap-2">
          <Input
            placeholder="输入行业/能力名称..."
            value={skillInput}
            onChange={(e) => onSkillInputChange(e.target.value)}
            className="w-64"
            onKeyDown={(e) => {
              if (e.key === "Enter") onAddCustomRoot();
            }}
          />
          <Button onClick={onAddCustomRoot}>添加根节点</Button>
          <Button variant="primary" onClick={onAiExpand}>
            <Sparkles size={14} /> AI 生成
          </Button>
          <Button onClick={onToggleSavedPanel}>
            <Save size={14} /> 已保存
          </Button>
        </div>
      </div>
    </div>
  );
});
