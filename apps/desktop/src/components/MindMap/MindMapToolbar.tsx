import React from "react";
import {
  XCircle,
  Sparkles,
  Save,
  Crosshair,
  Trash2,
  Download,
  Upload,
  Share2,
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
  onExportPng?: () => void;
  onExportTemplate?: () => void;
  onImportTemplate?: () => void;
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
  onExportPng,
  onExportTemplate,
  onImportTemplate,
}: MindMapToolbarProps) {
  return (
    <div className="space-y-2">
      {/* Row 1: Root node tags + quick actions */}
      <div className="flex items-center gap-2 min-h-[32px] overflow-x-auto">
        <span className="text-[12px] text-text-secondary shrink-0">根节点：</span>
        {roots.length === 0 ? (
          <span className="text-[12px] text-text-tertiary">暂无，请输入添加</span>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {roots.map((r) => (
              <span
                key={r.id}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium cursor-pointer transition-colors whitespace-nowrap ${
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
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Compact icon-only actions for toolbar row 1 */}
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClearAll} title="清空全部">
            <Trash2 size={13} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onCenterCanvas} title="居中画布">
            <Crosshair size={13} />
          </Button>
          {onExportPng && (
            <Button variant="ghost" size="sm" onClick={onExportPng} title="导出 PNG">
              <Download size={13} />
            </Button>
          )}
          {onExportTemplate && (
            <Button variant="ghost" size="sm" onClick={onExportTemplate} title="导出模板">
              <Share2 size={13} />
            </Button>
          )}
          {onImportTemplate && (
            <Button variant="ghost" size="sm" onClick={onImportTemplate} title="导入模板">
              <Upload size={13} />
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: Title + Input + main actions */}
      <div className="flex items-center gap-3">
        <h2 className="text-[20px] font-bold tracking-tight m-0 shrink-0">知识树</h2>
        <div className="flex-1" />
        <div className="flex items-center gap-2 shrink-0">
          <Input
            placeholder="输入行业/能力名称..."
            value={skillInput}
            onChange={(e) => onSkillInputChange(e.target.value)}
            className="w-48"
            onKeyDown={(e) => {
              if (e.key === "Enter") onAddCustomRoot();
            }}
          />
          <Button onClick={onAddCustomRoot}>添加</Button>
          <Button variant="primary" onClick={onAiExpand}>
            <Sparkles size={14} /> AI生成
          </Button>
          <Button onClick={onToggleSavedPanel}>
            <Save size={14} /> 已保存
          </Button>
        </div>
      </div>
    </div>
  );
});
