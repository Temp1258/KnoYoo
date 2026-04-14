import { useEffect, useRef } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import type { Book } from "../../hooks/useBooks";
import BookCover from "./BookCover";

interface Props {
  book: Book;
  size?: "sm" | "lg";
  showProgress?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

// Delay single-click so double-click can cancel it. Slightly above the
// system default dblclick interval gives comfortable slack.
const DBL_CLICK_THRESHOLD_MS = 220;

export default function BookTile({
  book,
  size = "sm",
  showProgress,
  onClick,
  onDoubleClick,
}: Props) {
  const coverWidth = size === "lg" ? "w-[164px]" : "w-[132px]";
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  const handleClick = () => {
    if (!onClick) return;
    // If there's no dblclick handler, fire immediately — no need to wait.
    if (!onDoubleClick) {
      onClick();
      return;
    }
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      onClick();
    }, DBL_CLICK_THRESHOLD_MS);
  };

  const handleDoubleClick = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    onDoubleClick?.();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`group flex flex-col gap-2 ${coverWidth} text-left cursor-pointer select-none focus:outline-none`}
      title={book.title}
    >
      <div
        className="book-tile-cover relative aspect-[2/3] w-full rounded-lg transition-all duration-200
                   group-focus-visible:ring-2 group-focus-visible:ring-accent"
      >
        <BookCover book={book} />
        {showProgress && book.status === "reading" && book.progressPercent > 0 && (
          <div className="absolute left-2 right-2 bottom-2 h-[3px] rounded-full bg-black/30 overflow-hidden">
            <div
              className="h-full bg-white/90 rounded-full"
              style={{ width: `${Math.min(100, book.progressPercent)}%` }}
            />
          </div>
        )}

        {/* AI status overlay: pending = pulsing sparkles, failed = warning.
            Since add_book now seeds title from filename, tiles with a
            failed analysis still look "normal" without this visual hint.
            Positioned top-right so it doesn't fight the progress bar. */}
        {book.aiStatus === "pending" && (
          <div
            className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/50 backdrop-blur-sm text-white text-[10px]"
            title="AI 正在阅读这本书的正文以生成简介和标签"
          >
            <Sparkles size={10} className="animate-pulse" />
            分析中
          </div>
        )}
        {book.aiStatus === "failed" && (
          <div
            className="absolute top-2 right-2 flex items-center justify-center w-6 h-6 rounded-full bg-danger/90 text-white shadow-sm"
            title={`AI 分析失败${book.aiError ? "：" + book.aiError : "。点击打开可手动重试。"}`}
          >
            <AlertTriangle size={12} />
          </div>
        )}
      </div>

      <div className="px-0.5">
        <div className="text-[13px] font-medium text-text leading-tight line-clamp-1">
          {book.title || "未命名"}
        </div>
        {book.author && (
          <div className="text-[11px] text-text-tertiary leading-tight line-clamp-1 mt-0.5">
            {book.author}
          </div>
        )}
      </div>
    </button>
  );
}
