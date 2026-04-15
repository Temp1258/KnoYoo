import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Plus } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useBooks, type Book } from "../hooks/useBooks";
import { useToast } from "../components/common/Toast";
import BookShelf from "../components/Books/BookShelf";
import BookDropOverlay from "../components/Books/BookDropOverlay";
import BookDetailDrawer from "../components/Books/BookDetailDrawer";
import { Skeleton } from "../components/ui/Skeleton";

const ACCEPTED_EXTS = ["epub", "pdf"];

function hasAcceptedExt(path: string): boolean {
  const lower = path.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(`.${ext}`));
}

export default function BooksPage() {
  const {
    books,
    loading,
    addBook,
    refresh,
    updateBook,
    deleteBook,
    setBookCover,
    openExternally,
    aiAnalyze,
  } = useBooks();
  const { showToast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const uploadingRef = useRef(false);

  // Keep the drawer's book reference in sync with list updates
  const selected = useMemo(
    () => (selectedId == null ? null : (books.find((b) => b.id === selectedId) ?? null)),
    [books, selectedId],
  );
  const openBook = (b: Book) => setSelectedId(b.id);
  const closeDrawer = () => setSelectedId(null);

  const grouped = useMemo(() => {
    const by = { reading: [], want: [], read: [], dropped: [] } as Record<
      "reading" | "want" | "read" | "dropped",
      Book[]
    >;
    for (const b of books) by[b.status].push(b);
    return by;
  }, [books]);

  const empty = !loading && books.length === 0;

  // After add_book, the AI metadata extraction runs in a Rust background
  // thread. Poll while any book is in "pending" — independent of title,
  // because we now seed title from the filename at insert time.
  // Failed books flip to "failed" and surface a retry affordance — no
  // point polling them.
  useEffect(() => {
    const hasPending = books.some((b) => b.aiStatus === "pending");
    if (!hasPending) return;
    const interval = setInterval(() => {
      void refresh();
    }, 4000);
    const stop = setTimeout(() => clearInterval(interval), 120_000);
    return () => {
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [books, refresh]);

  const uploadPaths = useCallback(
    async (paths: string[]) => {
      const accepted = paths.filter(hasAcceptedExt);
      const rejected = paths.length - accepted.length;
      if (rejected > 0) {
        showToast(`已跳过 ${rejected} 个不支持的文件（仅支持 EPUB / PDF）`, "info");
      }
      if (accepted.length === 0) return;

      uploadingRef.current = true;
      showToast(`正在添加 ${accepted.length} 本书…`, "info");

      let ok = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const p of accepted) {
        try {
          await addBook(p);
          ok += 1;
        } catch (e) {
          const msg = String(e);
          if (msg.includes("已在书籍")) {
            skipped += 1;
          } else {
            errors.push(msg);
          }
        }
      }
      uploadingRef.current = false;

      // Summary toast
      if (ok > 0) showToast(`已添加 ${ok} 本书`, "success");
      if (skipped > 0) showToast(`${skipped} 本书已存在，已跳过`, "info");
      if (errors.length > 0) showToast(`${errors.length} 本添加失败：${errors[0]}`, "error");

      // Make sure state is fresh even if optimistic update missed something
      await refresh();
    },
    [addBook, refresh, showToast],
  );

  // Tauri 2 native drag-drop — scoped to this page via mount/unmount.
  // The `cancelled` flag ensures unlisten always runs even if the component
  // unmounts before onDragDropEvent's promise resolves (e.g. StrictMode
  // double-mount, or quick route switch).
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
          if (!uploadingRef.current) {
            void uploadPaths(payload.paths);
          }
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          off = fn;
        }
      })
      .catch((err) => {
        console.error("Failed to attach drag-drop listener:", err);
      });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [uploadPaths]);

  const handlePickFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "图书", extensions: ACCEPTED_EXTS }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await uploadPaths(paths);
  };

  return (
    <div className="relative">
      <BookDropOverlay visible={dragging} />
      <BookDetailDrawer
        book={selected}
        onClose={closeDrawer}
        onUpdate={updateBook}
        onDelete={deleteBook}
        onSetCover={setBookCover}
        onOpenExternally={openExternally}
        onAiAnalyze={aiAnalyze}
      />

      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">书籍</h1>
          <p className="text-[13px] text-text-tertiary mt-1">你读过、正在读、想读的书都在这里</p>
        </div>
        <button
          type="button"
          onClick={handlePickFiles}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent-hover transition-colors cursor-pointer"
        >
          <Plus size={14} strokeWidth={2.2} />
          添加图书
        </button>
      </header>

      {loading ? (
        <BookShelfSkeleton />
      ) : empty ? (
        <EmptyState onPick={handlePickFiles} />
      ) : (
        <div className="space-y-10">
          <BookShelf
            title="正在读"
            emphasize
            books={grouped.reading}
            onBookClick={openBook}
            onBookDoubleClick={(b) =>
              openExternally(b.id).catch((e) => showToast(`打开失败：${e}`, "error"))
            }
          />
          <BookShelf
            title="想读"
            books={grouped.want}
            onBookClick={openBook}
            onBookDoubleClick={(b) =>
              openExternally(b.id).catch((e) => showToast(`打开失败：${e}`, "error"))
            }
          />
          <BookShelf
            title="已读"
            books={grouped.read}
            onBookClick={openBook}
            onBookDoubleClick={(b) =>
              openExternally(b.id).catch((e) => showToast(`打开失败：${e}`, "error"))
            }
          />
          <BookShelf
            title="弃读"
            books={grouped.dropped}
            defaultCollapsed
            onBookClick={openBook}
            onBookDoubleClick={(b) =>
              openExternally(b.id).catch((e) => showToast(`打开失败：${e}`, "error"))
            }
          />
        </div>
      )}
    </div>
  );
}

function BookShelfSkeleton() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <Skeleton className="h-5 w-24" />
        <div className="flex flex-wrap gap-x-5 gap-y-6 pl-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 w-[132px]">
              <Skeleton className="aspect-[2/3] w-full rounded-lg" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-2.5 w-3/5" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex items-center justify-center py-24">
      <button
        type="button"
        onClick={onPick}
        className="flex flex-col items-center gap-4 px-16 py-16 rounded-2xl border-2 border-dashed border-border hover:border-accent/50 transition-colors text-center max-w-md cursor-pointer group"
      >
        <div className="w-16 h-16 rounded-2xl bg-accent-light flex items-center justify-center group-hover:bg-accent/15 transition-colors">
          <BookOpen size={32} className="text-accent" strokeWidth={1.6} />
        </div>
        <div>
          <div className="text-[16px] font-semibold text-text">书架空空如也</div>
          <div className="text-[12px] text-text-tertiary mt-1.5 leading-relaxed">
            拖入 EPUB 或 PDF 文件，或点击此处选择
          </div>
        </div>
      </button>
    </div>
  );
}
