import { useState, useEffect, useCallback } from "react";
import { Trash2, RotateCcw, AlertTriangle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { WebClip } from "../types";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import { SkeletonCard } from "../components/ui/Skeleton";
import { useToast } from "../components/common/Toast";

function formatDeletedDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

export default function TrashPage() {
  const [clips, setClips] = useState<WebClip[]>([]);
  const [trashCount, setTrashCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptyingTrash, setEmptyingTrash] = useState(false);
  const [actioningIds, setActioningIds] = useState<Set<number>>(new Set());
  const { showToast } = useToast();

  const loadTrash = useCallback(async () => {
    setLoading(true);
    try {
      const [items, count] = await Promise.all([
        invoke<WebClip[]>("list_trash", { page: 1, pageSize: 50 }),
        invoke<number>("count_trash"),
      ]);
      setClips(items);
      setTrashCount(count);
    } catch (e) {
      console.error("Failed to load trash:", e);
      showToast("加载回收站失败", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const handleRestore = async (id: number) => {
    setActioningIds((prev) => new Set(prev).add(id));
    try {
      await invoke<WebClip>("restore_clip", { id });
      setClips((prev) => prev.filter((c) => c.id !== id));
      setTrashCount((prev) => prev - 1);
      showToast("已恢复", "success");
    } catch (e) {
      console.error("Restore failed:", e);
      showToast("恢复失败", "error");
    } finally {
      setActioningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handlePurge = async (id: number) => {
    setActioningIds((prev) => new Set(prev).add(id));
    try {
      await invoke("purge_clip", { id });
      setClips((prev) => prev.filter((c) => c.id !== id));
      setTrashCount((prev) => prev - 1);
      showToast("已永久删除", "info");
    } catch (e) {
      console.error("Purge failed:", e);
      showToast("删除失败", "error");
    } finally {
      setActioningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleEmptyTrash = async () => {
    setConfirmEmpty(false);
    setEmptyingTrash(true);
    try {
      const count = await invoke<number>("empty_trash");
      setClips([]);
      setTrashCount(0);
      showToast(`已清空 ${count} 条内容`, "success");
    } catch (e) {
      console.error("Empty trash failed:", e);
      showToast("清空失败", "error");
    } finally {
      setEmptyingTrash(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-bold tracking-tight m-0">回收站</h1>
          <span className="text-[13px] text-text-tertiary">{trashCount} 条内容</span>
        </div>
        {clips.length > 0 && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmEmpty(true)}
            disabled={emptyingTrash}
          >
            <Trash2 size={13} />
            清空回收站
          </Button>
        )}
      </div>

      {/* Auto-purge notice */}
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl mb-4 bg-yellow-500/5 border border-yellow-500/15">
        <AlertTriangle size={14} className="text-yellow-600 shrink-0" />
        <span className="text-[12px] text-yellow-700">回收站中的内容将在 30 天后自动清除</span>
      </div>

      {/* Skeleton loading */}
      {loading && clips.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && clips.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
          <Trash2 size={48} strokeWidth={1} className="mb-4 opacity-30" />
          <p className="text-[15px] font-medium mb-1">回收站是空的</p>
          <p className="text-[12px]">删除的内容会出现在这里</p>
        </div>
      )}

      {/* Clip grid */}
      {clips.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-fade-in">
          {clips.map((clip) => {
            const domain = getDomain(clip.url);
            const isActioning = actioningIds.has(clip.id);

            return (
              <div
                key={clip.id}
                className={`group relative rounded-xl border border-l-[3px] border-border border-l-red-400/60 bg-bg-secondary p-4 transition-all duration-200 ${
                  isActioning
                    ? "opacity-50 pointer-events-none"
                    : "hover:border-accent/30 hover:shadow-md"
                }`}
              >
                {/* Title */}
                <h3 className="text-[15px] font-semibold text-text leading-snug line-clamp-2 m-0 mb-1">
                  {clip.title || "无标题"}
                </h3>

                {/* Meta: domain + deletion date */}
                <div className="text-[11px] text-text-tertiary mb-2">
                  {domain} &middot; 删除于 {formatDeletedDate(clip.deleted_at)}
                </div>

                {/* Summary */}
                {clip.summary && (
                  <p className="text-[12px] text-text-secondary leading-relaxed line-clamp-2 mb-3 m-0">
                    {clip.summary}
                  </p>
                )}

                {/* Tags */}
                {clip.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {clip.tags.slice(0, 4).map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                    {clip.tags.length > 4 && <Badge>+{clip.tags.length - 4}</Badge>}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRestore(clip.id)}
                    disabled={isActioning}
                    title="恢复"
                  >
                    <RotateCcw size={13} />
                    恢复
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handlePurge(clip.id)}
                    disabled={isActioning}
                    title="永久删除"
                  >
                    <Trash2 size={13} />
                    永久删除
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm empty trash dialog */}
      {confirmEmpty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-bg-secondary rounded-xl shadow-lg border border-border w-full max-w-sm mx-4 p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={18} className="text-danger shrink-0" />
              <h3 className="text-[15px] font-semibold text-text m-0">清空回收站</h3>
            </div>
            <p className="text-[13px] text-text-secondary m-0 mb-4">
              确定要永久删除回收站中的 {trashCount} 条内容吗？此操作无法撤销。
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirmEmpty(false)}>取消</Button>
              <Button variant="danger" onClick={handleEmptyTrash}>
                <Trash2 size={13} />
                确认清空
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
