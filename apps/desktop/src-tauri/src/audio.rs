//! Local media file import (podcasts, voice memos, lectures, local videos).
//!
//! Reuses the cloud ASR providers wired up by `transcribe::run_asr` and the
//! post-ASR text pipeline (AI cleanup + auto-tag). Skips the yt-dlp branch
//! since the bytes are already on disk.
//!
//! Two entry points:
//! - `import_audio_file`: the file already is audio. Straight into the ASR
//!   pipeline.
//! - `import_local_video_file`: use the bundled ffmpeg sidecar to extract
//!   audio (mono 16 kHz mp3, the smallest format all ASR providers accept)
//!   into the temp dir, then run the same pipeline.
//!
//! Storage model: both share `web_clips`, differentiated by `source_type`
//! (`'audio'` vs `'local_video'`). URLs take the synthetic form
//! `audio-local://<sha256>` / `local-video://<sha256>` so the table's
//! UNIQUE(url) index handles duplicate-import detection for free.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::db::{app_temp_media_dir, open_db};
use crate::error::AppError;

/// Hard cap on imported audio. Most podcasts are under 150 MB; 300 MB covers
/// long lectures while keeping cloud-ASR single-file limits manageable (the
/// provider will still reject if over its own per-request cap, surfaced as
/// a pipeline failure).
const MAX_AUDIO_SIZE: u64 = 300 * 1024 * 1024;

/// Accepted audio extensions. `webm` is included because browsers export to
/// it and users occasionally drop downloaded audio in that container.
const ALLOWED_EXTS: &[&str] = &[
    "mp3", "m4a", "wav", "flac", "opus", "ogg", "aac", "mpga", "webm",
];

/// Accepted video extensions. We accept what ffmpeg can demux, which is
/// more or less everything — picking the common ones keeps the file dialog
/// filter sane.
const VIDEO_EXTS: &[&str] = &["mp4", "mov", "mkv", "avi", "webm", "m4v", "flv", "wmv"];

/// Hard cap on imported video. 2 GB keeps long recordings viable while
/// bounding disk I/O and (post-extraction) ASR cost. Audio stays at the
/// 300 MB cap from `MAX_AUDIO_SIZE` since audio files rarely need more.
const MAX_VIDEO_SIZE: u64 = 2 * 1024 * 1024 * 1024;

#[cfg(test)]
fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        use std::fmt::Write as _;
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// Streaming SHA-256 for files up to the `MAX_VIDEO_SIZE` ceiling.
///
/// Old path used `fs::read` + `hex_sha256(&bytes)` which loaded the entire
/// file into RAM — a 2 GB video would peak at ~2 GB of memory plus hasher
/// overhead, triggering OOM on lower-spec Macs. Streaming reads in 64 KB
/// chunks keeps peak memory flat regardless of file size while computing
/// the same digest (verified by `hex_sha256_file_matches_bytes_version`).
/// RAII guard that deletes a temp file on drop. Used to guarantee the
/// ffmpeg-extracted mp3 is cleaned up even if the ASR pipeline panics —
/// previously a panic midway through `run_audio_pipeline` would leak the
/// scratch file forever in the `temp_media/` directory.
struct TempFileGuard(PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_file(&self.0) {
            // remove_file failing when the file is already gone is fine
            // (NotFound); log anything else so we can track disk leaks.
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::debug!(
                    target = "audio",
                    "temp file cleanup ({:?}) failed: {}",
                    self.0,
                    e
                );
            }
        }
    }
}

fn hex_sha256_file(path: &Path) -> Result<String, String> {
    use std::io::Read as _;
    let file = std::fs::File::open(path)
        .map_err(|e| format!("打开文件失败: {e}"))?;
    let mut reader = std::io::BufReader::with_capacity(64 * 1024, file);
    let mut hasher = Sha256::new();
    // Heap-allocated scratch — a 64 KB stack array trips clippy's
    // large_stack_arrays lint and would also risk stack overflow on
    // threads with tighter default stack sizes.
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("读取文件失败: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        use std::fmt::Write as _;
        let _ = write!(out, "{b:02x}");
    }
    Ok(out)
}

/// Import a local audio file as a new clip. Returns the new `clip_id` so the
/// frontend can start listening for `transcribe://progress` events the same
/// way it does for `import_video_clip`.
///
/// Flow mirrors `import_video_clip`:
///   1. validate (existence, size, extension)
///   2. hash the bytes → synthetic URL
///   3. upsert a placeholder row with `transcription_status = 'pending'`
///   4. spawn a background thread running `transcribe::run_audio_pipeline`
#[tauri::command]
#[allow(non_snake_case)]
pub fn import_audio_file(app: AppHandle, filePath: String) -> Result<i64, String> {
    let path = PathBuf::from(&filePath);
    if !path.exists() {
        return Err("文件不存在".into());
    }
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("所选路径不是文件".into());
    }
    let size = metadata.len();
    if size > MAX_AUDIO_SIZE {
        return Err(format!(
            "音频过大（{:.1} MB），上限 {} MB",
            size as f64 / 1_048_576.0,
            MAX_AUDIO_SIZE / 1_048_576
        ));
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(format!(
            "不支持的音频格式 .{ext}（支持：mp3/m4a/wav/flac/opus/ogg/aac/webm）"
        ));
    }

    // Title stem from filename (user can edit after). Falls back to a
    // generic string for weird filenames that fail UTF-8 decoding.
    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "本地音频".to_string());

    // Hash-based URL. Two imports of the same bytes collapse onto the same
    // row via the UNIQUE(url) index + ON CONFLICT upsert — matching the way
    // `import_video_clip` handles re-imports of the same YouTube URL.
    // Streaming hash so a 300 MB audio doesn't peak memory.
    let hash = hex_sha256_file(&path)?;
    let url = format!("audio-local://{hash}");

    let conn = open_db()?;
    conn.execute(
        "INSERT INTO web_clips (url, title, source_type, transcription_status)
             VALUES (?1, ?2, 'audio', 'pending')
         ON CONFLICT(url) DO UPDATE SET
             source_type = 'audio',
             title = CASE WHEN web_clips.title = '' THEN excluded.title ELSE web_clips.title END,
             transcription_status = 'pending',
             transcription_error = '',
             deleted_at = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        rusqlite::params![url, title],
    )
    .map_err(|e| e.to_string())?;

    let clip_id: i64 = conn
        .query_row("SELECT id FROM web_clips WHERE url = ?1", [&url], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    let app_bg = app.clone();
    std::thread::spawn(move || {
        crate::transcribe::run_audio_pipeline(app_bg, clip_id, path);
    });

    Ok(clip_id)
}

/// Run the bundled ffmpeg sidecar to pull an audio-only track out of a video
/// file. Output: mono 16 kHz MP3 in the temp dir — the smallest format every
/// cloud ASR provider accepts, which keeps upload cost (and privacy
/// exposure of video frames) at a minimum.
///
/// Returns the temp file path. Caller is responsible for cleanup.
fn extract_audio_from_video(
    app: &AppHandle,
    video: &Path,
    clip_id: i64,
) -> Result<PathBuf, AppError> {
    let temp_dir = app_temp_media_dir().map_err(AppError::io)?;
    let out_path = temp_dir.join(format!(
        "local_video_{clip_id}_{}.mp3",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis())
    ));
    let video_str = video
        .to_str()
        .ok_or_else(|| AppError::io("视频路径含非 UTF-8 字符".to_string()))?;
    let out_str = out_path
        .to_str()
        .ok_or_else(|| AppError::io("临时目录路径含非 UTF-8 字符".to_string()))?;

    let cmd = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::io(format!("ffmpeg sidecar 解析失败: {e}")))?
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-i",
            video_str,
            "-vn",             // drop video stream
            "-ac",
            "1",                // mono
            "-ar",
            "16000",            // 16 kHz — Whisper-native
            "-c:a",
            "libmp3lame",
            "-b:a",
            "64k",
            "-y",
            out_str,
        ]);

    // Stream events so a long extraction doesn't block the runtime; wait on
    // the Terminated event for exit code.
    let (mut rx, _child) = cmd
        .spawn()
        .map_err(|e| AppError::io(format!("ffmpeg 启动失败: {e}")))?;

    let mut stderr_tail = String::new();
    let rt = tauri::async_runtime::block_on(async {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line) => {
                    let s = String::from_utf8_lossy(&line);
                    if stderr_tail.len() < 4096 {
                        stderr_tail.push_str(&s);
                        stderr_tail.push('\n');
                    }
                }
                CommandEvent::Terminated(payload) => {
                    return payload.code;
                }
                _ => {}
            }
        }
        None
    });

    match rt {
        Some(0) => Ok(out_path),
        Some(code) => Err(AppError::io(format!(
            "ffmpeg 退出码 {code}：{}",
            stderr_tail.trim()
        ))),
        None => Err(AppError::io("ffmpeg 异常终止".to_string())),
    }
}

/// Import a local video file. Stores a placeholder clip with
/// `source_type = 'local_video'`, then in a background thread:
///   1. Extract mono 16 kHz mp3 via ffmpeg (temp dir)
///   2. Hand the temp audio to `transcribe::run_audio_pipeline`
///   3. Remove the temp audio on drop
#[tauri::command]
#[allow(non_snake_case)]
pub fn import_local_video_file(app: AppHandle, filePath: String) -> Result<i64, String> {
    let path = PathBuf::from(&filePath);
    if !path.exists() {
        return Err("文件不存在".into());
    }
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("所选路径不是文件".into());
    }
    let size = metadata.len();
    if size > MAX_VIDEO_SIZE {
        return Err(format!(
            "视频过大（{:.1} MB），上限 {} MB",
            size as f64 / 1_048_576.0,
            MAX_VIDEO_SIZE / 1_048_576
        ));
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !VIDEO_EXTS.contains(&ext.as_str()) {
        return Err(format!(
            "不支持的视频格式 .{ext}（支持：mp4/mov/mkv/avi/webm/m4v/flv/wmv）"
        ));
    }

    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "本地视频".to_string());

    // Hash → synthetic URL (same dedup trick as import_audio_file).
    // Streaming hash — a 2 GB MP4 would OOM with fs::read.
    let hash = hex_sha256_file(&path)?;
    let url = format!("local-video://{hash}");

    let conn = open_db()?;
    conn.execute(
        "INSERT INTO web_clips (url, title, source_type, transcription_status)
             VALUES (?1, ?2, 'local_video', 'pending')
         ON CONFLICT(url) DO UPDATE SET
             source_type = 'local_video',
             title = CASE WHEN web_clips.title = '' THEN excluded.title ELSE web_clips.title END,
             transcription_status = 'pending',
             transcription_error = '',
             deleted_at = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        rusqlite::params![url, title],
    )
    .map_err(|e| e.to_string())?;

    let clip_id: i64 = conn
        .query_row("SELECT id FROM web_clips WHERE url = ?1", [&url], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    let app_bg = app.clone();
    std::thread::spawn(move || {
        match extract_audio_from_video(&app_bg, &path, clip_id) {
            Ok(audio_tmp) => {
                // RAII guard: cleanup runs even if run_audio_pipeline
                // panics, preventing scratch-file leaks in temp_media/.
                let _guard = TempFileGuard(audio_tmp.clone());
                crate::transcribe::run_audio_pipeline(
                    app_bg.clone(),
                    clip_id,
                    audio_tmp,
                );
            }
            Err(e) => {
                tracing::warn!(
                    target = "audio",
                    clip_id,
                    "video audio extraction failed: {}",
                    e.message
                );
                let _ = crate::db::open_db().map(|conn| {
                    conn.execute(
                        "UPDATE web_clips SET transcription_status = 'failed',
                            transcription_error = ?1,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                         WHERE id = ?2",
                        rusqlite::params![format!("提取视频音频失败: {}", e.message), clip_id],
                    )
                });
            }
        }
    });

    Ok(clip_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_sha256_produces_expected_length() {
        let hash = hex_sha256(b"hello");
        assert_eq!(hash.len(), 64, "sha256 hex is always 64 chars");
    }

    #[test]
    fn hex_sha256_deterministic() {
        assert_eq!(hex_sha256(b"podcast"), hex_sha256(b"podcast"));
        assert_ne!(hex_sha256(b"podcast"), hex_sha256(b"Podcast"));
    }

    #[test]
    fn hex_sha256_file_matches_bytes_version() {
        // Streaming and byte-slice hashers must agree on identical input —
        // otherwise the synthetic URL for re-imports would diverge across
        // builds, breaking ON CONFLICT(url) dedup.
        let tmp = std::env::temp_dir().join("knoyoo_audio_hash_test.bin");
        let payload: Vec<u8> = (0u8..=255).cycle().take(200_000).collect();
        std::fs::write(&tmp, &payload).expect("write tmp");
        let bytes_hash = hex_sha256(&payload);
        let file_hash = hex_sha256_file(&tmp).expect("file hash");
        let _ = std::fs::remove_file(&tmp);
        assert_eq!(bytes_hash, file_hash);
        assert_eq!(bytes_hash.len(), 64);
    }

    #[test]
    fn allowed_exts_covers_common_formats() {
        assert!(ALLOWED_EXTS.contains(&"mp3"));
        assert!(ALLOWED_EXTS.contains(&"m4a"));
        assert!(ALLOWED_EXTS.contains(&"wav"));
        assert!(ALLOWED_EXTS.contains(&"flac"));
        assert!(ALLOWED_EXTS.contains(&"opus"));
        assert!(!ALLOWED_EXTS.contains(&"mp4"), "video containers excluded");
    }
}
