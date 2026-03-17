import { Outlet, useNavigate } from "react-router";
import NavSidebar from "./NavSidebar";
import NoteSidebar from "./NoteSidebar";
import ChatDrawer from "../AI/ChatDrawer";
import OllamaBanner from "../AI/OllamaBanner";
import { useNotes } from "../../hooks/useNotes";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { useState, useEffect } from "react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { Note } from "../../types";

export default function AppShell() {
  const notes = useNotes();
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const navigate = useNavigate();

  // First-launch detection: redirect to onboarding if needed
  useEffect(() => {
    tauriInvoke<boolean>("check_needs_onboarding").then((needs) => {
      if (needs) navigate("/onboarding", { replace: true });
    }).catch(console.error);
    // Record daily activity on app open
    tauriInvoke("record_activity").catch(console.error);
  }, [navigate]);

  const selectedNote: Note | null =
    selectedNoteId != null ? notes.list.find((n) => n.id === selectedNoteId) || null : null;

  function handleSelectNote(n: Note) {
    setSelectedNoteId(n.id);
  }

  function handleBack() {
    setSelectedNoteId(null);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Navigation Sidebar */}
      <NavSidebar />

      {/* Note List Sidebar */}
      <NoteSidebar
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

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <OllamaBanner />
          <ErrorBoundary>
            <Outlet
              context={{
                notes,
                selectedNote,
                selectedNoteId,
                onSelectNote: handleSelectNote,
                onBack: handleBack,
              }}
            />
          </ErrorBoundary>
        </div>
      </main>

      {/* AI Chat Drawer */}
      <ChatDrawer selectedNoteId={selectedNoteId} />
    </div>
  );
}
