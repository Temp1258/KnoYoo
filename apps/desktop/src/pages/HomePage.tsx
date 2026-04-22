import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Search,
  FileText,
  BookOpen,
  Video,
  Headphones,
  Library,
  Clock,
  Star,
  Compass,
  Loader2,
  Upload,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { SearchHit } from "../types";
import KnoYooLogo from "../components/Layout/KnoYooLogo";
import { useToast } from "../components/common/toast-context";

const DEBOUNCE_MS = 160;
const PAGE_SIZE = 10;

/** Extensions the home-page drag-drop dispatcher routes to each command.
 *  Kept in sync with the per-page ACCEPTED_EXTS lists — if either side
 *  changes, validate here too. */
const BOOK_EXTS = ["epub", "pdf"];
const AUDIO_EXTS = ["mp3", "m4a", "wav", "flac", "opus", "ogg", "aac", "webm"];
const VIDEO_EXTS = ["mp4", "mov", "mkv", "avi", "webm", "m4v", "flv", "wmv"];

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "";
  return path.slice(dot + 1).toLowerCase();
}

type Shortcut = {
  icon: typeof Library;
  label: string;
  hint: string;
  to: string;
};

// Quick-access entry points shown when the search box is empty. Each one
// routes to an existing page — the homepage itself is pure navigation +
// search, not yet another list view.
const SHORTCUTS: Shortcut[] = [
  { icon: Library, label: "智库", hint: "浏览所有剪藏", to: "/clips" },
  { icon: BookOpen, label: "书籍", hint: "EPUB / PDF 书架", to: "/books" },
  { icon: Headphones, label: "影音", hint: "音频 / 本地视频", to: "/media" },
  { icon: Compass, label: "发现", hint: "标签云 / 周报", to: "/discover" },
];

function iconFor(kind: SearchHit["kind"]) {
  switch (kind) {
    case "book":
      return <BookOpen size={14} className="text-amber-500" />;
    case "video":
      return <Video size={14} className="text-rose-500" />;
    case "media":
      return <Headphones size={14} className="text-accent" />;
    default:
      return <FileText size={14} className="text-blue-500" />;
  }
}

function kindLabel(kind: SearchHit["kind"]): string {
  switch (kind) {
    case "book":
      return "书籍";
    case "video":
      return "视频";
    case "media":
      return "影音";
    default:
      return "剪藏";
  }
}

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);
  const uploadingRef = useRef(false);
  // Tracks whether the component is still mounted. Import tasks can outlive
  // the home page when the user starts a drop and then navigates away — any
  // setState or navigate() against an unmounted tree would trigger React
  // warnings and, for navigate, re-mount the page unexpectedly.
  const mountedRef = useRef(true);
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    mountedRef.current = true;
    inputRef.current?.focus();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Drag-drop dispatcher: classify by extension and route to the matching
  // per-kind command. `.webm` is treated as video (more common use case)
  // so audio dispatch only matches pure audio containers. Unknown formats
  // surface an explicit toast rather than silently failing.
  //
  // macOS 照片 App 会给出 library bundle 内的 thumbnail JPEG 路径（而不是
  // 原始视频）；我们统一截胡并引导用户先导出。
  const importOne = useCallback(
    async (filePath: string): Promise<boolean> => {
      if (filePath.toLowerCase().includes(".photoslibrary/")) {
        showToast(
          "『照片』App 的文件不能直接拖入。请先选中视频 → 文件 → 导出 → 导出未修改的原始文件，再把导出后的文件拖进来。",
          "error",
        );
        return false;
      }
      const ext = extOf(filePath);
      if (BOOK_EXTS.includes(ext)) {
        try {
          await tauriInvoke("add_book", { filePath });
          return true;
        } catch (e) {
          showToast(`书籍导入失败：${String(e)}`, "error");
          return false;
        }
      }
      if (VIDEO_EXTS.includes(ext)) {
        try {
          const clipId = await tauriInvoke<number>("import_local_video_file", {
            filePath,
          });
          navigate(`/media?openClip=${clipId}`);
          return true;
        } catch (e) {
          showToast(`视频导入失败：${String(e)}`, "error");
          return false;
        }
      }
      if (AUDIO_EXTS.includes(ext) && ext !== "webm") {
        try {
          const clipId = await tauriInvoke<number>("import_audio_file", {
            filePath,
          });
          navigate(`/media?openClip=${clipId}`);
          return true;
        } catch (e) {
          showToast(`音频导入失败：${String(e)}`, "error");
          return false;
        }
      }
      showToast(`不支持的文件格式：.${ext || "?"}`, "error");
      return false;
    },
    [navigate, showToast],
  );

  const importDropped = useCallback(
    async (paths: string[]) => {
      if (uploadingRef.current) return;
      uploadingRef.current = true;
      if (mountedRef.current) setImporting(true);
      try {
        // Sequential — ASR/ffmpeg load is heavy; parallel imports would
        // saturate the Rust background pool and confuse progress emitting.
        let firstBookImported = false;
        for (const p of paths) {
          const ok = await importOne(p);
          if (ok && BOOK_EXTS.includes(extOf(p))) {
            firstBookImported = true;
          }
          // Early exit if the page unmounted mid-batch; the importOne call
          // for the current file has already returned, but the backend will
          // keep processing — we just stop navigating / updating UI.
          if (!mountedRef.current) break;
        }
        if (firstBookImported && mountedRef.current) {
          navigate("/books");
        }
      } finally {
        uploadingRef.current = false;
        if (mountedRef.current) setImporting(false);
      }
    },
    [importOne, navigate],
  );

  // Register the Tauri drag-drop listener while the home page is mounted.
  // Navigation to /books / /media unmounts this page and its cleanup will
  // detach the listener, handing the drop target back to the destination
  // page's own handler.
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
          void importDropped(payload.paths);
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
  }, [importDropped]);

  const loadPage = useCallback(async (q: string, append: boolean, pageOffset: number) => {
    const mySeq = ++searchSeq.current;
    if (q.trim().length === 0) {
      setResults([]);
      setLoading(false);
      setOffset(0);
      setHasMore(true);
      return;
    }
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const data = await tauriInvoke<SearchHit[]>("unified_search", {
        q,
        scope: "all",
        limit: PAGE_SIZE,
        offset: pageOffset,
      });
      if (mySeq !== searchSeq.current) return;
      setResults((prev) => (append ? [...prev, ...data] : data));
      setOffset(pageOffset + data.length);
      setHasMore(data.length === PAGE_SIZE);
    } catch (e) {
      if (mySeq === searchSeq.current) {
        console.error("home search failed:", e);
        if (!append) setResults([]);
        setHasMore(false);
      }
    } finally {
      if (mySeq === searchSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadPage(query, false, 0), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, loadPage]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading || loadingMore || results.length === 0) {
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadPage(query, true, offset);
        }
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, loadingMore, results.length, query, offset, loadPage]);

  const choose = (hit: SearchHit) => {
    if (hit.kind === "book") {
      navigate(`/books?openBook=${hit.id}`);
    } else if (hit.kind === "media") {
      navigate(`/media?openClip=${hit.id}`);
    } else {
      // Clip + online video (YouTube/Bilibili) live in the Clips page.
      navigate(`/clips?openClip=${hit.id}`);
    }
  };

  const hasQuery = query.trim().length > 0;

  return (
    <div className="max-w-3xl mx-auto pt-16 sm:pt-24 pb-10 px-2 relative">
      {/* Drag-drop overlay */}
      {dragging && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-bg/80 backdrop-blur-sm animate-fade-in pointer-events-none"
          aria-hidden="true"
        >
          <div className="flex flex-col items-center gap-4 px-16 py-14 rounded-2xl border-2 border-dashed border-accent bg-bg-secondary/90 shadow-lg">
            <div className="w-16 h-16 rounded-2xl bg-accent-light flex items-center justify-center">
              <Upload size={32} className="text-accent" strokeWidth={1.6} />
            </div>
            <div className="text-[16px] font-semibold text-text">松开以导入到 KnoYoo</div>
            <div className="text-[12px] text-text-tertiary">支持书籍 (EPUB/PDF) · 音频 · 视频</div>
          </div>
        </div>
      )}

      {/* Import-in-progress toast-like hint */}
      {importing && (
        <div className="fixed top-4 right-4 z-[80] flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-secondary border border-border shadow-md text-[12px]">
          <Loader2 size={12} className="animate-spin text-accent" />
          正在导入…
        </div>
      )}

      {/* Brand */}
      <div
        className={`flex flex-col items-center gap-4 transition-all duration-300 ${
          hasQuery ? "mb-6" : "mb-8 sm:mb-12"
        }`}
      >
        <KnoYooLogo size={hasQuery ? 52 : 72} className="rounded-2xl" />
        <div className="text-center">
          <h1
            className={`font-bold tracking-tight text-text m-0 transition-all ${
              hasQuery ? "text-[20px]" : "text-[32px]"
            }`}
          >
            KnoYoo
          </h1>
          {!hasQuery && (
            <p className="text-[13px] text-text-tertiary mt-1">本地优先的 AI 私人智库</p>
          )}
        </div>
      </div>

      {/* Large search bar */}
      <div className="relative">
        <Search
          size={18}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索你的知识库，剪藏、书籍、音视频…"
          className="w-full h-14 pl-12 pr-4 rounded-full bg-bg-secondary border border-border text-[15px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent/40 focus:shadow-md focus:ring-4 focus:ring-accent/10 transition-all duration-200"
        />
        {loading && (
          <Loader2
            size={16}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary animate-spin"
          />
        )}
      </div>

      {/* Empty-query shortcuts */}
      {!hasQuery && (
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {SHORTCUTS.map(({ icon: Icon, label, hint, to }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="flex flex-col items-start gap-2 p-4 rounded-xl bg-bg-secondary border border-border hover:border-accent/30 hover:shadow-sm transition-all cursor-pointer text-left"
            >
              <Icon size={18} className="text-accent" />
              <div>
                <div className="text-[13px] font-semibold text-text">{label}</div>
                <div className="text-[11px] text-text-tertiary mt-0.5">{hint}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {hasQuery && (
        <div className="mt-5 rounded-xl bg-bg-secondary border border-border overflow-hidden">
          {!loading && results.length === 0 && (
            <div className="px-5 py-8 text-center text-[13px] text-text-tertiary">没有匹配结果</div>
          )}
          {results.map((hit) => (
            <button
              key={`${hit.kind}-${hit.id}`}
              onClick={() => choose(hit)}
              className="w-full text-left px-5 py-3 flex items-start gap-3 border-b border-border last:border-b-0 hover:bg-bg-tertiary transition-colors cursor-pointer"
            >
              <div className="mt-0.5 shrink-0">{iconFor(hit.kind)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium text-text truncate">
                  {hit.title || "(无标题)"}
                </div>
                {hit.snippet && (
                  <div className="text-[12px] text-text-secondary line-clamp-1 mt-0.5">
                    {hit.snippet}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-[10px] text-text-tertiary uppercase tracking-wider pt-1">
                {kindLabel(hit.kind)}
              </div>
            </button>
          ))}
          {results.length > 0 && hasMore && (
            <div ref={sentinelRef} className="py-3 text-center text-[11px] text-text-tertiary">
              {loadingMore ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  加载更多…
                </span>
              ) : (
                "继续滚动加载更多"
              )}
            </div>
          )}
          {results.length > 0 && !hasMore && !loading && (
            <div className="py-3 text-center text-[11px] text-text-tertiary">已显示全部结果</div>
          )}
        </div>
      )}

      {/* Inline tip footer */}
      {!hasQuery && (
        <div className="mt-10 flex items-center justify-center gap-4 text-[11px] text-text-tertiary">
          <span className="inline-flex items-center gap-1">
            <Clock size={10} /> 全局搜索 = 主页搜索
          </span>
          <span className="inline-flex items-center gap-1">
            <Star size={10} /> 任意位置按 Cmd/Ctrl+Shift+K 随时唤起
          </span>
        </div>
      )}
    </div>
  );
}
