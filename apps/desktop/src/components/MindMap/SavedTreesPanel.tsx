export interface SavedTree {
  id: number;
  name: string;
  created_at: string;
}

export interface SavedTreesPanelProps {
  savedTrees: SavedTree[];
  onClose: () => void;
  onSaveTree: () => void;
  onLoadTree: (tree: SavedTree) => void;
  onDeleteTree: (tree: SavedTree) => void;
}

import React from "react";
import { X, Download, Trash2 } from "lucide-react";
import Card from "../ui/Card";
import Button from "../ui/Button";

export default React.memo(function SavedTreesPanel({
  savedTrees,
  onClose,
  onSaveTree,
  onLoadTree,
  onDeleteTree,
}: SavedTreesPanelProps) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[14px] font-semibold">我的行业树</span>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-text-tertiary hover:text-text hover:bg-bg-tertiary transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>
      <Button size="sm" onClick={onSaveTree} className="mb-3">
        保存当前行业树
      </Button>
      {savedTrees.length === 0 ? (
        <div className="text-[13px] text-text-tertiary py-4 text-center">暂无保存的行业树</div>
      ) : (
        <div className="space-y-2">
          {savedTrees.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between py-2 px-3 rounded-md bg-bg-tertiary"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-text truncate">{t.name}</div>
                <div className="text-[11px] text-text-tertiary">
                  {new Date(t.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-1 shrink-0 ml-2">
                <Button variant="ghost" size="sm" onClick={() => onLoadTree(t)}>
                  <Download size={12} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDeleteTree(t)}>
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
});
