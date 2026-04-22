import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import SegmentedControl from "../components/ui/SegmentedControl";
import ClipsTrashPanel from "../components/Trash/ClipsTrashPanel";
import BooksTrashPanel from "../components/Trash/BooksTrashPanel";
import MediaTrashPanel from "../components/Trash/MediaTrashPanel";
import DocumentsTrashPanel from "../components/Trash/DocumentsTrashPanel";

type Tab = "clips" | "books" | "media" | "documents";

export default function TrashPage() {
  const [tab, setTab] = useState<Tab>("clips");
  const [clipCount, setClipCount] = useState<number | null>(null);
  const [bookCount, setBookCount] = useState<number | null>(null);
  const [mediaCount, setMediaCount] = useState<number | null>(null);
  const [documentCount, setDocumentCount] = useState<number | null>(null);

  // Pre-fetch counts to decorate tab labels. Cheap queries, so we always do it.
  useEffect(() => {
    invoke<number>("count_trash")
      .then(setClipCount)
      .catch(() => {});
    invoke<number>("count_books_trash")
      .then(setBookCount)
      .catch(() => {});
    invoke<number>("count_media_trash")
      .then(setMediaCount)
      .catch(() => {});
    invoke<number>("count_document_trash")
      .then(setDocumentCount)
      .catch(() => {});
  }, []);

  const tabs = [
    { value: "clips" as Tab, label: `剪藏${clipCount != null ? ` · ${clipCount}` : ""}` },
    { value: "books" as Tab, label: `书籍${bookCount != null ? ` · ${bookCount}` : ""}` },
    { value: "media" as Tab, label: `影音${mediaCount != null ? ` · ${mediaCount}` : ""}` },
    {
      value: "documents" as Tab,
      label: `文档${documentCount != null ? ` · ${documentCount}` : ""}`,
    },
  ];

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-[28px] font-bold tracking-tight m-0">乐色</h1>
      </div>

      <SegmentedControl options={tabs} value={tab} onChange={setTab} className="mb-6" />

      {tab === "clips" && <ClipsTrashPanel onCountChange={setClipCount} />}
      {tab === "books" && <BooksTrashPanel onCountChange={setBookCount} />}
      {tab === "media" && <MediaTrashPanel onCountChange={setMediaCount} />}
      {tab === "documents" && <DocumentsTrashPanel onCountChange={setDocumentCount} />}
    </div>
  );
}
