import { useCallback, useEffect, useState } from "react";
import { Trash2, RotateCcw, AlertTriangle } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { Book } from "../../hooks/useBooks";
import Button from "../ui/Button";
import { useToast } from "../common/Toast";
import BookCover from "../Books/BookCover";

interface RawBook {
  id: number;
  file_hash: string;
  title: string;
  author: string;
  publisher: string;
  published_year: number | null;
  description: string;
  cover_path: string;
  file_path: string;
  file_format: "epub" | "pdf";
  file_size: number;
  page_count: number | null;
  status: "want" | "reading" | "read" | "dropped";
  progress_percent: number;
  rating: number | null;
  notes: string;
  tags: string[];
  added_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_opened_at: string | null;
  updated_at: string;
  deleted_at: string | null;
  ai_status?: "pending" | "ok" | "failed";
  ai_error?: string;
}

function normalize(r: RawBook): Book {
  return {
    id: r.id,
    fileHash: r.file_hash,
    title: r.title,
    author: r.author,
    publisher: r.publisher,
    publishedYear: r.published_year,
    description: r.description,
    coverPath: r.cover_path,
    filePath: r.file_path,
    fileFormat: r.file_format,
    fileSize: r.file_size,
    pageCount: r.page_count,
    status: r.status,
    progressPercent: r.progress_percent,
    rating: r.rating,
    notes: r.notes,
    tags: r.tags,
    addedAt: r.added_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    lastOpenedAt: r.last_opened_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    aiStatus: r.ai_status ?? "pending",
    aiError: r.ai_error ?? "",
  };
}

function formatDeletedDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

interface Props {
  onCountChange?: (count: number) => void;
}

export default function BooksTrashPanel({ onCountChange }: Props) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<Set<number>>(new Set());
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await tauriInvoke<RawBook[]>("list_books_trash");
      setBooks(raw.map(normalize));
    } catch (e) {
      showToast(`加载失败：${e}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  // Count is derived from `books` length (list is not paginated, so length is
  // accurate). Using an effect avoids stale-closure reads when several handlers
  // fire quickly in succession.
  useEffect(() => {
    if (!loading) onCountChange?.(books.length);
  }, [books.length, loading, onCountChange]);

  const markActioning = (id: number, on: boolean) => {
    setActioning((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleRestore = async (book: Book) => {
    markActioning(book.id, true);
    try {
      await tauriInvoke("restore_book", { id: book.id });
      setBooks((prev) => prev.filter((b) => b.id !== book.id));
      showToast(`《${book.title}》已恢复`, "success");
    } catch (e) {
      showToast(`恢复失败：${e}`, "error");
    } finally {
      markActioning(book.id, false);
    }
  };

  const handlePurge = async (book: Book) => {
    markActioning(book.id, true);
    try {
      await tauriInvoke("purge_book", { id: book.id });
      setBooks((prev) => prev.filter((b) => b.id !== book.id));
      showToast("已永久删除", "info");
    } catch (e) {
      showToast(`删除失败：${e}`, "error");
    } finally {
      markActioning(book.id, false);
    }
  };

  const handleEmpty = async () => {
    setConfirmEmpty(false);
    try {
      const count = await tauriInvoke<number>("empty_books_trash");
      // Refresh from source rather than trusting `[]` — backend may have
      // left rows behind on partial failure, and the effect will sync count.
      await load();
      showToast(`已清空 ${count} 本书`, "success");
    } catch (e) {
      showToast(`清空失败：${e}`, "error");
    }
  };

  return (
    <div>
      {books.length > 0 && (
        <div className="flex justify-end mb-4">
          <Button variant="danger" size="sm" onClick={() => setConfirmEmpty(true)}>
            <Trash2 size={13} />
            清空图书回收站
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl mb-4 bg-yellow-500/5 border border-yellow-500/15">
        <AlertTriangle size={14} className="text-yellow-600 shrink-0" />
        <span className="text-[12px] text-yellow-700">
          永久删除图书会同时删除其文件与封面，且无法恢复
        </span>
      </div>

      {loading && books.length === 0 && (
        <div className="text-[13px] text-text-tertiary py-8 text-center">加载中…</div>
      )}

      {!loading && books.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
          <Trash2 size={48} strokeWidth={1} className="mb-4 opacity-30" />
          <p className="text-[15px] font-medium mb-1">没有已删除的图书</p>
          <p className="text-[12px]">删除的图书会出现在这里</p>
        </div>
      )}

      {books.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-fade-in">
          {books.map((book) => {
            const isActioning = actioning.has(book.id);
            return (
              <div
                key={book.id}
                className={`group flex gap-3 rounded-xl border border-l-[3px] border-border border-l-red-400/60 bg-bg-secondary p-3 transition-all duration-200 ${
                  isActioning
                    ? "opacity-50 pointer-events-none"
                    : "hover:border-accent/30 hover:shadow-md"
                }`}
              >
                <div className="w-[64px] h-[96px] shrink-0">
                  <BookCover book={book} />
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                  <h3 className="text-[14px] font-semibold text-text leading-snug line-clamp-2 m-0">
                    {book.title}
                  </h3>
                  <div className="text-[11px] text-text-tertiary mt-1">
                    {book.author || "未知作者"} · {book.fileFormat.toUpperCase()}
                  </div>
                  <div className="text-[11px] text-text-tertiary mt-0.5">
                    删除于 {formatDeletedDate(book.deletedAt)}
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRestore(book)}
                      disabled={isActioning}
                    >
                      <RotateCcw size={13} />
                      恢复
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handlePurge(book)}
                      disabled={isActioning}
                    >
                      <Trash2 size={13} />
                      永久删除
                    </Button>
                  </div>
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
              <h3 className="text-[15px] font-semibold text-text m-0">清空图书回收站</h3>
            </div>
            <p className="text-[13px] text-text-secondary m-0 mb-4">
              确定要永久删除 {books.length} 本书吗？书籍文件和封面会一并清理。
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirmEmpty(false)}>取消</Button>
              <Button variant="danger" onClick={handleEmpty}>
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
