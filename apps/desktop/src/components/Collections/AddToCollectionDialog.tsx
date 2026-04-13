import { useState, useEffect } from "react";
import { Check, Plus } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { Collection } from "../../types";
import Dialog from "../ui/Dialog";
import Button from "../ui/Button";
import Input from "../ui/Input";

type Props = {
  open: boolean;
  clipId: number;
  onClose: () => void;
};

export default function AddToCollectionDialog({ open, clipId, onClose }: Props) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!open) return;
    Promise.all([
      tauriInvoke<Collection[]>("list_collections"),
      tauriInvoke<Collection[]>("list_clip_collections", { clipId }),
    ]).then(([all, current]) => {
      setCollections(all);
      setMemberIds(new Set(current.map((c) => c.id)));
    });
  }, [open, clipId]);

  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());

  const toggle = async (collectionId: number) => {
    if (pendingIds.has(collectionId)) return;
    setPendingIds((prev) => new Set(prev).add(collectionId));
    try {
      if (memberIds.has(collectionId)) {
        await tauriInvoke("remove_clip_from_collection", { collectionId, clipId });
        setMemberIds((prev) => {
          const next = new Set(prev);
          next.delete(collectionId);
          return next;
        });
      } else {
        await tauriInvoke("add_clip_to_collection", { collectionId, clipId });
        setMemberIds((prev) => new Set(prev).add(collectionId));
      }
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(collectionId);
        return next;
      });
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const col = await tauriInvoke<Collection>("create_collection", { name: newName.trim() });
    await tauriInvoke("add_clip_to_collection", { collectionId: col.id, clipId });
    setCollections((prev) => [col, ...prev]);
    setMemberIds((prev) => new Set(prev).add(col.id));
    setNewName("");
    setCreating(false);
  };

  return (
    <Dialog open={open} onClose={onClose} title="添加到集合">
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {collections.map((col) => (
          <button
            key={col.id}
            onClick={() => toggle(col.id)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors cursor-pointer text-left"
          >
            <div
              className="w-5 h-5 rounded flex items-center justify-center text-white text-[10px] font-bold shrink-0"
              style={{ backgroundColor: col.color }}
            >
              {col.name[0]?.toUpperCase()}
            </div>
            <span className="text-[13px] text-text flex-1">{col.name}</span>
            {memberIds.has(col.id) && <Check size={14} className="text-accent shrink-0" />}
          </button>
        ))}
      </div>

      <div className="border-t border-border mt-2 pt-2">
        {creating ? (
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="集合名称..."
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <Button size="sm" variant="primary" onClick={handleCreate}>
              创建
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-accent hover:bg-accent/5 rounded-lg transition-colors cursor-pointer"
          >
            <Plus size={14} />
            新建集合
          </button>
        )}
      </div>
    </Dialog>
  );
}
