import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { Search, FileText, BookOpen, Video, Command, Loader2 } from "lucide-react";
import { tauriInvoke } from "./hooks/useTauriInvoke";
import type { SearchHit } from "./types";

const DEBOUNCE_MS = 120;
/** Hits per page. Small first page keeps the overlay snappy; scrolling
 *  fetches more on demand via IntersectionObserver. */
const PAGE_SIZE = 10;

/**
 * Event emitted by the overlay when the user picks a result. The main window
 * listens for this, navigates to the right route, then surfaces itself.
 * Name kept in sync with `useQuickSearchNavigation` in App.tsx.
 */
const OPEN_CONTENT_EVENT = "quick-search://open";

/** Fired by Rust when the overlay is shown via global shortcut. */
const SHOWN_EVENT = "quick-search://shown";

type ContentRef =
  | { kind: "clip"; id: number }
  | { kind: "book"; id: number }
  | { kind: "video"; id: number }
  | { kind: "media"; id: number }
  | { kind: "document"; id: number };

function iconFor(kind: SearchHit["kind"]) {
  switch (kind) {
    case "book":
      return <BookOpen size={14} className="text-amber-500" />;
    case "video":
      return <Video size={14} className="text-rose-500" />;
    case "media":
      return <Video size={14} className="text-accent" />;
    case "document":
      return <FileText size={14} className="text-emerald-500" />;
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
    case "document":
      return "文档";
    default:
      return "剪藏";
  }
}

export default function QuickSearchApp() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);

  // Single source of truth for a page fetch. `append=false` starts fresh
  // (query change); `append=true` extends the existing list (scroll).
  // Offset is passed in so we don't need to make this callback depend on
  // component state — which would stale-close IntersectionObserver.
  const loadPage = useCallback(async (q: string, append: boolean, pageOffset: number) => {
    const mySeq = ++searchSeq.current;
    if (!append) setSelected(0);

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
      // Short page == backend exhausted the merged pool — no more to load.
      setHasMore(data.length === PAGE_SIZE);
    } catch (e) {
      if (mySeq === searchSeq.current) {
        console.error("quick search failed:", e);
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

  // Query change → debounce → fresh page 0.
  useEffect(() => {
    const timer = setTimeout(() => loadPage(query, false, 0), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, loadPage]);

  // Infinite scroll: when the sentinel enters the viewport and more pages
  // are available, fetch the next page. Reconnects whenever query / loading
  // flags change so the observer always reflects current state.
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

  // Reset + refocus every time Rust re-shows the window via the shortcut.
  useEffect(() => {
    const unlistenPromise = listen(SHOWN_EVENT, () => {
      setQuery("");
      setResults([]);
      setSelected(0);
      setOffset(0);
      setHasMore(true);
      setTimeout(() => inputRef.current?.focus(), 30);
    });
    inputRef.current?.focus();
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const hideWindow = useCallback(async () => {
    try {
      await getCurrentWindow().hide();
    } catch (e) {
      console.error("hide overlay failed:", e);
    }
  }, []);

  const choose = useCallback(
    async (hit: SearchHit) => {
      const payload: ContentRef = { kind: hit.kind, id: hit.id };
      try {
        await emit(OPEN_CONTENT_EVENT, payload);
      } catch (e) {
        console.error("emit open-content failed:", e);
      }
      await hideWindow();
    },
    [hideWindow],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      hideWindow();
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[selected];
      if (pick) choose(pick);
    }
  };

  return (
    <div
      className="h-screen w-screen flex items-start justify-center bg-transparent select-none"
      onKeyDown={onKeyDown}
    >
      <div className="mt-4 w-[92vw] max-w-[620px] rounded-2xl bg-bg/95 backdrop-blur-xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-border shrink-0">
          <Search size={18} className="text-text-tertiary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索剪藏、书籍、视频…"
            className="flex-1 bg-transparent outline-none text-[15px] text-text placeholder:text-text-tertiary"
          />
          {loading && <span className="text-[11px] text-text-tertiary tabular-nums">搜索中…</span>}
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 h-5 rounded bg-bg-tertiary text-[10px] text-text-tertiary font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {query.trim().length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-text-tertiary">
              输入关键词开始搜索你的智库
            </div>
          )}
          {query.trim().length > 0 && !loading && results.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-text-tertiary">没有匹配结果</div>
          )}
          {results.map((hit, i) => {
            const isSelected = i === selected;
            return (
              <button
                key={`${hit.kind}-${hit.id}`}
                onClick={() => choose(hit)}
                onMouseEnter={() => setSelected(i)}
                className={`w-full text-left px-4 py-2.5 flex items-start gap-3 border-l-2 transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-accent/10 border-accent"
                    : "border-transparent hover:bg-bg-secondary"
                }`}
              >
                <div className="mt-0.5 shrink-0">{iconFor(hit.kind)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-text truncate">
                    {hit.title || "(无标题)"}
                  </div>
                  {hit.snippet && (
                    <div className="text-[11px] text-text-secondary line-clamp-1 mt-0.5">
                      {hit.snippet}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-[10px] text-text-tertiary uppercase tracking-wider">
                  {kindLabel(hit.kind)}
                </div>
              </button>
            );
          })}
          {/* Sentinel for IntersectionObserver-triggered paging. */}
          {results.length > 0 && hasMore && (
            <div
              ref={sentinelRef}
              className="py-3 flex items-center justify-center text-[11px] text-text-tertiary"
            >
              {loadingMore ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  加载更多…
                </span>
              ) : (
                <span>继续滚动加载更多</span>
              )}
            </div>
          )}
          {results.length > 0 && !hasMore && !loading && (
            <div className="py-3 text-center text-[11px] text-text-tertiary">已显示全部结果</div>
          )}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div className="flex items-center justify-between px-4 h-8 border-t border-border text-[10px] text-text-tertiary shrink-0">
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1">
                <kbd className="px-1 bg-bg-tertiary rounded">↑</kbd>
                <kbd className="px-1 bg-bg-tertiary rounded">↓</kbd>
                浏览
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 bg-bg-tertiary rounded">↵</kbd>
                打开
              </span>
            </span>
            <span className="flex items-center gap-1">
              <Command size={10} />
              <span>KnoYoo</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
