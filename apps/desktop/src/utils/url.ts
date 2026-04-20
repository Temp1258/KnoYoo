/**
 * Return true iff the URL is safe to render as an `<a href>` target.
 *
 * The Rust backend's `is_http_url` already rejects non-http(s) schemes at
 * INSERT time, so in practice every `clip.url` reaching the UI is already
 * clean. This helper is defense-in-depth: a compromised DB import, a
 * future bypass, or a bug that skips the insert validation shouldn't
 * translate into a `javascript:` / `data:` / `file:` URL becoming a
 * one-click XSS vector.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Human-facing "domain" label for a clip URL. Keeps synthetic schemes
 * (audio-local://, local-video://, file://) from leaking raw sha256 hashes
 * into the UI, and strips `www.` from real hostnames.
 *
 * Shared by ClipCard + ClipDetail so the mapping stays in one place —
 * previously the two components had copy-pasted logic that drifted
 * (ClipDetail still showed the full hash because it had not been updated).
 */
export function formatClipDomain(url: string): string {
  if (url.startsWith("audio-local://")) return "本地音频";
  if (url.startsWith("local-video://")) return "本地视频";
  if (url.startsWith("file://")) return "本地文件";
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}
