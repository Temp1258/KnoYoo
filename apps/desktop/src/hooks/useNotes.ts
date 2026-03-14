import { useState, useEffect, useCallback } from "react";
import { tauriInvoke } from "./useTauriInvoke";
import type { Note, Hit } from "../types";

const PAGE_SIZE = 10;

export function useNotes() {
  const [list, setList] = useState<Note[]>([]);
  const [page, setPage] = useState(1);
  const [totalNotes, setTotalNotes] = useState(0);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Hit[]>([]);

  const totalPages = Math.max(1, Math.ceil(totalNotes / PAGE_SIZE));

  const refresh = useCallback(async () => {
    const rows = await tauriInvoke<Note[]>("list_notes", { page, pageSize: PAGE_SIZE });
    setList(rows);
    const n = await tauriInvoke<number>("count_notes");
    const total = n || 0;
    setTotalNotes(total);
    const tp = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > tp) setPage(tp);
  }, [page]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onSearch = useCallback(async () => {
    const q2 = q.trim();
    if (!q2) {
      setResults([]);
      return;
    }
    try {
      const rows = await tauriInvoke<Hit[]>("search_notes", { query: q2 });
      setResults(rows);
    } catch (e) {
      console.error(e);
    }
  }, [q]);

  const onExport = useCallback(async () => {
    const res = await tauriInvoke<{ path: string; count: number }>("export_notes_jsonl");
    return res;
  }, []);

  const onImport = useCallback(async () => {
    const res = await tauriInvoke<[number, number]>("import_notes_jsonl");
    await refresh();
    return res;
  }, [refresh]);

  return {
    list,
    page,
    setPage,
    totalPages,
    totalNotes,
    q,
    setQ,
    results,
    setResults,
    onSearch,
    refresh,
    onExport,
    onImport,
  };
}
