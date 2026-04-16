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
