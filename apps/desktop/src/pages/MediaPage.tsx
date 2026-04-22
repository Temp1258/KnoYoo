import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Headphones, Video, Upload, Film } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { MediaItem, WebClip } from "../types";
import ClipCard from "../components/Clips/ClipCard";
import ClipDetail from "../components/Clips/ClipDetail";
import { SkeletonCard } from "../components/ui/Skeleton";
import { useToast } from "../components/common/toast-context";
import { useMediaQuery } from "../hooks/useMediaQuery";

const AUDIO_EXTS = ["mp3", "m4a", "wav", "flac", "opus", "ogg", "aac", "webm"];
const VIDEO_EXTS = ["mp4", "mov", "mkv", "avi", "webm", "m4v", "flv", "wmv"];

function hasExt(path: string, exts: string[]): boolean {
  const lower = path.toLowerCase();
  return exts.some((ext) => lower.endsWith(`.${ext}`));
}

/**
 * macOS 的「照片」App 拖拽出来的一般是 library bundle 里的一张衍生缩略图
 * （`.../Photos Library.photoslibrary/resources/derivatives/.../xxx.jpeg`），
 * 不是原始视频 / 照片文件。即便偶尔命中 .mov，也是内部管理文件，不应直接
 * 读取（Photos 会重打包）。统一截胡，请用户通过「文件 → 导出 → 导出未修改
 * 的原始文件」把真实文件落到桌面再拖进来。
 */
function isFromPhotosLibrary(path: string): boolean {
  return path.toLowerCase().includes(".photoslibrary/");
}

/** Short filename for error toasts — 完整绝对路径太长，用户只需要知道是哪个文件 */
function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * Adapt a `media_items` row to the `WebClip` shape the shared `ClipCard` /
 * `ClipDetail` components render. Keeps rendering logic (which hasn't
 * needed media-specific display affordances so far) untouched.
 *
 * - `url`: synthesized from `file_hash` so the "open in browser" button can
 *   hide cleanly (URL check `isSafeUrl` rejects the `media-local://` scheme).
 * - `source_type`: mirrored from `media_type` so the existing card icon
 *   map renders the right glyph (🎧 for audio, 🎬 for local_video).
 * - `deleted_at`: passed through as null for active rows — the trash page
 *   reads it separately.
 * - `notes`: carried across as an extra (non-WebClip) field; `ClipDetail`
 *   reads it inline when `kind="media"` to avoid a redundant IPC.
 */
function asClipShape(m: MediaItem): WebClip & { notes: string } {
  return {
    id: m.id,
    url: `media-local://${m.file_hash || m.id}`,
    title: m.title,
    content: m.content,
    raw_content: m.raw_content,
    summary: m.summary,
    tags: m.tags,
    source_type: m.media_type,
    favicon: "",
    og_image: "",
    is_read: m.is_read,
    is_starred: m.is_starred,
    created_at: m.created_at,
    updated_at: m.updated_at,
    deleted_at: m.deleted_at,
    transcription_status: m.transcription_status,
    transcription_error: m.transcription_error,
    transcription_source: m.transcription_source,
    audio_duration_sec: m.audio_duration_sec,
    source_language: m.source_language,
    translated_content: m.translated_content,
    notes: m.notes,
  };
}

function MediaDropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-bg/80 backdrop-blur-sm animate-fade-in pointer-events-none"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-4 px-16 py-14 rounded-2xl border-2 border-dashed border-accent bg-bg-secondary/90 shadow-lg">
        <div className="w-16 h-16 rounded-2xl bg-accent-light flex items-center justify-center">
          <Film size={32} className="text-accent" strokeWidth={1.6} />
        </div>
        <div className="text-[16px] font-semibold text-text">松开以导入到影音</div>
        <div className="text-[12px] text-text-tertiary">支持音频 / 本地视频</div>
      </div>
    </div>
  );
}

export default function MediaPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const uploadingRef = useRef(false);
  const { showToast } = useToast();
  const isWide = useMediaQuery("(min-width: 1024px)");

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const list = await tauriInvoke<MediaItem[]>("list_media_items", {
        filter: { limit: 200 },
      });
      setItems(list);
    } catch (e) {
      console.error("load media items failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Deep-link support (from QuickSearch / HomePage). Supports both the
  // legacy `openClip` param (for backward compat during the B.5 rollout)
  // and a new `openMedia` param the future search integration (B.6) will
  // use once it can distinguish kinds.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const idRaw = searchParams.get("openMedia") || searchParams.get("openClip");
    if (!idRaw) return;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) return;
    let stale = false;
    tauriInvoke<MediaItem>("get_media_item", { id })
      .then((item) => {
        if (!stale) setSelected(item);
      })
      .catch(console.error)
      .finally(() => {
        if (!stale) {
          const next = new URLSearchParams(searchParams);
          next.delete("openMedia");
          next.delete("openClip");
          setSearchParams(next, { replace: true });
        }
      });
    return () => {
      stale = true;
    };
  }, [searchParams, setSearchParams]);

  const importFile = useCallback(
    async (filePath: string) => {
      // 拦截「照片」App：无论扩展名是什么都拒绝，避免读 library bundle
      // 内部管理文件，同时给用户可操作的指引。
      if (isFromPhotosLibrary(filePath)) {
        showToast(
          "『照片』App 的文件不能直接拖入。请先选中视频 → 文件 → 导出 → 导出未修改的原始文件，再把导出后的文件拖进来。",
          "error",
        );
        return;
      }
      const isVideo = hasExt(filePath, VIDEO_EXTS);
      const isAudio = hasExt(filePath, AUDIO_EXTS);
      if (!isAudio && !isVideo) {
        showToast(`不支持的文件格式：${basename(filePath)}`, "error");
        return;
      }
      const cmd = isVideo ? "import_local_video_file" : "import_audio_file";
      try {
        const mediaId = await tauriInvoke<number>(cmd, { filePath });
        // Open detail so the user can watch transcribe progress.
        const item = await tauriInvoke<MediaItem>("get_media_item", { id: mediaId });
        setSelected(item);
        loadItems();
      } catch (e) {
        showToast(`导入失败：${String(e)}`, "error");
      }
    },
    [showToast, loadItems],
  );

  const importMultiple = useCallback(
    async (paths: string[]) => {
      if (uploadingRef.current) return;
      uploadingRef.current = true;
      setImporting(true);
      try {
        for (const p of paths) {
          await importFile(p);
        }
      } finally {
        uploadingRef.current = false;
        setImporting(false);
      }
    },
    [importFile],
  );

  // Tauri drag-drop scoped to this page.
  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (cancelled) return;
        const payload = e.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(true);
        } else if (payload.type === "leave") {
          setDragging(false);
        } else if (payload.type === "drop") {
          setDragging(false);
          void importMultiple(payload.paths);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else off = fn;
      })
      .catch(console.error);
    return () => {
      cancelled = true;
      off?.();
    };
  }, [importMultiple]);

  const pickAudio = async () => {
    const selectedPaths = await openFileDialog({
      multiple: true,
      filters: [{ name: "音频文件", extensions: AUDIO_EXTS }],
    });
    if (!selectedPaths) return;
    const paths = Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths];
    await importMultiple(paths);
  };

  const pickVideo = async () => {
    const selectedPaths = await openFileDialog({
      multiple: true,
      filters: [{ name: "视频文件", extensions: VIDEO_EXTS }],
    });
    if (!selectedPaths) return;
    const paths = Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths];
    await importMultiple(paths);
  };

  const handleStar = async (id: number) => {
    await tauriInvoke("toggle_star_media_item", { id });
    loadItems();
    if (selected?.id === id) {
      setSelected((prev) => (prev ? { ...prev, is_starred: !prev.is_starred } : null));
    }
  };

  const handleDelete = async (id: number) => {
    await tauriInvoke("delete_media_item", { id });
    if (selected?.id === id) setSelected(null);
    loadItems();
  };

  const handleRetag = async (id: number) => {
    await tauriInvoke("ai_auto_tag_media_item", { id }).catch(console.error);
    loadItems();
  };

  // When ClipDetail calls onUpdate with a WebClip shape, we need to fold
  // those edits back into the MediaItem state. The shape is a superset
  // (it still has `notes`, which is the only field not in WebClip) so
  // we reconstruct the MediaItem by merging the edited web-shape fields
  // with the original MediaItem's file-origin fields.
  const onDetailUpdate = useCallback(
    (updated: WebClip) => {
      setSelected((prev) => {
        if (!prev || prev.id !== updated.id) return prev;
        return {
          ...prev,
          title: updated.title,
          content: updated.content,
          raw_content: updated.raw_content,
          summary: updated.summary,
          tags: updated.tags,
          is_read: updated.is_read,
          is_starred: updated.is_starred,
          updated_at: updated.updated_at,
          transcription_status: updated.transcription_status ?? prev.transcription_status,
          transcription_error: updated.transcription_error ?? prev.transcription_error,
          transcription_source: updated.transcription_source ?? prev.transcription_source,
          source_language: updated.source_language ?? prev.source_language,
          translated_content: updated.translated_content ?? prev.translated_content,
        };
      });
      loadItems();
    },
    [loadItems],
  );

  const selectedClipShape = selected ? asClipShape(selected) : null;

  // Narrow view: full-page detail.
  if (selectedClipShape && !isWide) {
    return (
      <ClipDetail
        key={selectedClipShape.id}
        clip={selectedClipShape}
        kind="media"
        onBack={() => setSelected(null)}
        onStar={handleStar}
        onUpdate={onDetailUpdate}
      />
    );
  }

  const splitView = isWide && selectedClipShape;
  const audioItems = items.filter((m) => m.media_type === "audio");
  const videoItems = items.filter((m) => m.media_type === "local_video");

  return (
    <div className={splitView ? "flex gap-0 -mx-6 -my-6 h-[calc(100vh)]" : "relative"}>
      <MediaDropOverlay visible={dragging} />
      {splitView && selectedClipShape && (
        <div className="w-3/5 order-2 overflow-y-auto px-6 py-6 border-l border-border">
          <ClipDetail
            key={selectedClipShape.id}
            clip={selectedClipShape}
            kind="media"
            onBack={() => setSelected(null)}
            onStar={handleStar}
            onUpdate={onDetailUpdate}
            compact
          />
        </div>
      )}

      <div className={splitView ? "w-2/5 order-1 overflow-y-auto px-4 py-4" : ""}>
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight m-0">影音</h1>
            <p className="text-[13px] text-text-tertiary mt-1 m-0">
              本地音频 + 本地视频 · 自动转文字
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={pickAudio}
              disabled={importing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg-secondary border border-border text-[13px] text-text hover:border-accent/30 hover:bg-accent/5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Headphones size={13} />
              导入音频
            </button>
            <button
              onClick={pickVideo}
              disabled={importing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Video size={13} />
              导入视频
            </button>
          </div>
        </div>

        {/* Drop hint */}
        {!loading && items.length === 0 && !dragging && (
          <div className="py-16 text-center rounded-xl border-2 border-dashed border-border">
            <Upload
              size={36}
              strokeWidth={1.5}
              className="mx-auto mb-3 text-text-tertiary opacity-50"
            />
            <p className="text-[14px] text-text-secondary m-0">
              拖入音频 / 视频文件，或使用右上角按钮选择
            </p>
            <p className="text-[11px] text-text-tertiary mt-2 m-0">
              支持 {AUDIO_EXTS.join("、")} / {VIDEO_EXTS.join("、")}
            </p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Audio section */}
        {!loading && audioItems.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Headphones size={15} className="text-accent" />
              <h2 className="text-[15px] font-semibold m-0">音频</h2>
              <span className="text-[11px] text-text-tertiary">· {audioItems.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {audioItems.map((m) => (
                <ClipCard
                  key={m.id}
                  clip={asClipShape(m)}
                  onStar={handleStar}
                  onDelete={handleDelete}
                  onSelect={() => setSelected(m)}
                  onRetag={handleRetag}
                  isSelected={selected?.id === m.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* Local video section */}
        {!loading && videoItems.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Video size={15} className="text-accent" />
              <h2 className="text-[15px] font-semibold m-0">本地视频</h2>
              <span className="text-[11px] text-text-tertiary">· {videoItems.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {videoItems.map((m) => (
                <ClipCard
                  key={m.id}
                  clip={asClipShape(m)}
                  onStar={handleStar}
                  onDelete={handleDelete}
                  onSelect={() => setSelected(m)}
                  onRetag={handleRetag}
                  isSelected={selected?.id === m.id}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
