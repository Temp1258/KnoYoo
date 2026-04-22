import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { FileText, Upload, Library } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { Document, WebClip } from "../types";
import ClipCard from "../components/Clips/ClipCard";
import ClipDetail from "../components/Clips/ClipDetail";
import { SkeletonCard } from "../components/ui/Skeleton";
import { useToast } from "../components/common/toast-context";
import { useMediaQuery } from "../hooks/useMediaQuery";

/**
 * DocumentsPage — user-uploaded local text files (pdf / docx / md / txt).
 *
 * Structurally mirrors MediaPage: drag-drop dropzone, 两栏 split-view
 * detail on wide windows, full-page detail on narrow. Documents are
 * rendered through the shared ClipCard / ClipDetail components via a
 * WebClip-shape adapter so all 900 lines of markdown rendering, TOC,
 * notes, AI retag, etc. are reused. The `kind="document"` prop on
 * ClipDetail routes every mutation to the documents backend commands.
 */

const DOCUMENT_EXTS = ["pdf", "docx", "md", "txt"];

function hasExt(path: string, exts: string[]): boolean {
  const lower = path.toLowerCase();
  return exts.some((ext) => lower.endsWith(`.${ext}`));
}

/**
 * Adapt a `documents` row to the WebClip shape ClipCard/ClipDetail expect.
 *
 * - `url`: synthesized `document-local://<hash>` so `isSafeUrl` hides the
 *   external-link button (we don't open internal files in a browser).
 * - `source_type`: the `file_format` — ClipCard's icon switch falls
 *   through to the default `FileText` glyph, which is apt for every
 *   value here.
 * - `notes`: carried across as an extra field (not in WebClip); read
 *   inline by ClipDetail when `kind="document"`.
 */
function asClipShape(d: Document): WebClip & { notes: string } {
  return {
    id: d.id,
    url: `document-local://${d.file_hash || d.id}`,
    title: d.title,
    content: d.content,
    raw_content: d.raw_content,
    summary: d.summary,
    tags: d.tags,
    source_type: d.file_format,
    favicon: "",
    og_image: "",
    is_read: d.is_read,
    is_starred: d.is_starred,
    created_at: d.added_at,
    updated_at: d.updated_at,
    deleted_at: d.deleted_at,
    notes: d.notes,
    // Transcription / translation fields don't apply to documents —
    // leaving them undefined matches WebClip's optional-field contract.
  };
}

function DocumentDropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-bg/80 backdrop-blur-sm animate-fade-in pointer-events-none"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-4 px-16 py-14 rounded-2xl border-2 border-dashed border-accent bg-bg-secondary/90 shadow-lg">
        <div className="w-16 h-16 rounded-2xl bg-accent-light flex items-center justify-center">
          <FileText size={32} className="text-accent" strokeWidth={1.6} />
        </div>
        <div className="text-[16px] font-semibold text-text">松开以导入到文档</div>
        <div className="text-[12px] text-text-tertiary">支持 pdf / docx / md / txt</div>
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Document | null>(null);
  const uploadingRef = useRef(false);
  const { showToast } = useToast();
  const isWide = useMediaQuery("(min-width: 1024px)");

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const list = await tauriInvoke<Document[]>("list_documents", {
        filter: { limit: 200 },
      });
      setDocs(list);
    } catch (e) {
      console.error("load documents failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // Deep-link: `?openDocument=<id>` from main search / QuickSearch land
  // straight in the right detail pane.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const idRaw = searchParams.get("openDocument");
    if (!idRaw) return;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) return;
    let stale = false;
    tauriInvoke<Document>("get_document", { id })
      .then((d) => {
        if (!stale) setSelected(d);
      })
      .catch(console.error)
      .finally(() => {
        if (!stale) {
          const next = new URLSearchParams(searchParams);
          next.delete("openDocument");
          setSearchParams(next, { replace: true });
        }
      });
    return () => {
      stale = true;
    };
  }, [searchParams, setSearchParams]);

  const importFile = useCallback(
    async (filePath: string) => {
      // macOS Photos library paths occasionally surface as `.docx` /
      // `.md` / `.txt` during Continuity Camera / Quick Note export,
      // and should nudge the user to export-first. Same guard the media
      // dropzone uses.
      if (filePath.toLowerCase().includes(".photoslibrary/")) {
        showToast("『照片』App 的文件不能直接拖入。请先从 App 里导出再拖进来。", "error");
        return;
      }
      if (!hasExt(filePath, DOCUMENT_EXTS)) {
        const name = filePath.split(/[\\/]/).pop() || filePath;
        showToast(`不支持的文件格式：${name}`, "error");
        return;
      }
      try {
        const id = await tauriInvoke<number>("import_document", { filePath });
        const d = await tauriInvoke<Document>("get_document", { id });
        setSelected(d);
        loadDocs();
      } catch (e) {
        showToast(`导入失败：${String(e)}`, "error");
      }
    },
    [showToast, loadDocs],
  );

  const importMultiple = useCallback(
    async (paths: string[]) => {
      if (uploadingRef.current) return;
      uploadingRef.current = true;
      setImporting(true);
      try {
        for (const p of paths) {
          await importFile(p);
        }
      } finally {
        uploadingRef.current = false;
        setImporting(false);
      }
    },
    [importFile],
  );

  // Tauri drag-drop scoped to this page. Unmount on navigation hands the
  // overlay back to whichever page claims it next.
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
          void importMultiple(payload.paths);
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
  }, [importMultiple]);

  const pickDocument = async () => {
    const selectedPaths = await openFileDialog({
      multiple: true,
      filters: [{ name: "文档文件", extensions: DOCUMENT_EXTS }],
    });
    if (!selectedPaths) return;
    const paths = Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths];
    await importMultiple(paths);
  };

  const handleStar = async (id: number) => {
    await tauriInvoke("toggle_star_document", { id });
    loadDocs();
    if (selected?.id === id) {
      setSelected((prev) => (prev ? { ...prev, is_starred: !prev.is_starred } : null));
    }
  };

  const handleDelete = async (id: number) => {
    await tauriInvoke("delete_document", { id });
    if (selected?.id === id) setSelected(null);
    loadDocs();
  };

  const handleRetag = async (id: number) => {
    await tauriInvoke("ai_auto_tag_document", { id }).catch(console.error);
    loadDocs();
  };

  // Merge ClipDetail's edits back into the Document state. The WebClip
  // shape ClipDetail produces is a superset; we pick only the fields
  // that actually belong to documents.
  const onDetailUpdate = useCallback(
    (updated: WebClip) => {
      setSelected((prev) => {
        if (!prev || prev.id !== updated.id) return prev;
        return {
          ...prev,
          title: updated.title,
          content: updated.content,
          raw_content: updated.raw_content,
          summary: updated.summary,
          tags: updated.tags,
          is_read: updated.is_read,
          is_starred: updated.is_starred,
          updated_at: updated.updated_at,
        };
      });
      loadDocs();
    },
    [loadDocs],
  );

  const selectedClipShape = selected ? asClipShape(selected) : null;

  if (selectedClipShape && !isWide) {
    return (
      <ClipDetail
        key={selectedClipShape.id}
        clip={selectedClipShape}
        kind="document"
        onBack={() => setSelected(null)}
        onStar={handleStar}
        onUpdate={onDetailUpdate}
      />
    );
  }

  const splitView = isWide && selectedClipShape;

  // Group by format for the list view — user mental model is "pdf pile /
  // docx pile / notes pile" rather than one chronological flat list.
  const byFormat = {
    pdf: docs.filter((d) => d.file_format === "pdf"),
    docx: docs.filter((d) => d.file_format === "docx"),
    md: docs.filter((d) => d.file_format === "md"),
    txt: docs.filter((d) => d.file_format === "txt"),
  };

  const sections: { key: keyof typeof byFormat; label: string }[] = [
    { key: "pdf", label: "PDF" },
    { key: "docx", label: "Word" },
    { key: "md", label: "Markdown" },
    { key: "txt", label: "纯文本" },
  ];

  return (
    <div className={splitView ? "flex gap-0 -mx-6 -my-6 h-[calc(100vh)]" : "relative"}>
      <DocumentDropOverlay visible={dragging} />
      {splitView && selectedClipShape && (
        <div className="w-3/5 order-2 overflow-y-auto px-6 py-6 border-l border-border">
          <ClipDetail
            key={selectedClipShape.id}
            clip={selectedClipShape}
            kind="document"
            onBack={() => setSelected(null)}
            onStar={handleStar}
            onUpdate={onDetailUpdate}
            compact
          />
        </div>
      )}

      <div className={splitView ? "w-2/5 order-1 overflow-y-auto px-4 py-4" : ""}>
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight m-0">文档</h1>
            <p className="text-[13px] text-text-tertiary mt-1 m-0">
              本地 pdf / docx / md / txt · AI 自动摘要与标签
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={pickDocument}
              disabled={importing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-50"
            >
              <FileText size={13} />
              导入文档
            </button>
          </div>
        </div>

        {/* Empty state */}
        {!loading && docs.length === 0 && !dragging && (
          <div className="py-16 text-center rounded-xl border-2 border-dashed border-border">
            <Upload
              size={36}
              strokeWidth={1.5}
              className="mx-auto mb-3 text-text-tertiary opacity-50"
            />
            <p className="text-[14px] text-text-secondary m-0">拖入文档文件，或用右上角按钮选择</p>
            <p className="text-[11px] text-text-tertiary mt-2 m-0">
              支持 {DOCUMENT_EXTS.join(" · ")}
            </p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Sections by file_format */}
        {!loading &&
          sections.map(({ key, label }) => {
            const items = byFormat[key];
            if (items.length === 0) return null;
            return (
              <section key={key} className="mb-8 last:mb-0">
                <div className="flex items-center gap-2 mb-3">
                  <Library size={15} className="text-accent" />
                  <h2 className="text-[15px] font-semibold m-0">{label}</h2>
                  <span className="text-[11px] text-text-tertiary">· {items.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {items.map((d) => (
                    <ClipCard
                      key={d.id}
                      clip={asClipShape(d)}
                      onStar={handleStar}
                      onDelete={handleDelete}
                      onSelect={() => setSelected(d)}
                      onRetag={handleRetag}
                      isSelected={selected?.id === d.id}
                    />
                  ))}
                </div>
              </section>
            );
          })}
      </div>
    </div>
  );
}
