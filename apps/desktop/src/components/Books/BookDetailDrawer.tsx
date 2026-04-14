import { useEffect, useRef, useState } from "react";
import { X, ExternalLink, ImagePlus, Trash2, Sparkles } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import SegmentedControl from "../ui/SegmentedControl";
import { useToast } from "../common/Toast";
import type { Book, BookStatus, BookPatch } from "../../hooks/useBooks";
import BookCover from "./BookCover";

interface Props {
  book: Book | null;
  onClose: () => void;
  onUpdate: (id: number, patch: BookPatch) => Promise<Book>;
  onDelete: (id: number) => Promise<void>;
  onSetCover: (id: number, imagePath: string) => Promise<Book>;
  onOpenExternally?: (id: number) => Promise<void>;
  onAiAnalyze?: (id: number) => Promise<Book>;
}

const STATUS_OPTIONS: { value: BookStatus; label: string }[] = [
  { value: "want", label: "想读" },
  { value: "reading", label: "正在读" },
  { value: "read", label: "已读" },
  { value: "dropped", label: "弃读" },
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Debounced field that commits after blur or 500ms of idle typing.
 * Keeps controlled input snappy without spamming the backend.
 */
/**
 * A debounced text field hook that ONLY re-syncs from `initial` when `scopeKey`
 * changes (i.e. when the user switched to a different book). This prevents
 * sibling-field updates from stomping on in-progress typing: if the user is
 * typing a new title while another call (e.g. rating, tag add) round-trips and
 * replaces the book object with a snapshot that still has the old title, the
 * user's typing would otherwise be reverted.
 */
function useDebouncedField<T extends string | number>(
  initial: T,
  commit: (v: T) => void,
  scopeKey: string | number | null | undefined,
  delay = 500,
) {
  const [value, setValue] = useState(initial);
  // Track scope so we only resync `value` when it changes (e.g. switched book).
  // Sibling-field updates leave scope untouched and thus don't stomp on the
  // user's in-progress typing. Following the React 19 pattern of adjusting
  // derived state during render rather than in an effect.
  const [prevScope, setPrevScope] = useState(scopeKey);
  if (scopeKey !== prevScope) {
    setPrevScope(scopeKey);
    setValue(initial);
  }
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flush any pending timer on unmount so we don't leak.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onChange = (v: T) => {
    setValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(v), delay);
  };
  const onBlur = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (value !== initial) commit(value);
  };
  return { value, onChange, onBlur };
}

export default function BookDetailDrawer({
  book,
  onClose,
  onUpdate,
  onDelete,
  onSetCover,
  onOpenExternally,
  onAiAnalyze,
}: Props) {
  const { showToast } = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!book) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [book, onClose]);

  // Reset local edit state whenever a different book is opened
  useEffect(() => {
    setTagInput("");
    setConfirmingDelete(false);
  }, [book?.id]);

  const bookId = book?.id;
  const titleField = useDebouncedField(
    book?.title ?? "",
    (v) => {
      if (!book) return;
      if (!v.trim()) return;
      void onUpdate(book.id, { title: v.trim() }).catch((e) =>
        showToast(`保存标题失败：${e}`, "error"),
      );
    },
    bookId,
  );
  const authorField = useDebouncedField(
    book?.author ?? "",
    (v) => {
      if (!book) return;
      void onUpdate(book.id, { author: v }).catch((e) => showToast(`保存作者失败：${e}`, "error"));
    },
    bookId,
  );
  const publisherField = useDebouncedField(
    book?.publisher ?? "",
    (v) => {
      if (!book) return;
      void onUpdate(book.id, { publisher: v }).catch(() => {});
    },
    bookId,
  );
  const yearField = useDebouncedField(
    book?.publishedYear?.toString() ?? "",
    (v) => {
      if (!book) return;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0 || n > 9999) return;
      void onUpdate(book.id, { published_year: n }).catch(() => {});
    },
    bookId,
  );
  const notesField = useDebouncedField(
    book?.notes ?? "",
    (v) => {
      if (!book) return;
      void onUpdate(book.id, { notes: v }).catch(() => {});
    },
    bookId,
  );

  if (!book) return null;

  const setStatus = (s: BookStatus) => {
    onUpdate(book.id, { status: s }).catch((e) => showToast(`切换状态失败：${e}`, "error"));
  };

  const setProgress = (p: number) => {
    onUpdate(book.id, { progress_percent: p }).catch(() => {});
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (book.tags.includes(t)) {
      setTagInput("");
      return;
    }
    const next = [...book.tags, t];
    onUpdate(book.id, { tags: next })
      .then(() => setTagInput(""))
      .catch((e) => showToast(`保存标签失败：${e}`, "error"));
  };

  const removeTag = (t: string) => {
    onUpdate(book.id, { tags: book.tags.filter((x) => x !== t) }).catch(() => {});
  };

  const handleChangeCover = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      await onSetCover(book.id, selected);
      showToast("封面已更新", "success");
    } catch (e) {
      showToast(`更换封面失败：${e}`, "error");
    }
  };

  const handleDelete = async () => {
    // Two-step inline confirmation: first click arms the button (label switches
    // to "确认删除"), second click performs the soft-delete. The drawer's own
    // backdrop would hide a modal, so we avoid showConfirm here.
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    try {
      await onDelete(book.id);
      showToast("已移入回收站", "success");
      onClose();
    } catch (e) {
      showToast(`删除失败：${e}`, "error");
    } finally {
      setConfirmingDelete(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[80] bg-black/30 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside
        className="fixed top-0 right-0 bottom-0 z-[81] w-full max-w-[420px] bg-bg-secondary border-l border-border shadow-lg flex flex-col animate-fade-in"
        role="dialog"
        aria-label="图书详情"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="text-[13px] text-text-tertiary">图书详情</div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text hover:bg-bg-tertiary transition-colors cursor-pointer"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* AI status banner: show whenever analysis is running or failed.
              Title may already be populated from the filename stem — the
              banner is what tells the user AI is still working (or has
              given up), so we don't gate it on emptiness. */}
          {book.aiStatus === "pending" && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/15 text-[12px] text-accent-hover">
              <Sparkles size={12} className="animate-pulse shrink-0" />
              <span>AI 正在阅读并分析这本书…</span>
            </div>
          )}
          {book.aiStatus === "failed" && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-danger-light border border-danger/20 text-[12px] text-danger">
              <div className="flex-1">
                <div className="font-medium">AI 分析失败</div>
                {book.aiError && (
                  <div className="text-text-tertiary mt-0.5 line-clamp-3">{book.aiError}</div>
                )}
                <div className="text-text-tertiary mt-1">
                  可点击右下的「让 AI 分析」按钮重试，或手动编辑元数据。
                </div>
              </div>
            </div>
          )}

          {/* Cover */}
          <div className="flex gap-4">
            <div className="w-[112px] h-[168px] shrink-0">
              <BookCover book={book} />
            </div>
            <div className="flex-1 flex flex-col gap-2 justify-start">
              <button
                type="button"
                onClick={handleChangeCover}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:border-accent/30 hover:text-text transition-colors cursor-pointer self-start"
              >
                <ImagePlus size={12} />
                换封面
              </button>
              <div className="text-[11px] text-text-tertiary leading-relaxed">
                <div>
                  {book.fileFormat.toUpperCase()} · {formatBytes(book.fileSize)}
                </div>
                {book.pageCount != null && <div>{book.pageCount} 页</div>}
                <div>加入 {formatDate(book.addedAt)}</div>
                {book.lastOpenedAt && <div>上次打开 {formatDate(book.lastOpenedAt)}</div>}
              </div>
            </div>
          </div>

          {/* Title / Author */}
          <div className="space-y-2">
            <input
              value={titleField.value}
              onChange={(e) => titleField.onChange(e.target.value)}
              onBlur={titleField.onBlur}
              placeholder="标题"
              className="w-full bg-transparent text-text text-[17px] font-semibold leading-snug outline-none border-b border-transparent hover:border-border focus:border-accent transition-colors"
            />
            <input
              value={authorField.value}
              onChange={(e) => authorField.onChange(e.target.value)}
              onBlur={authorField.onBlur}
              placeholder="作者"
              className="w-full bg-transparent text-text-secondary text-[13px] outline-none border-b border-transparent hover:border-border focus:border-accent transition-colors"
            />
            <div className="flex gap-2">
              <input
                value={publisherField.value}
                onChange={(e) => publisherField.onChange(e.target.value)}
                onBlur={publisherField.onBlur}
                placeholder="出版社"
                className="flex-1 bg-transparent text-text-tertiary text-[12px] outline-none border-b border-transparent hover:border-border focus:border-accent transition-colors"
              />
              <input
                value={yearField.value}
                onChange={(e) => yearField.onChange(e.target.value.replace(/[^0-9]/g, ""))}
                onBlur={yearField.onBlur}
                placeholder="年份"
                maxLength={4}
                className="w-16 bg-transparent text-text-tertiary text-[12px] outline-none border-b border-transparent hover:border-border focus:border-accent transition-colors"
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <div className="text-[11px] text-text-tertiary mb-2">状态</div>
            <SegmentedControl
              options={STATUS_OPTIONS}
              value={book.status}
              onChange={setStatus}
              className="flex"
            />
          </div>

          {/* Progress (only while reading) */}
          {book.status === "reading" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-text-tertiary">阅读进度</span>
                <span className="text-[12px] text-text font-medium">
                  {Math.round(book.progressPercent)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={book.progressPercent}
                onChange={(e) => setProgress(Number(e.target.value))}
                className="w-full accent-accent cursor-pointer"
              />
            </div>
          )}

          {/* Tags */}
          <div>
            <div className="text-[11px] text-text-tertiary mb-2">标签</div>
            <div className="flex flex-wrap gap-1.5 items-center">
              {book.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-light text-accent text-[11px]"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="hover:text-danger cursor-pointer"
                    aria-label="删除标签"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder="新标签 ↵"
                className="bg-transparent outline-none text-[11px] text-text-secondary w-24"
              />
            </div>
          </div>

          {/* Description (AI-generated from the book's own contents) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] text-text-tertiary">简介</div>
              {onAiAnalyze && (
                <button
                  type="button"
                  disabled={aiBusy}
                  onClick={async () => {
                    setAiBusy(true);
                    try {
                      await onAiAnalyze(book.id);
                      showToast("AI 已分析图书", "success");
                    } catch (e) {
                      showToast(`AI 分析失败：${e}`, "error");
                    } finally {
                      setAiBusy(false);
                    }
                  }}
                  className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  <Sparkles size={11} />
                  {aiBusy ? "分析中…" : "让 AI 分析"}
                </button>
              )}
            </div>
            {book.description ? (
              <p className="text-[12px] text-text-secondary leading-relaxed whitespace-pre-wrap">
                {book.description}
              </p>
            ) : (
              <p className="text-[12px] text-text-tertiary italic">
                暂无简介{onAiAnalyze && "，点击上方按钮让 AI 分析"}
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <div className="text-[11px] text-text-tertiary mb-2">个人笔记</div>
            <textarea
              value={notesField.value}
              onChange={(e) => notesField.onChange(e.target.value)}
              onBlur={notesField.onBlur}
              rows={5}
              placeholder="记录读后感、摘抄、要点…"
              className="w-full bg-bg px-3 py-2 rounded-lg border border-border text-[12px] text-text placeholder:text-text-tertiary outline-none focus:border-accent transition-colors resize-y"
            />
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border bg-bg-secondary">
          {onOpenExternally && (
            <button
              type="button"
              onClick={() => onOpenExternally(book.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-[12px] font-medium hover:bg-accent-hover transition-colors cursor-pointer"
            >
              <ExternalLink size={12} />
              在系统中打开
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleDelete}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${
              confirmingDelete ? "bg-danger text-white" : "text-danger hover:bg-danger-light"
            }`}
          >
            <Trash2 size={12} />
            {confirmingDelete ? "确认删除" : "删除"}
          </button>
        </div>
      </aside>
    </>
  );
}
