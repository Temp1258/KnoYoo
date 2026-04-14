import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Book } from "../../hooks/useBooks";
import BookTile from "./BookTile";

interface Props {
  title: string;
  books: Book[];
  emphasize?: boolean; // 正在读书架用加大卡片
  defaultCollapsed?: boolean;
  onBookClick?: (book: Book) => void;
  onBookDoubleClick?: (book: Book) => void;
}

export default function BookShelf({
  title,
  books,
  emphasize,
  defaultCollapsed,
  onBookClick,
  onBookDoubleClick,
}: Props) {
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);

  if (books.length === 0) return null;

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 text-text hover:text-accent transition-colors cursor-pointer"
        aria-expanded={!collapsed}
      >
        <ChevronDown
          size={16}
          className={`transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-[12px] text-text-tertiary">· {books.length}</span>
      </button>

      {!collapsed && (
        <div className="flex flex-wrap gap-x-5 gap-y-6 pl-6">
          {books.map((b) => (
            <BookTile
              key={b.id}
              book={b}
              size={emphasize ? "lg" : "sm"}
              showProgress={emphasize}
              onClick={() => onBookClick?.(b)}
              onDoubleClick={() => onBookDoubleClick?.(b)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
