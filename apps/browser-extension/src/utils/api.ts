/**
 * Communication with KnoYoo desktop app's local HTTP server.
 */

const BASE_URL = "http://localhost:19836";

export interface ClipPayload {
  url: string;
  title: string;
  content: string;
  /** Full document.body.innerText — serves as the "原始" view on the
   *  desktop side AND as the fallback when AI cleaning goes wrong or the
   *  cleaner-selectors picked only a title. */
  raw_content?: string;
  source_type?: string;
  favicon?: string;
}

export interface ClipResponse {
  id: number;
  url: string;
  title: string;
}

export async function getToken(): Promise<string> {
  const result = await chrome.storage.local.get("knoyoo_token");
  return result.knoyoo_token || "";
}

export async function setToken(token: string): Promise<void> {
  await chrome.storage.local.set({ knoyoo_token: token });
}

/** Check if desktop app is running (unauthenticated — service up, nothing more). */
export async function ping(): Promise<boolean> {
  try {
    const resp = await fetch(`${BASE_URL}/api/ping`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Verify the stored token is accepted by the desktop. Used so the popup can
 * distinguish "offline" from "connected but token mismatch" — without this
 * an out-of-sync token silently quotes clips into the offline queue forever.
 */
export async function authCheck(): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  try {
    const resp = await fetch(`${BASE_URL}/api/auth-check`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Force a fresh token handshake: clear local token, then run autoHandshake. */
export async function reHandshake(): Promise<boolean> {
  await setToken("");
  return autoHandshake();
}

/**
 * Auto-handshake: attempt to get a token from the desktop app automatically.
 * Returns true if handshake succeeded and token was saved.
 */
export async function autoHandshake(): Promise<boolean> {
  try {
    const existing = await getToken();
    if (existing) return true; // already configured

    const isOnline = await ping();
    if (!isOnline) return false;

    const resp = await fetch(`${BASE_URL}/api/handshake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce: Date.now().toString() }),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) return false;

    const data = await resp.json();
    if (data.token) {
      await setToken(data.token);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Send a URL for server-side fetching and extraction. */
export async function sendClipUrl(
  url: string,
  sourceHint: string = "article"
): Promise<ClipResponse> {
  const token = await getToken();
  const resp = await fetch(`${BASE_URL}/api/clip-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url, source_hint: sourceHint }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${resp.status}`);
  }

  return resp.json();
}

/** Send a clip to the desktop app. */
export async function sendClip(clip: ClipPayload): Promise<ClipResponse> {
  const token = await getToken();
  const resp = await fetch(`${BASE_URL}/api/clip`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(clip),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${resp.status}`);
  }

  return resp.json();
}
