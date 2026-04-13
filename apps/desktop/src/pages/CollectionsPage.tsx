import { useState, useEffect, useCallback } from "react";
import { FolderPlus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { Collection } from "../types";
import Button from "../components/ui/Button";
import Dialog from "../components/ui/Dialog";
import Input from "../components/ui/Input";
import Textarea from "../components/ui/Textarea";

export default function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const navigate = useNavigate();

  const COLORS = ["#6b7280", "#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899"];

  const load = useCallback(async () => {
    const list = await tauriInvoke<Collection[]>("list_collections");
    setCollections(list);
  }, []);

  useEffect(() => {
    let stale = false;
    tauriInvoke<Collection[]>("list_collections")
      .then((list) => {
        if (!stale) setCollections(list);
      })
      .catch(console.error);
    return () => {
      stale = true;
    };
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await tauriInvoke("create_collection", {
      name: newName.trim(),
      description: newDesc.trim() || undefined,
      color: newColor,
    });
    setShowCreate(false);
    setNewName("");
    setNewDesc("");
    setNewColor("#6b7280");
    load();
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await tauriInvoke("delete_collection", { id });
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[28px] font-bold tracking-tight">知识集合</h1>
        <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          <FolderPlus size={14} />
          新建集合
        </Button>
      </div>

      {collections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
          <FolderPlus size={48} strokeWidth={1} className="mb-4 opacity-40" />
          <p className="text-[14px] mb-1">还没有集合</p>
          <p className="text-[12px]">创建集合来组织你的收藏内容</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {collections.map((col) => (
            <div
              key={col.id}
              onClick={() => navigate(`/collections/${col.id}`)}
              className="group p-4 rounded-xl bg-bg-secondary border border-border hover:border-accent/30 hover:shadow-md transition-all duration-200 cursor-pointer"
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[14px] font-bold shrink-0"
                  style={{ backgroundColor: col.color }}
                >
                  {col.name[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-semibold text-text line-clamp-1 m-0">
                    {col.name}
                  </h3>
                  {col.description && (
                    <p className="text-[12px] text-text-tertiary line-clamp-2 mt-0.5 m-0">
                      {col.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] text-text-tertiary">{col.clip_count} 条收藏</span>
                <button
                  onClick={(e) => handleDelete(col.id, e)}
                  className="p-1 rounded-md text-text-tertiary hover:text-danger hover:bg-danger-light transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                  title="删除集合"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create collection dialog */}
      <Dialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="新建知识集合"
        actions={
          <>
            <Button onClick={() => setShowCreate(false)}>取消</Button>
            <Button variant="primary" onClick={handleCreate} disabled={!newName.trim()}>
              创建
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-[12px] text-text-secondary mb-1 block">名称</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如：Rust 学习路径"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[12px] text-text-secondary mb-1 block">描述（可选）</label>
            <Textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="简要描述这个集合的用途..."
              rows={2}
            />
          </div>
          <div>
            <label className="text-[12px] text-text-secondary mb-1 block">颜色</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`w-6 h-6 rounded-full cursor-pointer transition-transform ${
                    newColor === c
                      ? "ring-2 ring-accent ring-offset-2 scale-110"
                      : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
