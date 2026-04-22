import { useState, useEffect, useCallback } from "react";
import { Trash2, RotateCcw, AlertTriangle, Headphones, Video } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { MediaItem } from "../../types";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import { SkeletonCard } from "../ui/Skeleton";
import { useToast } from "../common/toast-context";

/**
 * Trash panel for `media_items` rows. Mirrors `ClipsTrashPanel` in shape
 * (list → restore / purge / empty) but targets media commands and renders
 * a media_type badge (audio vs local_video) instead of a URL domain.
 */

function formatDeletedDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  onCountChange?: (count: number) => void;
}

export default function MediaTrashPanel({ onCountChange }: Props) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [trashCount, setTrashCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptyingTrash, setEmptyingTrash] = useState(false);
  const [actioningIds, setActioningIds] = useState<Set<number>>(new Set());
  const { showToast } = useToast();

  const loadTrash = useCallback(async () => {
    setLoading(true);
    try {
      const [list, count] = await Promise.all([
        invoke<MediaItem[]>("list_media_trash", { limit: 50 }),
        invoke<number>("count_media_trash"),
      ]);
      setItems(list);
      setTrashCount(count);
    } catch (e) {
      console.error("Failed to load media trash:", e);
      showToast("加载影音乐色失败", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  useEffect(() => {
    if (!loading) onCountChange?.(trashCount);
  }, [trashCount, loading, onCountChange]);

  const handleRestore = async (id: number) => {
    setActioningIds((prev) => new Set(prev).add(id));
    try {
      await invoke("restore_media_item", { id });
      setItems((prev) => prev.filter((m) => m.id !== id));
      setTrashCount((prev) => prev - 1);
      showToast("已恢复", "success");
    } catch (e) {
      console.error("Restore failed:", e);
      showToast(`恢复失败：${e}`, "error");
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
      await invoke("purge_media_item", { id });
      setItems((prev) => prev.filter((m) => m.id !== id));
      setTrashCount((prev) => prev - 1);
      showToast("已永久删除", "info");
    } catch (e) {
      console.error("Purge failed:", e);
      showToast(`删除失败：${e}`, "error");
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
      const count = await invoke<number>("empty_media_trash");
      setItems([]);
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
      {items.length > 0 && (
        <div className="flex justify-end mb-4">
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmEmpty(true)}
            disabled={emptyingTrash}
          >
            <Trash2 size={13} />
            清空影音乐色
          </Button>
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
          <Trash2 size={48} strokeWidth={1} className="mb-4 opacity-30" />
          <p className="text-[15px] font-medium mb-1">没有已删除的影音</p>
          <p className="text-[12px]">删除的影音会出现在这里</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-fade-in">
          {items.map((m) => {
            const isActioning = actioningIds.has(m.id);
            const icon = m.media_type === "audio" ? <Headphones size={12} /> : <Video size={12} />;
            const typeLabel = m.media_type === "audio" ? "音频" : "本地视频";

            return (
              <div
                key={m.id}
                className={`group relative rounded-xl border border-l-[3px] border-border border-l-red-400/60 bg-bg-secondary p-4 transition-all duration-200 ${
                  isActioning
                    ? "opacity-50 pointer-events-none"
                    : "hover:border-accent/30 hover:shadow-md"
                }`}
              >
                <h3 className="text-[15px] font-semibold text-text leading-snug line-clamp-2 m-0 mb-1">
                  {m.title || "无标题"}
                </h3>

                <div className="text-[11px] text-text-tertiary mb-2 flex items-center gap-1.5">
                  <span className="flex items-center gap-1">
                    {icon}
                    {typeLabel}
                  </span>
                  <span>&middot; 删除于 {formatDeletedDate(m.deleted_at)}</span>
                </div>

                {m.summary && (
                  <p className="text-[12px] text-text-secondary leading-relaxed line-clamp-2 mb-3 m-0">
                    {m.summary}
                  </p>
                )}

                {m.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {m.tags.slice(0, 4).map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                    {m.tags.length > 4 && <Badge>+{m.tags.length - 4}</Badge>}
                  </div>
                )}

                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRestore(m.id)}
                    disabled={isActioning}
                    title="恢复"
                  >
                    <RotateCcw size={13} />
                    恢复
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handlePurge(m.id)}
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

      {confirmEmpty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-bg-secondary rounded-xl shadow-lg border border-border w-full max-w-sm mx-4 p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={18} className="text-danger shrink-0" />
              <h3 className="text-[15px] font-semibold text-text m-0">清空影音乐色</h3>
            </div>
            <p className="text-[13px] text-text-secondary m-0 mb-4">
              确定要永久删除 {trashCount} 条影音吗？此操作无法撤销。
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
