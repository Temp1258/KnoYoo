import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import SegmentedControl from "../components/ui/SegmentedControl";
import ClipsTrashPanel from "../components/Trash/ClipsTrashPanel";
import BooksTrashPanel from "../components/Trash/BooksTrashPanel";

type Tab = "clips" | "books";

export default function TrashPage() {
  const [tab, setTab] = useState<Tab>("clips");
  const [clipCount, setClipCount] = useState<number | null>(null);
  const [bookCount, setBookCount] = useState<number | null>(null);

  // Pre-fetch counts to decorate tab labels. Cheap queries, so we always do it.
  useEffect(() => {
    invoke<number>("count_trash")
      .then(setClipCount)
      .catch(() => {});
    invoke<number>("count_books_trash")
      .then(setBookCount)
      .catch(() => {});
  }, []);

  const tabs = [
    { value: "clips" as Tab, label: `剪藏${clipCount != null ? ` · ${clipCount}` : ""}` },
    { value: "books" as Tab, label: `图书${bookCount != null ? ` · ${bookCount}` : ""}` },
  ];

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-[28px] font-bold tracking-tight m-0">回收站</h1>
      </div>

      <SegmentedControl options={tabs} value={tab} onChange={setTab} className="mb-6" />

      {tab === "clips" && <ClipsTrashPanel onCountChange={setClipCount} />}
      {tab === "books" && <BooksTrashPanel onCountChange={setBookCount} />}
    </div>
  );
}
