import { useCallback, useEffect, useState } from "react";
import { tauriInvoke } from "./useTauriInvoke";

export type BookStatus = "want" | "reading" | "read" | "dropped";
export type BookFormat = "epub" | "pdf";

export type BookAiStatus = "pending" | "ok" | "failed";

export interface Book {
  id: number;
  fileHash: string;
  title: string;
  author: string;
  publisher: string;
  publishedYear: number | null;
  description: string;
  coverPath: string;
  filePath: string;
  fileFormat: BookFormat;
  fileSize: number;
  pageCount: number | null;
  status: BookStatus;
  progressPercent: number;
  rating: number | null;
  notes: string;
  tags: string[];
  addedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastOpenedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
  /** Background AI metadata extraction state (used for the tile's UI). */
  aiStatus: BookAiStatus;
  /** Last error message from the AI extractor when aiStatus === "failed". */
  aiError: string;
}

// Rust side returns snake_case, serde's default; normalize to camelCase on read.
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
  file_format: BookFormat;
  file_size: number;
  page_count: number | null;
  status: BookStatus;
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
  ai_status: BookAiStatus;
  ai_error: string;
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

export interface BookPatch {
  title?: string;
  author?: string;
  publisher?: string;
  published_year?: number;
  description?: string;
  status?: BookStatus;
  progress_percent?: number;
  rating?: number;
  notes?: string;
  tags?: string[];
}

export function useBooks() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await tauriInvoke<RawBook[]>("list_books", {});
      setBooks(raw.map(normalize));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addBook = useCallback(async (filePath: string): Promise<Book> => {
    const raw = await tauriInvoke<RawBook>("add_book", { filePath });
    const book = normalize(raw);
    setBooks((prev) => [book, ...prev.filter((b) => b.id !== book.id)]);
    return book;
  }, []);

  const updateBook = useCallback(async (id: number, patch: BookPatch): Promise<Book> => {
    const raw = await tauriInvoke<RawBook>("update_book", { id, patch });
    const book = normalize(raw);
    setBooks((prev) => prev.map((b) => (b.id === id ? book : b)));
    return book;
  }, []);

  const deleteBook = useCallback(async (id: number) => {
    await tauriInvoke("delete_book", { id });
    setBooks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const setBookCover = useCallback(async (id: number, imagePath: string): Promise<Book> => {
    const raw = await tauriInvoke<RawBook>("set_book_cover", { id, imagePath });
    const book = normalize(raw);
    // A new cover image replaces any previously cached URL under the same hash
    // (e.g. jpg → jpg overwrite OR jpg → png new file). Clear both to be safe.
    invalidateCoverCacheForHash(book.fileHash);
    setBooks((prev) => prev.map((b) => (b.id === id ? book : b)));
    return book;
  }, []);

  const openExternally = useCallback(async (id: number): Promise<void> => {
    await tauriInvoke("open_book_externally", { id });
    // last_opened_at changed — refresh that row
    try {
      const raw = await tauriInvoke<RawBook>("get_book", { id });
      const book = normalize(raw);
      setBooks((prev) => prev.map((b) => (b.id === id ? book : b)));
    } catch {
      // non-fatal
    }
  }, []);

  // AI reads the book's actual content (first ~12K chars) and fills in
  // title / author / publisher / year / description / tags. Only empty fields
  // get filled — anything the user has edited is left alone.
  const aiAnalyze = useCallback(async (id: number): Promise<Book> => {
    const raw = await tauriInvoke<RawBook>("ai_extract_book_metadata", { id });
    const book = normalize(raw);
    setBooks((prev) => prev.map((b) => (b.id === id ? book : b)));
    return book;
  }, []);

  return {
    books,
    loading,
    error,
    refresh,
    addBook,
    updateBook,
    deleteBook,
    setBookCover,
    openExternally,
    aiAnalyze,
  };
}

/**
 * Read a cover image and return a data URL that can be assigned to <img src>.
 * The backend returns a base64-encoded data URL so we don't need Tauri's asset
 * protocol configured.
 *
 * Covers are immutable once written (cover_path encodes the book's content hash
 * + image extension), so we memoize results for the session. In-flight requests
 * are also deduplicated so a list of 100 identical-cover books triggers a single
 * IPC round trip.
 */
const coverUrlCache = new Map<string, string>();
const coverUrlPending = new Map<string, Promise<string>>();

export async function readBookCoverUrl(relative: string): Promise<string> {
  if (!relative) return "";
  const cached = coverUrlCache.get(relative);
  if (cached) return cached;
  const inflight = coverUrlPending.get(relative);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      const url = await tauriInvoke<string>("read_book_cover", { relative });
      coverUrlCache.set(relative, url);
      return url;
    } finally {
      coverUrlPending.delete(relative);
    }
  })();
  coverUrlPending.set(relative, p);
  return p;
}

/** Drop any cached cover URLs belonging to this book's content hash. */
function invalidateCoverCacheForHash(fileHash: string) {
  if (!fileHash) return;
  const prefix = `book_covers/${fileHash}.`;
  for (const key of coverUrlCache.keys()) {
    if (key.startsWith(prefix)) coverUrlCache.delete(key);
  }
}
