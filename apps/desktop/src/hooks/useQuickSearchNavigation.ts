import { useEffect } from "react";
import { useNavigate } from "react-router";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type OpenPayload = {
  kind: "clip" | "book" | "video" | "media";
  id: number;
};

/**
 * Main-window listener for quick-search selections. When the overlay emits
 * `quick-search://open` with a content reference, we route to the right page
 * (with the id stashed in URL search params for the page to pick up), then
 * surface the main window if it's hidden in the tray.
 *
 * URL-param handoff keeps the page → detail wiring stateless: ClipsPage /
 * BooksPage already have a `selected*` slot driven by props/state, so they
 * just need to watch `?openClip=` / `?openBook=` and fetch on first sight.
 */
export function useQuickSearchNavigation() {
  const navigate = useNavigate();

  useEffect(() => {
    const unlisten = listen<OpenPayload>("quick-search://open", async (ev) => {
      const { kind, id } = ev.payload;
      if (!id) return;
      try {
        if (kind === "book") {
          navigate(`/books?openBook=${id}`);
        } else if (kind === "media") {
          // Audio + local video now live in the Media page.
          navigate(`/media?openClip=${id}`);
        } else {
          // Web clip (article) + online video (YouTube/Bilibili) stay in Clips.
          navigate(`/clips?openClip=${id}`);
        }
        const win = getCurrentWindow();
        await win.show();
        await win.unminimize();
        await win.setFocus();
      } catch (e) {
        console.error("quick-search navigation failed:", e);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [navigate]);
}
