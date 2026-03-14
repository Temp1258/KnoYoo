import { useState } from "react";
import "./App.css";

import { ToastProvider } from "./components/common/Toast";
import TopBar from "./components/Layout/TopBar";
import Sidebar from "./components/Layout/Sidebar";
import HomePage from "./pages/HomePage";
import GrowthPage from "./pages/GrowthPage";
import MindMapPage from "./MindMapPage";
import NoteDetail from "./components/Note/NoteDetail";
import ChatDrawer from "./components/AI/ChatDrawer";
import { useNotes } from "./hooks/useNotes";
import type { Note } from "./types";

// Console bridge for debugging
declare global {
  interface Window {
    __TAURI__?: any;
    tauriInvoke?: (cmd: string, args?: any) => Promise<any>;
  }
}
import { invoke } from "@tauri-apps/api/core";
window.tauriInvoke = (cmd, args) => invoke(cmd, args);

type View = "plan" | "note" | "mindmap" | "me";

export default function App() {
  const [view, setView] = useState<View>("plan");
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);

  const notes = useNotes();
  const selectedNote: Note | null =
    selectedNoteId != null ? notes.list.find((n) => n.id === selectedNoteId) || null : null;

  function handleSelectNote(n: Note) {
    setSelectedNoteId(n.id);
    setView("note");
  }

  function handleViewChange(v: View) {
    setView(v);
    setSelectedNoteId(null);
  }

  function handleBackToPlan() {
    setView("plan");
    setSelectedNoteId(null);
  }

  // Build AI chat context based on current view
  let chatContext: string | undefined;
  let chatContextLabel: string | undefined;
  if (view === "note" && selectedNote) {
    chatContext = `笔记标题：${selectedNote.title}\n笔记内容：${selectedNote.content}`;
    chatContextLabel = `笔记：${selectedNote.title}`;
  }

  return (
    <ToastProvider>
      <div className="app-wrapper">
        <TopBar view={view === "note" ? "plan" : view} onViewChange={handleViewChange} />
        <div className="main-layout">
          <Sidebar
            list={notes.list}
            page={notes.page}
            totalPages={notes.totalPages}
            setPage={notes.setPage}
            q={notes.q}
            setQ={notes.setQ}
            onSearch={notes.onSearch}
            refresh={notes.refresh}
            onExport={notes.onExport}
            onImport={notes.onImport}
            selectedNoteId={selectedNoteId}
            onSelectNote={handleSelectNote}
          />
          <div className="content-area">
            {view === "mindmap" && <MindMapPage />}
            {view === "me" && <GrowthPage />}
            {view === "note" && selectedNote && (
              <NoteDetail note={selectedNote} onBack={handleBackToPlan} onChanged={notes.refresh} />
            )}
            {view === "plan" && selectedNoteId == null && (
              <HomePage results={notes.results} onSelectNote={handleSelectNote} />
            )}
          </div>
        </div>
        <ChatDrawer context={chatContext} contextLabel={chatContextLabel} />
      </div>
    </ToastProvider>
  );
}
