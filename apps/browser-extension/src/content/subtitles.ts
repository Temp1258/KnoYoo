/**
 * Subtitle extraction for YouTube and Bilibili videos.
 * Runs in content script context (has full DOM + fetch access).
 */

// ── YouTube ─────────────────────────────────────────────────────────────

export async function extractYouTubeSubtitles(): Promise<string | null> {
  try {
    const playerResponse = await getYtInitialPlayerResponse();
    if (!playerResponse) {
      console.warn("[KnoYoo] ytInitialPlayerResponse not found");
      return null;
    }

    const tracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      console.warn("[KnoYoo] no captionTracks on this video");
      return null;
    }

    // Track priority: user-provided Chinese → user-provided English → auto en
    // → any user-provided → first. (asr = auto speech recognition.)
    const nonAsr = tracks.filter((t: any) => t.kind !== "asr");
    const pick =
      nonAsr.find((t: any) => /zh|cn/i.test(t.languageCode)) ||
      nonAsr.find((t: any) => /en/i.test(t.languageCode)) ||
      tracks.find((t: any) => /en/i.test(t.languageCode)) ||
      nonAsr[0] ||
      tracks[0];
    if (!pick?.baseUrl) return null;

    // Request the timed-text endpoint as simple XML
    // (fmt=srv1 → legacy XML with <text>; reliably parseable)
    const url = pick.baseUrl.includes("fmt=")
      ? pick.baseUrl
      : `${pick.baseUrl}&fmt=srv1`;

    const resp = await fetch(url, { credentials: "include" });
    if (!resp.ok) {
      console.warn(`[KnoYoo] subtitle fetch failed: HTTP ${resp.status}`);
      return null;
    }
    const xml = await resp.text();
    const parsed = parseYouTubeSubtitleXml(xml);
    return parsed || null;
  } catch (e) {
    console.warn("[KnoYoo] YouTube subtitle extraction failed:", e);
    return null;
  }
}

/**
 * Find the end index of a JSON value that starts at `text[start]`. Unlike a
 * naive brace counter, this respects string literals (including escaped quotes)
 * so it won't stop early on `{` / `}` appearing inside caption URLs or video
 * titles. Returns -1 if the JSON can't be closed before end-of-string.
 */
function findJsonEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  let started = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
      started = true;
    } else if (ch === "}") {
      depth--;
      if (started && depth === 0) return i + 1;
    }
  }
  return -1;
}

async function getYtInitialPlayerResponse(): Promise<any> {
  // Method 1 (most reliable): inject a script into the page's main world so
  // we can read window.ytInitialPlayerResponse directly. Content scripts live
  // in an isolated world and can't see page globals otherwise.
  const viaPage = await readFromPageWorld();
  if (viaPage) return viaPage;

  // Method 2 (fallback): scrape the <script> tags that assign the variable.
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent || "";
    const idx = text.indexOf("ytInitialPlayerResponse");
    if (idx === -1) continue;

    // Find the opening brace after the first `=`.
    const eq = text.indexOf("=", idx);
    if (eq === -1) continue;
    let open = eq + 1;
    while (open < text.length && text[open] !== "{") open++;
    if (open >= text.length) continue;

    const end = findJsonEnd(text, open);
    if (end === -1) continue;

    try {
      return JSON.parse(text.slice(open, end));
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Inject a tiny bridge into the page's main world and read
 * window.ytInitialPlayerResponse. Content scripts can't read page globals
 * directly, but a <script> element we inject runs in the main world and can
 * relay data back via postMessage.
 */
function readFromPageWorld(): Promise<any> {
  return new Promise((resolve) => {
    const requestId = `knoyoo-yt-${Date.now()}-${Math.random()}`;
    let done = false;

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.type !== "KNOYOO_YT_RESPONSE" || data.id !== requestId)
        return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve(data.payload ?? null);
    }
    window.addEventListener("message", onMessage);

    const script = document.createElement("script");
    script.textContent = `
      (function() {
        try {
          var r = window.ytInitialPlayerResponse;
          window.postMessage({
            type: "KNOYOO_YT_RESPONSE",
            id: ${JSON.stringify(requestId)},
            payload: r || null
          }, "*");
        } catch (e) {
          window.postMessage({
            type: "KNOYOO_YT_RESPONSE",
            id: ${JSON.stringify(requestId)},
            payload: null
          }, "*");
        }
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();

    // Fail-safe timeout so we always resolve
    setTimeout(() => {
      if (done) return;
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, 1500);
  });
}

function parseYouTubeSubtitleXml(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const texts = doc.querySelectorAll("text");

  const lines: string[] = [];
  for (const el of texts) {
    const text = (el.textContent || "")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
    if (text) lines.push(text);
  }

  return lines.join("\n");
}

// ── Bilibili ────────────────────────────────────────────────────────────

export async function extractBilibiliSubtitles(): Promise<string | null> {
  try {
    const subtitleUrl = getBilibiliSubtitleUrl();
    if (!subtitleUrl) return null;

    const url = subtitleUrl.startsWith("//")
      ? "https:" + subtitleUrl
      : subtitleUrl;

    const resp = await fetch(url);
    const data = await resp.json();

    if (!data?.body || !Array.isArray(data.body)) return null;

    const lines = data.body
      .map((item: any) => item.content?.trim())
      .filter(Boolean);

    return lines.length > 0 ? lines.join("\n") : null;
  } catch (e) {
    console.warn("[KnoYoo] Bilibili subtitle extraction failed:", e);
    return null;
  }
}

function getBilibiliSubtitleUrl(): string | null {
  // Method 1: look in __INITIAL_STATE__
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent || "";

    // window.__INITIAL_STATE__={...}
    const marker = "window.__INITIAL_STATE__=";
    const idx = text.indexOf(marker);
    if (idx === -1) continue;

    const start = idx + marker.length;
    // Find the JSON end (before the next semicolon or statement)
    const semi = text.indexOf(";", start);
    const jsonStr = text.slice(start, semi > start ? semi : undefined);

    try {
      const state = JSON.parse(jsonStr);
      const subtitles = state?.videoData?.subtitle?.list;
      if (Array.isArray(subtitles) && subtitles.length > 0) {
        // Prefer Chinese subtitle
        const sub =
          subtitles.find((s: any) => /zh|cn/i.test(s.lan)) || subtitles[0];
        return sub.subtitle_url || null;
      }
    } catch {
      continue;
    }
  }

  return null;
}
