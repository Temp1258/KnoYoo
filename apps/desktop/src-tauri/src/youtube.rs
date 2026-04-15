//! YouTube-specific extraction.
//!
//! Standard article extraction doesn't work for `YouTube` — the watch page is a
//! JS-rendered SPA with very little meaningful text in the initial HTML. BUT
//! the initial HTML does embed a large JSON blob called `ytInitialPlayerResponse`
//! that contains everything we need: video title, description, channel, and
//! references to caption tracks.
//!
//! The caption tracks let us build a **full spoken transcript** of the video —
//! every line the speaker says ends up in the clip's `content` field. For
//! videos with publisher-provided subtitles (TED, lectures) this is a clean
//! transcript; for everything else we fall back to `YouTube`'s auto-generated
//! ASR captions, which still capture every spoken word.

use std::io::Read;
use std::time::Duration;

const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_HTML_BYTES: u64 = 10 * 1024 * 1024; // watch page can be large
// 80K chars keeps the content safely under web_clips' 500KB byte limit even
// for 3-byte-per-character languages, while still comfortably covering a
// 90-minute lecture transcript (≈13K words).
const MAX_TRANSCRIPT_CHARS: usize = 80_000;

pub struct YoutubeVideo {
    pub title: String,
    pub description: String,
    pub channel: String,
    pub thumbnail: String,
    pub transcript: String,
    pub transcript_source: &'static str, // "publisher" | "auto" | "none"
}

pub fn is_youtube_url(url: &str) -> bool {
    extract_video_id(url).is_some()
}

/// Extract the 11-character `YouTube` video ID from common URL shapes.
pub fn extract_video_id(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_lowercase();

    // youtube.com, www.youtube.com, m.youtube.com, music.youtube.com
    if host == "youtube.com"
        || host == "www.youtube.com"
        || host == "m.youtube.com"
        || host == "music.youtube.com"
    {
        // /watch?v=ID
        if let Some((_, v)) = parsed.query_pairs().find(|(k, _)| k == "v") {
            return clean_video_id(&v);
        }
        // /shorts/ID  or  /embed/ID  or  /v/ID  or  /live/ID
        let path = parsed.path();
        for prefix in ["/shorts/", "/embed/", "/v/", "/live/"] {
            if let Some(rest) = path.strip_prefix(prefix) {
                return clean_video_id(rest.split('/').next().unwrap_or(""));
            }
        }
    } else if host == "youtu.be" {
        let path = parsed.path().trim_start_matches('/');
        return clean_video_id(path.split('/').next().unwrap_or(""));
    }

    None
}

fn clean_video_id(s: &str) -> Option<String> {
    let id: String = s.chars().take_while(|c| *c != '?' && *c != '&').collect();
    // YouTube IDs are 11 chars, base64url subset.
    if id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Some(id)
    } else {
        None
    }
}

/// Fetch the watch page and assemble a `YoutubeVideo` with the spoken transcript.
///
/// Multi-tier resilience: if the `ytInitialPlayerResponse` JSON is missing or
/// the format changed, we fall back to plain `<meta>` tag extraction so the
/// user always gets SOMETHING (title + description) instead of a silent fail.
pub fn fetch_video(url: &str) -> Result<YoutubeVideo, String> {
    let video_id = extract_video_id(url).ok_or("不是有效的 YouTube 链接")?;
    let watch_url = format!("https://www.youtube.com/watch?v={video_id}");

    let html = fetch_text(&watch_url)?;

    // Primary path: parse the embedded player response JSON.
    if let Some(player) = find_player_response(&html) {
        let title = player["videoDetails"]["title"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let description = player["videoDetails"]["shortDescription"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let channel = player["videoDetails"]["author"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let thumbnail = player["videoDetails"]["thumbnail"]["thumbnails"]
            .as_array()
            .and_then(|arr| arr.last())
            .and_then(|t| t["url"].as_str())
            .unwrap_or("")
            .to_string();

        let (transcript, source) = match extract_transcript(&player) {
            Ok((t, s)) => (t, s),
            Err(e) => {
                tracing::warn!("YouTube transcript unavailable for {}: {}", video_id, e);
                (String::new(), "none")
            }
        };

        return Ok(YoutubeVideo {
            title: if title.is_empty() {
                format!("YouTube 视频 {video_id}")
            } else {
                title
            },
            description,
            channel,
            thumbnail,
            transcript,
            transcript_source: source,
        });
    }

    // Fallback path: extract <meta> tags. Loses transcript, but the user still
    // gets a useful clip (title + description + og image) rather than nothing.
    tracing::warn!(
        "YouTube ytInitialPlayerResponse not parseable for {}, falling back to meta tags",
        video_id
    );
    let meta = extract_meta_fallback(&html, &video_id);
    Ok(meta)
}

/// Pull title / description / thumbnail from standard `OpenGraph` + Twitter
/// meta tags that `YouTube` (and most SSR'd pages) include.
fn extract_meta_fallback(html: &str, video_id: &str) -> YoutubeVideo {
    use scraper::{Html, Selector};
    let doc = Html::parse_document(html);

    fn meta(doc: &Html, sel: &str) -> String {
        Selector::parse(sel)
            .ok()
            .and_then(|s| doc.select(&s).next())
            .and_then(|el| el.value().attr("content"))
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }

    let title = {
        let og = meta(&doc, r#"meta[property="og:title"]"#);
        if og.is_empty() {
            // <title> tag fallback
            Selector::parse("title")
                .ok()
                .and_then(|s| doc.select(&s).next()).map_or_else(|| format!("YouTube 视频 {video_id}"), |el| el.text().collect::<String>().trim().to_string())
        } else {
            og
        }
    };
    let description = meta(&doc, r#"meta[property="og:description"]"#);
    let thumbnail = meta(&doc, r#"meta[property="og:image"]"#);
    // YouTube exposes channel name via this tag
    let channel = meta(&doc, r#"link[itemprop="name"]"#);

    YoutubeVideo {
        title,
        description,
        channel,
        thumbnail,
        transcript: String::new(),
        transcript_source: "none",
    }
}

/// Scan the watch page HTML for `ytInitialPlayerResponse = {...}` and return
/// it as a JSON value. Uses a string-aware brace counter to avoid terminating
/// early on `{` / `}` that appear inside string literals.
fn find_player_response(html: &str) -> Option<serde_json::Value> {
    let marker = "ytInitialPlayerResponse";
    let mut search_from = 0usize;
    while let Some(rel) = html[search_from..].find(marker) {
        let idx = search_from + rel;
        // Find the first '=' after the marker, then the first '{'
        let tail = &html[idx + marker.len()..];
        let eq = tail.find('=');
        let Some(eq_pos) = eq else {
            search_from = idx + marker.len();
            continue;
        };
        let after_eq = &tail[eq_pos + 1..];
        let Some(open_rel) = after_eq.find('{') else {
            search_from = idx + marker.len();
            continue;
        };
        let json_start_abs = idx + marker.len() + eq_pos + 1 + open_rel;
        let slice = &html[json_start_abs..];
        if let Some(end) = find_json_end(slice) {
            let json_str = &slice[..end];
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                return Some(v);
            }
        }
        search_from = idx + marker.len();
    }
    None
}

/// Given a `&str` starting at `{`, find the byte offset just after the
/// matching closing `}`. Handles string literals (including escaped quotes)
/// so braces inside strings don't confuse the counter.
fn find_json_end(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    let mut started = false;

    for (i, &b) in bytes.iter().enumerate() {
        if escape {
            escape = false;
            continue;
        }
        if in_string {
            if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => {
                depth += 1;
                started = true;
            }
            b'}' => {
                depth -= 1;
                if started && depth == 0 {
                    return Some(i + 1);
                }
            }
            _ => {}
        }
    }
    None
}

fn extract_transcript(
    player: &serde_json::Value,
) -> Result<(String, &'static str), String> {
    let tracks = player["captions"]["playerCaptionsTracklistRenderer"]["captionTracks"]
        .as_array()
        .ok_or_else(|| "没有字幕轨道".to_string())?;
    if tracks.is_empty() {
        return Err("字幕轨道为空".into());
    }

    let (track, source) = pick_best_track(tracks).ok_or("找不到合适的字幕轨道")?;
    let base_url = track["baseUrl"]
        .as_str()
        .ok_or("字幕轨道缺少 URL")?
        .to_string();

    // Use fmt=srv1 for the simple <text> XML format we know how to parse.
    let caption_url = if base_url.contains("fmt=") {
        base_url
    } else if base_url.contains('?') {
        format!("{base_url}&fmt=srv1")
    } else {
        format!("{base_url}?fmt=srv1")
    };

    let xml = fetch_text(&caption_url)?;
    let text = parse_caption_xml(&xml);
    if text.trim().is_empty() {
        return Err("字幕为空".into());
    }
    Ok((text, source))
}

/// Prefer (1) non-ASR original-language track, (2) any non-ASR track,
/// (3) ASR in the original/primary language, (4) first available.
/// For TED-style talks this picks the publisher's clean transcript; for vlogs
/// it falls back to `YouTube`'s auto-generated ASR so we still get every line.
fn pick_best_track(
    tracks: &[serde_json::Value],
) -> Option<(&serde_json::Value, &'static str)> {
    let is_asr = |t: &serde_json::Value| t["kind"].as_str() == Some("asr");

    let non_asr: Vec<&serde_json::Value> = tracks.iter().filter(|t| !is_asr(t)).collect();

    // 1. Non-ASR, English preferred (TED talks usually have this)
    if let Some(t) = non_asr.iter().find(|t| {
        t["languageCode"]
            .as_str()
            .is_some_and(|l| l.starts_with("en"))
    }) {
        return Some((t, "publisher"));
    }

    // 2. Non-ASR, any language (original-language publisher captions)
    if let Some(&t) = non_asr.first() {
        return Some((t, "publisher"));
    }

    // 3. ASR English (typical vlog)
    if let Some(t) = tracks.iter().find(|t| {
        t["languageCode"]
            .as_str()
            .is_some_and(|l| l.starts_with("en"))
    }) {
        return Some((t, "auto"));
    }

    // 4. First available (ASR in some language)
    tracks.first().map(|t| (t, "auto"))
}

/// Parse `YouTube`'s `<transcript><text start="..." dur="...">...</text>...` XML
/// into newline-joined plain text. We rely on the `scraper` HTML parser since
/// it's already in the dependency tree and handles entity decoding for us.
fn parse_caption_xml(xml: &str) -> String {
    use scraper::{Html, Selector};
    let doc = Html::parse_document(xml);
    let sel = match Selector::parse("text") {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let mut lines: Vec<String> = Vec::new();
    let mut total_chars = 0usize;
    for el in doc.select(&sel) {
        let raw: String = el.text().collect();
        // YouTube sometimes double-encodes entities (&amp;#39; etc.). scraper
        // decodes one layer; decode a second pass manually for the common ones.
        let decoded = raw
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&#39;", "'")
            .replace("&quot;", "\"")
            .replace("&nbsp;", " ");
        let trimmed = decoded.trim();
        if trimmed.is_empty() {
            continue;
        }
        total_chars += trimmed.chars().count();
        lines.push(trimmed.to_string());
        if total_chars > MAX_TRANSCRIPT_CHARS {
            break;
        }
    }
    lines.join("\n")
}

fn fetch_text(url: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new()
        .redirects(5)
        .timeout(FETCH_TIMEOUT)
        .build();
    let resp = agent
        .get(url)
        .set(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        .set("Accept-Language", "en-US,en;q=0.9")
        .call()
        .map_err(|e| format!("请求失败：{e}"))?;

    let mut body = String::new();
    resp.into_reader()
        .take(MAX_HTML_BYTES)
        .read_to_string(&mut body)
        .map_err(|e| format!("读取响应失败：{e}"))?;
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_id_from_watch_url() {
        assert_eq!(
            extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ"),
        );
    }

    #[test]
    fn video_id_from_short_url() {
        assert_eq!(
            extract_video_id("https://youtu.be/dQw4w9WgXcQ?t=42").as_deref(),
            Some("dQw4w9WgXcQ"),
        );
    }

    #[test]
    fn video_id_from_shorts() {
        assert_eq!(
            extract_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ"),
        );
    }

    #[test]
    fn rejects_non_youtube() {
        assert_eq!(extract_video_id("https://example.com/watch?v=abc"), None);
        assert_eq!(extract_video_id("https://youtube.com/watch?v=short"), None);
    }

    #[test]
    fn find_json_end_respects_strings() {
        let s = r#"{"a": "hello {world}", "b": 1}"#;
        assert_eq!(find_json_end(s), Some(s.len()));
    }

    #[test]
    fn find_json_end_nested() {
        let s = r#"{"x": {"y": 1}} trailing"#;
        assert_eq!(find_json_end(s), Some(15));
    }

    #[test]
    fn find_json_end_escaped_quote() {
        let s = r#"{"a": "he said \"hi\""}"#;
        assert_eq!(find_json_end(s), Some(s.len()));
    }
}
