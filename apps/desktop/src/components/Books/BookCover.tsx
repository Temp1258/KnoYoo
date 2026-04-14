import { useEffect, useState } from "react";
import type { Book } from "../../hooks/useBooks";
import { readBookCoverUrl } from "../../hooks/useBooks";

/**
 * Deterministic hue from a string so the same title always renders the same gradient.
 */
function hashStringToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % 360;
}

function GeneratedCover({ title, author }: { title: string; author: string }) {
  const hue = hashStringToHue(title || author || "book");
  const hue2 = (hue + 40) % 360;
  return (
    <div
      className="relative w-full h-full rounded-lg overflow-hidden flex flex-col justify-between p-4 text-white"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 52%, 44%), hsl(${hue2}, 48%, 28%))`,
      }}
    >
      <div className="text-[13px] font-semibold leading-snug line-clamp-5 [text-shadow:_0_1px_2px_rgb(0_0_0_/_25%)]">
        {title || "未命名"}
      </div>
      <div className="text-[11px] opacity-80 line-clamp-1">{author || "未知作者"}</div>
      {/* Subtle inner border to mimic a printed spine */}
      <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-white/15 ring-inset" />
    </div>
  );
}

export default function BookCover({ book }: { book: Book }) {
  // Track which coverPath the loaded URL belongs to, so we never flash a stale
  // cover when the book (or its path) changes.
  const [state, setState] = useState<{ url: string; forPath: string; failed: boolean }>({
    url: "",
    forPath: "",
    failed: false,
  });

  useEffect(() => {
    if (!book.coverPath) return;
    let cancelled = false;
    readBookCoverUrl(book.coverPath)
      .then((u) => {
        if (!cancelled) setState({ url: u, forPath: book.coverPath, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: "", forPath: book.coverPath, failed: true });
      });
    return () => {
      cancelled = true;
    };
    // `book.updatedAt` is listed so that replacing a cover with an image of
    // the same format (cover_path string unchanged) still triggers a refetch;
    // the module-level cache is invalidated by setBookCover, so the refetch
    // gets a fresh data URL rather than a stale one.
  }, [book.coverPath, book.updatedAt]);

  const showUrl = state.forPath === book.coverPath ? state.url : "";
  const showFailed = state.forPath === book.coverPath && state.failed;

  if (!book.coverPath || showFailed) {
    return <GeneratedCover title={book.title} author={book.author} />;
  }

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden bg-bg-tertiary">
      {showUrl && (
        <img
          src={showUrl}
          alt={book.title}
          className="w-full h-full object-cover"
          onError={() => setState((prev) => ({ ...prev, forPath: book.coverPath, failed: true }))}
          draggable={false}
        />
      )}
      <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-black/5 ring-inset" />
    </div>
  );
}
