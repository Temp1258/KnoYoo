import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TranscribeProgress } from "../types";

/** Wire event name — must match Rust's `transcribe::PROGRESS_EVENT`. */
const PROGRESS_EVENT = "transcribe://progress";

/**
 * Subscribe to `transcribe://progress` events filtered by `clip_id`.
 *
 * Returns the latest progress sample, or `null` until the first event lands.
 * Safe to mount on a clip that's already `completed` — no event ever fires
 * and `latest` stays `null`, so consumers should treat "null + completed
 * DB status" as "finished before I mounted".
 */
export function useTranscribeProgress(
  clipId: number | null | undefined,
): TranscribeProgress | null {
  const [latest, setLatest] = useState<TranscribeProgress | null>(null);
  // Keep the active unlisten in a ref so the React 18 strict-mode double
  // effect run tears down the listener from the discarded mount cleanly.
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    if (clipId == null) return undefined;
    // Reset between clips so the old clip's final sample isn't shown
    // while the new clip's first event is pending. Queuing via rAF avoids
    // the synchronous-setState-in-effect cascade ESLint warns about.
    const rafId = requestAnimationFrame(() => setLatest(null));

    let cancelled = false;
    listen<TranscribeProgress>(PROGRESS_EVENT, (ev) => {
      if (cancelled) return;
      if (ev.payload?.clip_id !== clipId) return;
      setLatest(ev.payload);
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenRef.current = unlisten;
      })
      .catch((err) => {
        // Listener registration failure is non-fatal — the clip's DB state
        // transitions are still authoritative; we just won't see live
        // updates. Log for devtools visibility.
        console.warn("[transcribe] listen failed:", err);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [clipId]);

  return latest;
}
