import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Headphones, Video, Upload, Film } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { WebClip } from "../types";
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
  const [clips, setClips] = useState<WebClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedClip, setSelectedClip] = useState<WebClip | null>(null);
  const uploadingRef = useRef(false);
  const { showToast } = useToast();
  const isWide = useMediaQuery("(min-width: 1024px)");

  const loadClips = useCallback(async () => {
    setLoading(true);
    try {
      // list_web_clips_advanced returns all source types; we filter client-side
      // for audio + local_video. The dataset is small (single user library)
      // so this is fine; promoting to a backend includeSourceTypes param is a
      // follow-up if performance ever matters.
      const all = await tauriInvoke<WebClip[]>("list_web_clips_advanced", {
        page: 1,
        pageSize: 100,
      });
      setClips(all.filter((c) => c.source_type === "audio" || c.source_type === "local_video"));
    } catch (e) {
      console.error("load media clips failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClips();
  }, [loadClips]);

  // Deep-link support (from QuickSearch / HomePage).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const idRaw = searchParams.get("openClip");
    if (!idRaw) return;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) return;
    let stale = false;
    tauriInvoke<WebClip>("get_clip", { id })
      .then((clip) => {
        if (!stale) setSelectedClip(clip);
      })
      .catch(console.error)
      .finally(() => {
        if (!stale) {
          const next = new URLSearchParams(searchParams);
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
      const isVideo = hasExt(filePath, VIDEO_EXTS);
      const isAudio = hasExt(filePath, AUDIO_EXTS);
      if (!isAudio && !isVideo) {
        showToast(`不支持的文件格式：${filePath}`, "error");
        return;
      }
      const cmd = isVideo ? "import_local_video_file" : "import_audio_file";
      try {
        const clipId = await tauriInvoke<number>(cmd, { filePath });
        // Open detail so the user can watch transcribe progress.
        const clip = await tauriInvoke<WebClip>("get_clip", { id: clipId });
        setSelectedClip(clip);
        loadClips();
      } catch (e) {
        showToast(`导入失败：${String(e)}`, "error");
      }
    },
    [showToast, loadClips],
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
    const selected = await openFileDialog({
      multiple: true,
      filters: [{ name: "音频文件", extensions: AUDIO_EXTS }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await importMultiple(paths);
  };

  const pickVideo = async () => {
    const selected = await openFileDialog({
      multiple: true,
      filters: [{ name: "视频文件", extensions: VIDEO_EXTS }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await importMultiple(paths);
  };

  const handleStar = async (id: number) => {
    await tauriInvoke("toggle_star_clip", { id });
    loadClips();
    if (selectedClip?.id === id) {
      setSelectedClip((prev) => (prev ? { ...prev, is_starred: !prev.is_starred } : null));
    }
  };

  const handleDelete = async (id: number) => {
    await tauriInvoke("delete_web_clip", { id });
    if (selectedClip?.id === id) setSelectedClip(null);
    loadClips();
  };

  const handleRetag = async (id: number) => {
    await tauriInvoke("ai_auto_tag_clip", { id }).catch(console.error);
    loadClips();
  };

  // Narrow view: full-page detail.
  if (selectedClip && !isWide) {
    return (
      <ClipDetail
        key={selectedClip.id}
        clip={selectedClip}
        onBack={() => setSelectedClip(null)}
        onStar={handleStar}
        onUpdate={(c) => {
          setSelectedClip(c);
          loadClips();
        }}
      />
    );
  }

  const splitView = isWide && selectedClip;
  const audioClips = clips.filter((c) => c.source_type === "audio");
  const videoClips = clips.filter((c) => c.source_type === "local_video");

  return (
    <div className={splitView ? "flex gap-0 -mx-6 -my-6 h-[calc(100vh)]" : "relative"}>
      <MediaDropOverlay visible={dragging} />
      {splitView && (
        <div className="w-3/5 order-2 overflow-y-auto px-6 py-6 border-l border-border">
          <ClipDetail
            key={selectedClip.id}
            clip={selectedClip}
            onBack={() => setSelectedClip(null)}
            onStar={handleStar}
            onUpdate={(c) => {
              setSelectedClip(c);
              loadClips();
            }}
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
        {!loading && clips.length === 0 && !dragging && (
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
        {!loading && audioClips.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Headphones size={15} className="text-accent" />
              <h2 className="text-[15px] font-semibold m-0">音频</h2>
              <span className="text-[11px] text-text-tertiary">· {audioClips.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {audioClips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  onStar={handleStar}
                  onDelete={handleDelete}
                  onSelect={setSelectedClip}
                  onRetag={handleRetag}
                  isSelected={selectedClip?.id === clip.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* Local video section */}
        {!loading && videoClips.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Video size={15} className="text-accent" />
              <h2 className="text-[15px] font-semibold m-0">本地视频</h2>
              <span className="text-[11px] text-text-tertiary">· {videoClips.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {videoClips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  onStar={handleStar}
                  onDelete={handleDelete}
                  onSelect={setSelectedClip}
                  onRetag={handleRetag}
                  isSelected={selectedClip?.id === clip.id}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
