//! `yt-dlp` sidecar wrapper.
//!
//! Exposes two operations the video-transcription pipeline needs:
//! - [`fetch_metadata`]: one-shot JSON dump (title, duration, subtitle langs)
//! - [`download_audio`]: stream the best audio track to disk with a
//!   percent-fraction progress callback
//!
//! Both go through `tauri-plugin-shell`'s sidecar API, which resolves to the
//! bundled binary in `src-tauri/binaries/yt-dlp-<target-triple>`. Call sites
//! MUST run on a `std::thread::spawn` — `block_on` the Tauri runtime from
//! one of its own worker threads will deadlock on the child-process channel.

use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::error::AppError;

#[derive(Debug, Clone, Default)]
#[allow(dead_code)] // `uploader` / `webpage_url` consumed by frontend once wired through.
pub struct VideoMetadata {
    pub title: String,
    pub uploader: String,
    pub description: String,
    pub duration_sec: u64,
    pub thumbnail: String,
    pub webpage_url: String,
    /// Publisher-authored subtitle languages (typically higher quality than
    /// ASR-generated captions).
    pub subtitle_langs: Vec<String>,
    /// YouTube's auto-generated captions. Used as a fallback when
    /// `subtitle_langs` is empty.
    pub auto_caption_langs: Vec<String>,
}

/// Hit yt-dlp with `--dump-single-json` to pull metadata without downloading.
/// Blocks the calling thread while the subprocess runs.
pub fn fetch_metadata(app: &AppHandle, url: &str) -> Result<VideoMetadata, AppError> {
    validate_url(url)?;
    let cmd = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| AppError::io(format!("yt-dlp sidecar 解析失败: {e}")))?
        .args([
            "--dump-single-json",
            "--no-playlist",
            "--skip-download",
            "--no-warnings",
            url,
        ]);

    let output = tauri::async_runtime::block_on(cmd.output())
        .map_err(|e| AppError::io(format!("yt-dlp 执行失败: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::io(format!(
            "yt-dlp 退出码 {:?}: {}",
            output.status.code(),
            first_lines(&stderr, 3)
        )));
    }

    let v: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| AppError::ai(format!("解析 yt-dlp JSON 失败: {e}")))?;

    Ok(parse_metadata(&v))
}

/// Pick the best subtitle language out of what's available.
///
/// Preference ladder: simplified Chinese first (since KnoYoo's default
/// audience), then traditional, then generic `zh`, then English variants,
/// then any remaining track. Returns `None` when the list is empty.
pub fn pick_subtitle_lang(available: &[String]) -> Option<String> {
    const PREFERENCE: &[&str] = &[
        "zh-Hans", "zh-CN", "zh-Hans-CN", "zh", "zh-Hant", "zh-TW", "zh-HK",
        "en", "en-US", "en-GB",
    ];
    for pref in PREFERENCE {
        if let Some(m) = available.iter().find(|l| l.as_str() == *pref) {
            return Some(m.clone());
        }
    }
    if let Some(m) = available.iter().find(|l| l.starts_with("zh")) {
        return Some(m.clone());
    }
    if let Some(m) = available.iter().find(|l| l.starts_with("en")) {
        return Some(m.clone());
    }
    available.first().cloned()
}

/// Download the best matching subtitle track as an SRT file.
///
/// `prefer_publisher = true` drives `--write-subs`; `false` uses
/// `--write-auto-subs` (YouTube's machine-generated captions). Returns the
/// path to the `.srt` file on success, `None` when no suitable subtitle
/// exists. Caller decides which branch to try based on metadata.
pub fn download_subtitle(
    app: &AppHandle,
    url: &str,
    work_dir: &Path,
    available_langs: &[String],
    prefer_publisher: bool,
) -> Result<Option<PathBuf>, AppError> {
    validate_url(url)?;
    std::fs::create_dir_all(work_dir)
        .map_err(|e| AppError::io(format!("创建临时目录失败: {e}")))?;

    let Some(lang) = pick_subtitle_lang(available_langs) else {
        return Ok(None);
    };

    let template = work_dir.join("%(id)s.%(ext)s");
    let template_str = template
        .to_str()
        .ok_or_else(|| AppError::io("输出路径包含非 UTF-8 字符"))?;

    let write_flag = if prefer_publisher {
        "--write-subs"
    } else {
        "--write-auto-subs"
    };

    let cmd = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| AppError::io(format!("yt-dlp sidecar 解析失败: {e}")))?
        .args([
            "--no-playlist",
            "--skip-download",
            "--no-warnings",
            write_flag,
            "--sub-langs",
            &lang,
            "--convert-subs",
            "srt",
            "-o",
            template_str,
            url,
        ]);

    let output = tauri::async_runtime::block_on(cmd.output())
        .map_err(|e| AppError::io(format!("yt-dlp 执行失败: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::io(format!(
            "yt-dlp 字幕下载失败 ({:?}): {}",
            output.status.code(),
            first_lines(&stderr, 3)
        )));
    }

    // Scan the work dir for a freshly-produced .srt. Using a dedicated dir
    // per pipeline invocation (the caller's responsibility) means we don't
    // need to track yt-dlp's stdout path output.
    let entries = std::fs::read_dir(work_dir)
        .map_err(|e| AppError::io(format!("列出临时目录失败: {e}")))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("srt") {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

/// Strip SRT formatting down to plain spoken text.
///
/// Drops cue numbers, timestamp ranges, inline `<i>` / `<font>` tags, and
/// `{\anX}` positioning codes that some auto-captions include. Joins the
/// remaining cue lines with newlines.
pub fn srt_to_plaintext(srt: &str) -> String {
    let mut kept: Vec<&str> = Vec::new();
    for line in srt.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        // Cue numbers: standalone integers.
        if t.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        // Timestamp ranges always contain `-->`.
        if t.contains("-->") {
            continue;
        }
        kept.push(t);
    }
    strip_markup(&kept.join("\n"))
}

/// Crude markup stripper — removes `<...>` and `{...}` runs. Good enough
/// for SRT subtitle files; not a general-purpose HTML sanitizer.
fn strip_markup(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth_angle: u32 = 0;
    let mut depth_brace: u32 = 0;
    for c in s.chars() {
        match c {
            '<' => depth_angle = depth_angle.saturating_add(1),
            '>' => depth_angle = depth_angle.saturating_sub(1),
            '{' => depth_brace = depth_brace.saturating_add(1),
            '}' => depth_brace = depth_brace.saturating_sub(1),
            _ if depth_angle == 0 && depth_brace == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// Download the best audio track to `out_dir` and return the resolved file
/// path. Progress is reported as a 0.0-1.0 fraction; yt-dlp emits percent
/// strings roughly every second.
///
/// We intentionally skip `-x` / `--audio-format` post-processing here: those
/// shell out to ffmpeg which isn't on PATH in bundled builds. The caller
/// (ASR layer) can accept native container formats (m4a / webm / opus),
/// which OpenAI Whisper, Deepgram, and SiliconFlow all handle.
pub fn download_audio(
    app: &AppHandle,
    url: &str,
    out_dir: &Path,
    mut on_progress: impl FnMut(f32),
) -> Result<PathBuf, AppError> {
    validate_url(url)?;
    std::fs::create_dir_all(out_dir)
        .map_err(|e| AppError::io(format!("创建临时目录失败: {e}")))?;

    let template = out_dir.join("%(id)s.%(ext)s");
    let template_str = template
        .to_str()
        .ok_or_else(|| AppError::io("输出路径包含非 UTF-8 字符"))?;

    let cmd = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| AppError::io(format!("yt-dlp sidecar 解析失败: {e}")))?
        .args([
            "--no-playlist",
            "--no-part",
            "--no-warnings",
            "-f",
            "bestaudio",
            "--newline",
            // Custom progress template; prefixed so we can distinguish it
            // from the `after_move:filepath` line yt-dlp emits at the end.
            "--progress-template",
            "knoyoo-progress:%(progress._percent_str)s",
            "--print",
            "after_move:filepath",
            "-o",
            template_str,
            url,
        ]);

    let (mut rx, _child) = cmd
        .spawn()
        .map_err(|e| AppError::io(format!("yt-dlp 启动失败: {e}")))?;

    let mut final_path: Option<PathBuf> = None;
    let mut exit_code: Option<i32> = None;
    let mut stderr_tail: Vec<String> = Vec::new();

    tauri::async_runtime::block_on(async {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(bytes) => {
                    let chunk = String::from_utf8_lossy(&bytes);
                    for raw in chunk.lines() {
                        let line = raw.trim();
                        if line.is_empty() {
                            continue;
                        }
                        if let Some(rest) = line.strip_prefix("knoyoo-progress:") {
                            if let Some(pct) = parse_percent(rest) {
                                on_progress(pct);
                            }
                        } else {
                            // after_move:filepath output. yt-dlp prints the
                            // final resolved path on its own line.
                            let candidate = PathBuf::from(line);
                            if candidate.is_absolute() && candidate.exists() {
                                final_path = Some(candidate);
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    stderr_tail.push(line);
                    // Keep only the last N lines to bound memory on pathological
                    // error output.
                    if stderr_tail.len() > 20 {
                        stderr_tail.remove(0);
                    }
                }
                CommandEvent::Terminated(payload) => {
                    exit_code = payload.code;
                    break;
                }
                CommandEvent::Error(msg) => {
                    stderr_tail.push(msg);
                }
                _ => {}
            }
        }
    });

    match exit_code {
        Some(0) => {}
        other => {
            let tail = stderr_tail.join("").trim().to_string();
            return Err(AppError::io(format!(
                "yt-dlp 下载失败 (退出码 {:?}): {}",
                other,
                first_lines(&tail, 3)
            )));
        }
    }

    final_path.ok_or_else(|| AppError::io("yt-dlp 未输出下载文件路径"))
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable without an AppHandle)
// ---------------------------------------------------------------------------

fn parse_metadata(v: &serde_json::Value) -> VideoMetadata {
    VideoMetadata {
        title: v["title"].as_str().unwrap_or_default().to_string(),
        uploader: v["uploader"].as_str().unwrap_or_default().to_string(),
        description: v["description"].as_str().unwrap_or_default().to_string(),
        // yt-dlp emits duration as a float (seconds). Sub-second precision
        // doesn't matter for our progress math.
        duration_sec: v["duration"].as_f64().unwrap_or(0.0).max(0.0) as u64,
        thumbnail: v["thumbnail"].as_str().unwrap_or_default().to_string(),
        webpage_url: v["webpage_url"].as_str().unwrap_or_default().to_string(),
        subtitle_langs: lang_keys(&v["subtitles"]),
        auto_caption_langs: lang_keys(&v["automatic_captions"]),
    }
}

/// yt-dlp represents subtitle tracks as `{"zh-Hans": [...], "en": [...]}`.
/// We only care about which languages exist, not the individual track specs.
fn lang_keys(v: &serde_json::Value) -> Vec<String> {
    v.as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default()
}

/// Parse `"  42.3%"` → `0.423`. Returns `None` on unparseable input so
/// stray lines don't corrupt the progress stream.
fn parse_percent(s: &str) -> Option<f32> {
    let t = s.trim().trim_end_matches('%').trim();
    let v: f32 = t.parse().ok()?;
    if !v.is_finite() {
        return None;
    }
    Some((v / 100.0).clamp(0.0, 1.0))
}

fn validate_url(url: &str) -> Result<(), AppError> {
    if url.is_empty() {
        return Err(AppError::validation("URL 为空"));
    }
    if url.len() > 4096 {
        return Err(AppError::validation("URL 过长 (> 4KB)"));
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::validation("URL 必须以 http:// 或 https:// 开头"));
    }
    Ok(())
}

fn first_lines(s: &str, n: usize) -> String {
    s.lines().take(n).collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_typical_yt_dlp_dump() {
        let json = serde_json::json!({
            "title": "Rust 所有权讲解",
            "uploader": "Jane Doe",
            "description": "本视频介绍...",
            "duration": 623.4,
            "thumbnail": "https://i.ytimg.com/vi/abc/hqdefault.jpg",
            "webpage_url": "https://www.youtube.com/watch?v=abc",
            "subtitles": {
                "zh-Hans": [{"url": "x", "ext": "vtt"}],
                "en": [{"url": "y", "ext": "vtt"}]
            },
            "automatic_captions": {
                "ja": [{"url": "z", "ext": "vtt"}]
            }
        });
        let meta = parse_metadata(&json);
        assert_eq!(meta.title, "Rust 所有权讲解");
        assert_eq!(meta.duration_sec, 623);
        let mut subs = meta.subtitle_langs.clone();
        subs.sort();
        assert_eq!(subs, vec!["en", "zh-Hans"]);
        assert_eq!(meta.auto_caption_langs, vec!["ja"]);
    }

    #[test]
    fn handles_missing_fields() {
        let json = serde_json::json!({});
        let meta = parse_metadata(&json);
        assert_eq!(meta.title, "");
        assert_eq!(meta.duration_sec, 0);
        assert!(meta.subtitle_langs.is_empty());
    }

    #[test]
    fn negative_duration_is_clamped() {
        let json = serde_json::json!({ "duration": -5.0 });
        assert_eq!(parse_metadata(&json).duration_sec, 0);
    }

    #[test]
    fn parse_percent_accepts_yt_dlp_formats() {
        fn approx(got: Option<f32>, want: f32) {
            let g = got.expect("expected Some(_)");
            assert!((g - want).abs() < 1e-4, "got {g}, want {want}");
        }
        approx(parse_percent("  42.3%"), 0.423);
        approx(parse_percent("100.0%"), 1.0);
        approx(parse_percent("0%"), 0.0);
        approx(parse_percent("  7 %  "), 0.07);
    }

    #[test]
    fn parse_percent_rejects_garbage() {
        assert_eq!(parse_percent("N/A"), None);
        assert_eq!(parse_percent(""), None);
        assert_eq!(parse_percent("abc%"), None);
    }

    #[test]
    fn parse_percent_clamps_out_of_range() {
        // yt-dlp occasionally emits >100% while merging — clamp to 1.0
        // so callers don't see a regression.
        assert_eq!(parse_percent("120%"), Some(1.0));
    }

    #[test]
    fn validates_url_shape() {
        assert!(validate_url("https://youtu.be/abc").is_ok());
        assert!(validate_url("http://x.com/v").is_ok());
        assert!(validate_url("").is_err());
        assert!(validate_url("ftp://host/file").is_err());
        assert!(validate_url("javascript:alert(1)").is_err());
        let huge = format!("https://x.com/{}", "a".repeat(5000));
        assert!(validate_url(&huge).is_err());
    }

    #[test]
    fn first_lines_clips() {
        assert_eq!(first_lines("a\nb\nc\nd", 2), "a\nb");
        assert_eq!(first_lines("only", 5), "only");
        assert_eq!(first_lines("", 3), "");
    }

    #[test]
    fn lang_keys_from_nonobject_is_empty() {
        assert_eq!(lang_keys(&serde_json::Value::Null), Vec::<String>::new());
        assert_eq!(
            lang_keys(&serde_json::json!(["not", "an", "object"])),
            Vec::<String>::new()
        );
    }

    #[test]
    fn subtitle_lang_prefers_simplified_chinese() {
        let avail = vec!["en".into(), "zh-Hans".into(), "zh-Hant".into(), "ja".into()];
        assert_eq!(pick_subtitle_lang(&avail).as_deref(), Some("zh-Hans"));
    }

    #[test]
    fn subtitle_lang_falls_back_through_zh_variants() {
        assert_eq!(
            pick_subtitle_lang(&vec!["zh-HK".into(), "en".into()]).as_deref(),
            Some("zh-HK")
        );
        // Unknown zh-prefixed variant still matches the "starts_with(zh)" rule.
        assert_eq!(
            pick_subtitle_lang(&vec!["zh-Foo".into(), "fr".into()]).as_deref(),
            Some("zh-Foo")
        );
    }

    #[test]
    fn subtitle_lang_falls_back_to_english() {
        assert_eq!(
            pick_subtitle_lang(&vec!["fr".into(), "en-GB".into(), "de".into()]).as_deref(),
            Some("en-GB")
        );
    }

    #[test]
    fn subtitle_lang_last_resort_picks_first() {
        assert_eq!(
            pick_subtitle_lang(&vec!["ja".into(), "ko".into()]).as_deref(),
            Some("ja")
        );
        assert_eq!(pick_subtitle_lang(&[]), None);
    }

    #[test]
    fn srt_parser_basic() {
        let srt = "1\n00:00:00,000 --> 00:00:03,000\nHello world\n\n2\n00:00:03,000 --> 00:00:06,500\nSecond cue\n";
        assert_eq!(srt_to_plaintext(srt), "Hello world\nSecond cue");
    }

    #[test]
    fn srt_parser_strips_styling_and_positioning() {
        let srt = "1\n00:00:00,000 --> 00:00:03,000\n<i>italic</i> text\n\n2\n00:00:03,000 --> 00:00:06,000\n{\\an8}top-positioned\n";
        assert_eq!(srt_to_plaintext(srt), "italic text\ntop-positioned");
    }

    #[test]
    fn srt_parser_handles_multiline_cues() {
        let srt = "1\n00:00:00,000 --> 00:00:05,000\nFirst line\nSecond line\n";
        // Multi-line cues are joined with newlines — one line per cue row.
        assert_eq!(srt_to_plaintext(srt), "First line\nSecond line");
    }

    #[test]
    fn srt_parser_empty_input() {
        assert_eq!(srt_to_plaintext(""), "");
        assert_eq!(srt_to_plaintext("\n\n\n"), "");
    }
}
