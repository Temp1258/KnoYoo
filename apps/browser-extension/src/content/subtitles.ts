/**
 * Subtitle extraction for YouTube and Bilibili videos.
 * Runs in content script context (has full DOM + fetch access).
 */

// ── YouTube ─────────────────────────────────────────────────────────────

export async function extractYouTubeSubtitles(): Promise<string | null> {
  try {
    const playerResponse = getYtInitialPlayerResponse();
    if (!playerResponse) return null;

    const tracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;

    // Pick best track: prefer Chinese/English, fallback to first
    const track =
      tracks.find((t: any) => /zh|cn/i.test(t.languageCode)) ||
      tracks.find((t: any) => /en/i.test(t.languageCode)) ||
      tracks[0];

    const url = track.baseUrl;
    if (!url) return null;

    const resp = await fetch(url);
    const xml = await resp.text();

    return parseYouTubeSubtitleXml(xml);
  } catch (e) {
    console.warn("[KnoYoo] YouTube subtitle extraction failed:", e);
    return null;
  }
}

function getYtInitialPlayerResponse(): any {
  // Method 1: try window.ytInitialPlayerResponse via script injection
  // Content scripts can't access page JS vars directly,
  // so we look for the JSON in <script> tags
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent || "";
    const marker = "var ytInitialPlayerResponse = ";
    const idx = text.indexOf(marker);
    if (idx === -1) continue;

    const start = idx + marker.length;
    // Find the end of the JSON object by matching braces
    let depth = 0;
    let end = start;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }

    try {
      return JSON.parse(text.slice(start, end));
    } catch {
      continue;
    }
  }

  // Method 2: look for ytInitialPlayerResponse in ytInitialData script
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent || "";
    if (!text.includes("captionTracks")) continue;

    // Try to extract JSON containing captionTracks
    const match = text.match(
      /ytInitialPlayerResponse\s*=\s*(\{.+?\});/s
    );
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        continue;
      }
    }
  }

  return null;
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
