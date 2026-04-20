//! Video / audio → transcript pipeline.
//!
//! Full pipeline, end-to-end:
//! `metadata → subtitle-or-ASR → (split if > provider cap) → cloud ASR →
//!   AI cleanup → summary + tags`.
//!
//! Entry points:
//! - `run_pipeline` — `YouTube` / Bilibili URLs (yt-dlp + subtitle ladder +
//!   ASR fallback).
//! - `run_audio_pipeline` — local audio / extracted-video audio (skips the
//!   network-shaped prelude, starts at ASR).
//!
//! Long-audio handling: files above a provider's single-upload cap
//! (Whisper 25MB / Deepgram 100MB / `SiliconFlow` 20MB) are transparently
//! split by `audio_split::split_audio_by_duration` and uploaded serially;
//! transcripts are concatenated in order.
//!
//! Progress contract: a single Tauri event `transcribe://progress` carrying
//! `{clip_id, stage, percent, detail?}`. The frontend subscribes once and
//! routes by `clip_id`.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Monotonic counter for unique `work_dir` suffixes. Replaces the old
/// millisecond-timestamp naming which could collide when two pipeline runs
/// for the same `clip_id` spawned within the same millisecond (double-click
/// on the "retry" button) — two `WorkDirGuard`s would then delete each
/// other's directory out from under the pipeline.
static WORK_DIR_SEQ: AtomicU64 = AtomicU64::new(0);

use crate::asr_client::{self, AsrConfig, AudioInput};
use crate::audio_split;
use crate::db::{app_temp_media_dir, kv_get, open_db};
use crate::error::AppError;
use crate::secrets;
use crate::ytdlp;

/// Event name used for all pipeline progress notifications.
pub const PROGRESS_EVENT: &str = "transcribe://progress";

/// Ordered stages of the pipeline. Percent ranges are informational — each
/// stage emits a final event at its upper bound, and long-running stages
/// (download, asr) interpolate within their range.
///
/// Kept as a flat enum with `snake_case` serde so the frontend can match on
/// string values without importing Rust types.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Metadata,       // 0-5
    SubtitleProbe,  // 5-10
    Download,       // 10-40 (or 10-20 on the subtitle path)
    Split,          // 40-45 (only when audio exceeds provider cap)
    Asr,            // 45-80
    Clean,          // 80-95
    Summarize,      // 95-100
}

#[derive(Debug, Clone, Serialize)]
pub struct ProgressEvent {
    pub clip_id: i64,
    pub stage: Stage,
    /// Overall completion, 0-100. NOT per-stage.
    pub percent: u32,
    /// Human-readable context ("下载 42%" / "转录第 2/3 片"). Localised
    /// strings are fine here — this is purely for UI display.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Run the pipeline for `clip_id`. Safe to call from any `std::thread::spawn`.
/// Emits progress events and writes final status to the DB; never panics.
pub fn run_pipeline(app: AppHandle, clip_id: i64, url: String) {
    set_status(clip_id, "pending", "", None);
    match run_pipeline_inner(&app, clip_id, &url) {
        Ok(provider_id) => {
            set_status(clip_id, "completed", "", Some(&provider_id));
            emit(
                &app,
                clip_id,
                Stage::Summarize,
                100,
                Some("完成"),
            );
        }
        Err(e) => {
            tracing::error!(
                target = "transcribe",
                clip_id,
                "pipeline failed: {}",
                e
            );
            set_status(clip_id, "failed", &e.message, None);
        }
    }
}

fn run_pipeline_inner(
    app: &AppHandle,
    clip_id: i64,
    url: &str,
) -> Result<String, AppError> {
    // Dedicated scratch dir per invocation so yt-dlp output files don't
    // collide across concurrent pipelines, and cleanup is a single rmdir.
    // Suffix comes from a process-wide atomic counter (was a ms timestamp —
    // fast retries in the same tick collided).
    let seq = WORK_DIR_SEQ.fetch_add(1, Ordering::Relaxed);
    let work_dir = app_temp_media_dir()
        .map_err(AppError::io)?
        .join(format!("clip_{clip_id}_{seq}"));
    std::fs::create_dir_all(&work_dir)
        .map_err(|e| AppError::io(format!("创建工作目录失败: {e}")))?;
    let _cleanup = WorkDirGuard(work_dir.clone());

    // ── Stage 1: metadata ────────────────────────────────────────────────
    emit(app, clip_id, Stage::Metadata, 2, Some("解析视频元数据"));
    let meta = ytdlp::fetch_metadata(app, url)?;
    update_clip_metadata(clip_id, &meta)?;
    emit(
        app,
        clip_id,
        Stage::Metadata,
        5,
        Some(&format!(
            "{} · {}s",
            truncate(&meta.title, 40),
            meta.duration_sec
        )),
    );

    // ── Stage 2-5: obtain transcript (subtitle first, ASR fallback) ──────
    let (transcript, source_id) = obtain_transcript(app, clip_id, url, &meta, &work_dir)?;

    // ── Stage 6: AI 清洗 raw → 可读版 Markdown ───────────────────────────
    set_status(clip_id, "cleaning", "", None);
    save_raw_transcript(clip_id, &transcript)?;
    emit(app, clip_id, Stage::Clean, 82, Some("AI 清洗为可读版"));
    run_ai_cleanup(clip_id);
    emit(app, clip_id, Stage::Clean, 93, Some("清洗完成"));

    // ── Stage 7: 摘要 + 标签 ─────────────────────────────────────────────
    emit(app, clip_id, Stage::Summarize, 96, Some("生成摘要与标签"));
    run_auto_tag(clip_id);
    // auto_tag re-classifies source_type from the AI reply. Transcripts
    // always come from video — force the label back regardless of guess.
    enforce_video_source_type(clip_id);

    // ── Stage 8 (optional): 译文 ─────────────────────────────────────────
    // Reuses the Summarize stage label so we don't have to add a new
    // variant just for translation. The UI shows the detail string
    // ("生成译文") which is what users actually read.
    emit(app, clip_id, Stage::Summarize, 98, Some("生成译文"));
    run_ai_translate(clip_id);

    Ok(source_id)
}

/// RAII guard: removes the per-invocation scratch dir on drop. Best-effort —
/// a leftover dir on crash is harmless and can be swept on next startup.
struct WorkDirGuard(std::path::PathBuf);

impl Drop for WorkDirGuard {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_dir_all(&self.0) {
            tracing::debug!(
                target = "transcribe",
                "work dir cleanup ({:?}) failed: {}",
                self.0,
                e
            );
        }
    }
}

/// Produce `(transcript, transcription_source)` for the video.
/// Tries publisher subtitles → auto-captions → cloud ASR in order. Each
/// branch may fail softly; only a failure of the final ASR path propagates.
fn obtain_transcript(
    app: &AppHandle,
    clip_id: i64,
    url: &str,
    meta: &ytdlp::VideoMetadata,
    work_dir: &Path,
) -> Result<(String, String), AppError> {
    // Order matters: publisher captions are human-authored and more accurate
    // than YouTube's ASR-generated `automatic_captions`, which are still
    // better (and free) than our own cloud ASR call.
    let candidates: &[(bool, &[String])] = &[
        (true, &meta.subtitle_langs),
        (false, &meta.auto_caption_langs),
    ];
    for (prefer_publisher, langs) in candidates {
        if langs.is_empty() {
            continue;
        }
        let label = if *prefer_publisher {
            "发现发布者字幕"
        } else {
            "使用自动字幕"
        };
        emit(app, clip_id, Stage::SubtitleProbe, 10, Some(label));

        match try_subtitle_path(app, clip_id, url, langs, *prefer_publisher, work_dir) {
            Ok(Some(text)) => return Ok((text, "subtitle".to_string())),
            Ok(None) => tracing::info!(
                target = "transcribe",
                clip_id,
                "subtitle track empty, trying next source"
            ),
            Err(e) => tracing::warn!(
                target = "transcribe",
                clip_id,
                "subtitle path failed, falling back: {}",
                e
            ),
        }
    }

    emit(app, clip_id, Stage::SubtitleProbe, 10, Some("无字幕，走 ASR"));
    let (transcript, provider_id) = run_asr_path(app, clip_id, url, work_dir)?;
    Ok((transcript, provider_id))
}

/// Download the best-fit subtitle track and parse it to plain text.
/// Returns `Ok(None)` on "track exists but produced no usable text" — the
/// caller then falls through to the next source in the ladder.
fn try_subtitle_path(
    app: &AppHandle,
    clip_id: i64,
    url: &str,
    available_langs: &[String],
    prefer_publisher: bool,
    work_dir: &Path,
) -> Result<Option<String>, AppError> {
    set_status(clip_id, "downloading", "", None);
    emit(app, clip_id, Stage::Download, 15, Some("下载字幕"));

    let Some(srt_path) =
        ytdlp::download_subtitle(app, url, work_dir, available_langs, prefer_publisher)?
    else {
        return Ok(None);
    };

    let srt = std::fs::read_to_string(&srt_path)
        .map_err(|e| AppError::io(format!("读取字幕文件失败: {e}")))?;
    let text = ytdlp::srt_to_plaintext(&srt);
    if text.trim().is_empty() {
        return Ok(None);
    }
    emit(
        app,
        clip_id,
        Stage::Download,
        40,
        Some(&format!("字幕已解析 · {} 字", text.chars().count())),
    );
    Ok(Some(text))
}

/// Run the audio-download + cloud-ASR branch. Returns
/// `(transcript, provider_id)`.
fn run_asr_path(
    app: &AppHandle,
    clip_id: i64,
    url: &str,
    work_dir: &Path,
) -> Result<(String, String), AppError> {
    set_status(clip_id, "downloading", "", None);

    // The progress closure needs its own AppHandle clone so it can emit
    // from the yt-dlp subprocess event loop without borrowing `app`.
    let emit_app = app.clone();
    let audio_path = ytdlp::download_audio(app, url, work_dir, move |pct| {
        // Guard against NaN / out-of-range progress from the yt-dlp pipe.
        let pct_safe = if pct.is_finite() { pct.clamp(0.0, 1.0) } else { 0.0 };
        let overall = 10 + (pct_safe * 30.0).round() as u32;
        let _ = emit_app.emit(
            PROGRESS_EVENT,
            &ProgressEvent {
                clip_id,
                stage: Stage::Download,
                percent: overall.min(40),
                detail: Some(format!("下载 {:.0}%", pct * 100.0)),
            },
        );
    })?;
    emit(app, clip_id, Stage::Download, 40, Some("下载完成"));

    set_status(clip_id, "transcribing", "", None);
    emit(app, clip_id, Stage::Asr, 45, Some("正在转录"));
    let (transcript, provider_id) = run_asr(app, clip_id, &audio_path)?;
    emit(
        app,
        clip_id,
        Stage::Asr,
        80,
        Some(&format!("转录完成 · {} 字", transcript.chars().count())),
    );
    Ok((transcript, provider_id))
}

/// AI cleanup is optional — if it fails (no AI configured, rate limit,
/// >66% compression rejection), we keep the raw transcript as `content`
/// > and move on. A failed cleanup MUST NOT fail the whole pipeline.
fn run_ai_cleanup(clip_id: i64) {
    if let Err(e) = crate::clips::ai_clean_clip_inner(clip_id) {
        tracing::warn!(
            target = "transcribe",
            clip_id,
            "AI cleanup skipped: {}",
            e
        );
    }
}

fn run_auto_tag(clip_id: i64) {
    if let Err(e) = crate::clips::auto_tag_clip_inner(clip_id) {
        tracing::warn!(
            target = "transcribe",
            clip_id,
            "auto-tag skipped: {}",
            e
        );
    }
}

/// Optional translation pass. Best-effort like cleanup/auto-tag — if AI
/// isn't configured or the call fails, the clip keeps its original content
/// and the UI simply doesn't offer a translation toggle.
fn run_ai_translate(clip_id: i64) {
    if let Err(e) = crate::clips::ai_translate_clip_inner(clip_id) {
        tracing::warn!(
            target = "transcribe",
            clip_id,
            "AI translate skipped: {}",
            e
        );
    }
}

/// Shared entry point for the LOCAL-FILE ASR pipeline. Used by
/// `audio::import_audio_file` (podcasts / recordings). Skips all the
/// network-shaped work of `run_pipeline` (metadata probe, subtitle ladder,
/// yt-dlp download) and starts straight at transcription since the file is
/// already on disk.
///
/// Emits the same `transcribe://progress` events the UI already listens to —
/// audio import reuses the existing progress bar component without special
/// casing.
pub fn run_audio_pipeline(app: AppHandle, clip_id: i64, audio_path: std::path::PathBuf) {
    set_status(clip_id, "transcribing", "", None);
    match run_audio_pipeline_inner(&app, clip_id, &audio_path) {
        Ok(provider_id) => {
            set_status(clip_id, "completed", "", Some(&provider_id));
            emit(&app, clip_id, Stage::Summarize, 100, Some("完成"));
        }
        Err(e) => {
            tracing::error!(target = "transcribe", clip_id, "audio pipeline failed: {}", e);
            set_status(clip_id, "failed", &e.message, None);
        }
    }
}

fn run_audio_pipeline_inner(
    app: &AppHandle,
    clip_id: i64,
    audio_path: &Path,
) -> Result<String, AppError> {
    emit(app, clip_id, Stage::Asr, 45, Some("正在转录"));
    let (transcript, provider_id) = run_asr(app, clip_id, audio_path)?;
    emit(
        app,
        clip_id,
        Stage::Asr,
        80,
        Some(&format!("转录完成 · {} 字", transcript.chars().count())),
    );

    set_status(clip_id, "cleaning", "", None);
    save_raw_transcript(clip_id, &transcript)?;
    emit(app, clip_id, Stage::Clean, 82, Some("AI 清洗为可读版"));
    run_ai_cleanup(clip_id);
    emit(app, clip_id, Stage::Clean, 93, Some("清洗完成"));

    emit(app, clip_id, Stage::Summarize, 96, Some("生成摘要与标签"));
    run_auto_tag(clip_id);
    enforce_audio_source_type(clip_id);

    emit(app, clip_id, Stage::Summarize, 98, Some("生成译文"));
    run_ai_translate(clip_id);

    Ok(provider_id)
}

/// Mirror of `enforce_video_source_type` — `auto_tag` can reclassify based on
/// content, but a local audio file is forever an audio clip regardless of
/// what topic the transcript covers.
fn enforce_audio_source_type(clip_id: i64) {
    if let Ok(conn) = open_db() {
        let _ = conn.execute(
            "UPDATE web_clips SET source_type = 'audio',
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1",
            [clip_id],
        );
    }
}

/// Safety belt: `auto_tag` classifies `source_type` from the AI reply. Our
/// transcripts are always from video — force the label back so the UI's
/// video-specific affordances (player link, duration badge) stay correct
/// even if the model picks a different bucket.
fn enforce_video_source_type(clip_id: i64) {
    if let Ok(conn) = open_db() {
        let _ = conn.execute(
            "UPDATE web_clips SET source_type = 'video' WHERE id = ?1",
            [clip_id],
        );
    }
}

// ---------------------------------------------------------------------------
// ASR call
// ---------------------------------------------------------------------------

/// Monotonic counter for unique per-invocation split-dir suffixes. Same
/// reasoning as `WORK_DIR_SEQ` — a ms timestamp could collide on retry
/// double-taps and let two `SplitDirGuard`s fight over the same directory.
static SPLIT_DIR_SEQ: AtomicU64 = AtomicU64::new(0);

/// RAII cleanup for a split-audio scratch directory. Separate from
/// `WorkDirGuard` so `run_asr` works on both branches (URL pipeline with
/// a pre-existing `work_dir`, and local-audio pipeline without).
struct SplitDirGuard(std::path::PathBuf);

impl Drop for SplitDirGuard {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_dir_all(&self.0) {
            tracing::debug!(
                target = "transcribe",
                "split dir cleanup ({:?}) failed: {}",
                self.0,
                e
            );
        }
    }
}

fn run_asr(
    app: &AppHandle,
    clip_id: i64,
    path: &Path,
) -> Result<(String, String), AppError> {
    let cfg_map = read_asr_config()?;
    let cfg = AsrConfig::from_map(&cfg_map)?;
    let provider = asr_client::build_provider(&cfg)?;
    let max_bytes = provider.max_file_bytes();

    let size = std::fs::metadata(path)
        .map_or(0, |m| usize::try_from(m.len()).unwrap_or(usize::MAX));

    // Fast path: single upload when the audio already fits.
    if size <= max_bytes {
        let mime = audio_mime_for_path(path);
        let audio = AudioInput { path, mime: &mime };
        let transcript = provider.transcribe(&audio, cfg.language.as_deref())?;
        return Ok((transcript, provider.provider_id().to_string()));
    }

    // Split path: ffmpeg segments → serial per-chunk ASR → concat.
    let size_mb = size as f64 / 1_048_576.0;
    let cap_mb = max_bytes as f64 / 1_048_576.0;
    emit(
        app,
        clip_id,
        Stage::Split,
        42,
        Some(&format!(
            "音频 {size_mb:.1} MB 超过 {} 单次上限 {cap_mb:.1} MB，自动分片",
            cfg.provider,
        )),
    );

    let chunk_secs = read_asr_chunk_seconds();
    let seq = SPLIT_DIR_SEQ.fetch_add(1, Ordering::Relaxed);
    let split_dir = app_temp_media_dir()
        .map_err(AppError::io)?
        .join(format!("asr_split_{clip_id}_{seq}"));
    std::fs::create_dir_all(&split_dir)
        .map_err(|e| AppError::io(format!("创建分片目录失败: {e}")))?;
    let _cleanup = SplitDirGuard(split_dir.clone());

    let segments = audio_split::split_audio_by_duration(app, path, chunk_secs, &split_dir)?;
    let total = segments.len();
    emit(
        app,
        clip_id,
        Stage::Split,
        45,
        Some(&format!("分片 {total} 段 · 每段约 {chunk_secs}s")),
    );

    let mut transcripts: Vec<String> = Vec::with_capacity(total);
    for seg in &segments {
        // Defensive cap check — ffmpeg produced the chunks so they should
        // fit, but bitrate anomalies (e.g. VBR spike from music content)
        // could in theory push one over. Surface a clear error rather
        // than letting the provider reject with a generic 413.
        let seg_size = std::fs::metadata(&seg.path)
            .map_or(0, |m| usize::try_from(m.len()).unwrap_or(usize::MAX));
        if seg_size > max_bytes {
            return Err(AppError::validation(format!(
                "分片 {}/{} 仍超过上传上限，请减小分片时长后重试",
                seg.index + 1,
                total,
            )));
        }

        let mime = audio_mime_for_path(&seg.path);
        let audio = AudioInput {
            path: &seg.path,
            mime: &mime,
        };
        let text = provider
            .transcribe(&audio, cfg.language.as_deref())
            .map_err(|e| {
                AppError::io(format!(
                    "分片 {}/{} 转录失败: {}",
                    seg.index + 1,
                    total,
                    e.message
                ))
            })?;
        transcripts.push(text);

        // Interpolate within the Asr range (45-80) so the UI reflects
        // per-chunk progress instead of jumping 45 → 80 on the last one.
        let done = seg.index + 1;
        let pct = 45u32
            + u32::try_from(((35_f64 * done as f64) / total as f64).round() as i64)
                .unwrap_or(35)
                .min(35);
        emit(
            app,
            clip_id,
            Stage::Asr,
            pct,
            Some(&format!("转录 {done}/{total}")),
        );
    }

    // Blank-line join preserves rough segment boundaries in the raw
    // transcript — the AI cleanup stage later reflows into proper prose.
    let joined = transcripts.join("\n\n");
    Ok((joined, provider.provider_id().to_string()))
}

fn audio_mime_for_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("m4a" | "mp4" | "aac") => "audio/mp4".into(),
        Some("mp3" | "mpga") => "audio/mpeg".into(),
        Some("webm") => "audio/webm".into(),
        Some("opus" | "ogg") => "audio/ogg".into(),
        Some("wav") => "audio/wav".into(),
        Some("flac") => "audio/flac".into(),
        _ => "application/octet-stream".into(),
    }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ASR config storage (keychain for secrets, app_kv for non-secret settings)
// ---------------------------------------------------------------------------

/// Whitelist of supported providers. Keeping the list here (not in
/// `asr_client.rs`) keeps the settings surface stable even if we experiment
/// with new providers behind a feature flag.
const SUPPORTED_PROVIDERS: &[&str] = &["openai", "deepgram", "siliconflow"];

/// Keychain account name for a provider's API key. Matches the namespace
/// we declare in `secrets::SERVICE` so users see `com.knoyoo.desktop` /
/// `asr_<provider>` pairs under Keychain Access.
fn keychain_account_for(provider: &str) -> String {
    format!("asr_{provider}")
}

/// INSERT-or-UPDATE a single KV entry.
fn set_kv_entry(
    conn: &rusqlite::Connection,
    key: &str,
    val: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO app_kv(key, val) VALUES(?1, ?2)
           ON CONFLICT(key) DO UPDATE SET val = excluded.val",
        rusqlite::params![key, val],
    )?;
    Ok(())
}

/// Idempotent migration of legacy ASR storage. Two legacy shapes:
///
/// 1. Very old: single flat `asr_api_key` keyed by `asr_provider`.
/// 2. Round-4: per-provider `asr_api_key__<provider>` rows in `app_kv`.
///
/// Both carried the raw API key in `SQLite` — exactly what we want to stop
/// doing. This moves every surviving key into the OS keychain and wipes
/// the DB rows. Non-secret settings (provider selection, `api_base`, model,
/// language) stay in `app_kv`.
fn migrate_asr_keys_to_keychain(conn: &rusqlite::Connection) -> Result<(), String> {
    // ── Shape 1 → Shape 2 first (so the rest of the function only has to
    //    handle one legacy layout).
    let legacy_provider = kv_get(conn, "asr_provider")?.unwrap_or_default();
    if !legacy_provider.is_empty() {
        if kv_get(conn, "asr_selected_provider")?
            .unwrap_or_default()
            .is_empty()
        {
            set_kv_entry(conn, "asr_selected_provider", &legacy_provider)
                .map_err(|e| e.to_string())?;
        }
        for (legacy_name, per_provider_name) in [
            ("asr_api_key", format!("asr_api_key__{legacy_provider}")),
            ("asr_api_base", format!("asr_api_base__{legacy_provider}")),
            ("asr_model", format!("asr_model__{legacy_provider}")),
        ] {
            let dest = kv_get(conn, &per_provider_name)?.unwrap_or_default();
            if dest.is_empty() {
                if let Some(val) = kv_get(conn, legacy_name)? {
                    if !val.is_empty() {
                        set_kv_entry(conn, &per_provider_name, &val)
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        conn.execute(
            "DELETE FROM app_kv WHERE key IN \
             ('asr_provider','asr_api_key','asr_api_base','asr_model')",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    // ── Shape 2: drop each `asr_api_key__<provider>` into the keychain,
    //    then delete the DB row. Only keys move — bases/models/language
    //    stay in app_kv.
    let mut rows = conn
        .prepare("SELECT key, val FROM app_kv WHERE key LIKE 'asr_api_key__%'")
        .map_err(|e| e.to_string())?;
    let legacy_pairs: Vec<(String, String)> = rows
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    drop(rows);

    for (db_key, value) in legacy_pairs {
        let provider = db_key
            .strip_prefix("asr_api_key__")
            .expect("LIKE filter guarantees prefix");
        if value.is_empty() {
            conn.execute("DELETE FROM app_kv WHERE key = ?1", [&db_key])
                .map_err(|e| e.to_string())?;
            continue;
        }
        // If the keychain already has a value, don't clobber it —
        // the user might have saved via the new UI before this legacy
        // row got cleaned up.
        let existing = secrets::get(&keychain_account_for(provider))
            .map_err(|e| e.to_string())?;
        if existing.is_none() {
            secrets::set(&keychain_account_for(provider), &value)
                .map_err(|e| e.to_string())?;
        }
        // Flag + 尾号 mirror so the settings panel renders without a
        // keychain probe after migration completes.
        set_kv_entry(conn, &format!("asr_configured__{provider}"), "true")
            .map_err(|e| e.to_string())?;
        set_kv_entry(
            conn,
            &format!("asr_key_hint__{provider}"),
            &secrets::key_last_four(&value),
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM app_kv WHERE key = ?1", [&db_key])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Non-secret per-provider state handed to the frontend. Raw API keys are
/// never part of this shape — the UI gets `configured` plus `key_hint`
/// (last 4 chars, computed live from the keychain for identification).
#[derive(Serialize, Debug, Default, Clone)]
pub struct AsrProviderState {
    pub configured: bool,
    pub api_base: String,
    pub model: String,
    /// Last four chars of the stored key. Empty when `configured` is
    /// false. Never persisted — computed on each `get_asr_config` call.
    pub key_hint: String,
}

/// Default chunk length when splitting long audio. 300s = 5 minutes, which
/// at mono/16kHz/64kbps mp3 is ≈ 2.4 MB per chunk — well under every
/// provider's single-upload cap while keeping total chunk count reasonable
/// for a 1-hour podcast (~12 chunks).
pub const DEFAULT_ASR_CHUNK_SECONDS: u32 = 300;
/// Minimum allowed chunk length. Below 60s the overhead of per-chunk ASR
/// requests starts to dominate; also some providers enforce a minimum
/// audio length.
const MIN_ASR_CHUNK_SECONDS: u32 = 60;
/// Maximum allowed chunk length. 900s at 64 kbps mp3 ≈ 7.2 MB, still well
/// under Whisper's 24.75 MB ceiling. We cap here so a mistyped value can't
/// inadvertently push a chunk over the provider limit.
const MAX_ASR_CHUNK_SECONDS: u32 = 900;

#[derive(Serialize, Debug, Default)]
pub struct AsrFullConfig {
    /// The currently active provider id (`""` if none picked yet).
    pub asr_provider: String,
    pub asr_language: String,
    /// Mirrors `providers[asr_provider].api_base` for the active edit form.
    pub asr_api_base: String,
    /// Mirrors `providers[asr_provider].model` for the active edit form.
    pub asr_model: String,
    /// Auto-split threshold and segment length for long-audio ASR. Shared
    /// across providers (the per-provider upload cap is a property of the
    /// provider itself and doesn't belong in user-editable config).
    pub asr_chunk_seconds: u32,
    pub providers: BTreeMap<String, AsrProviderState>,
}

/// Shape accepted from the frontend. Every field is optional so the panel
/// can send partial updates — e.g. flipping the selected provider without
/// touching the API key, or saving just the language preference.
#[derive(Deserialize, Debug, Default)]
pub struct AsrSetCfg {
    #[serde(default)]
    pub asr_provider: Option<String>,
    #[serde(default)]
    pub asr_language: Option<String>,
    /// Three-state semantics:
    ///   - `None`   → leave stored key alone
    ///   - `Some("")` → explicit delete (user hit 清除 + 保存)
    ///   - `Some("sk-...")` → replace stored key
    #[serde(default)]
    pub asr_api_key: Option<String>,
    #[serde(default)]
    pub asr_api_base: Option<String>,
    #[serde(default)]
    pub asr_model: Option<String>,
    #[serde(default)]
    pub asr_chunk_seconds: Option<u32>,
}

/// Build the flat `HashMap<String, String>` that `AsrConfig::from_map`
/// expects, pulling the active provider's key from the keychain and the
/// rest from `app_kv`. Only called from the transcription pipeline.
fn read_asr_config() -> Result<HashMap<String, String>, AppError> {
    let conn = open_db().map_err(AppError::database)?;
    migrate_asr_keys_to_keychain(&conn).map_err(AppError::database)?;

    let provider = kv_get(&conn, "asr_selected_provider")
        .map_err(AppError::database)?
        .unwrap_or_default();

    let mut out = HashMap::new();
    if !provider.is_empty() {
        out.insert("asr_provider".into(), provider.clone());

        if let Some(key) = secrets::get(&keychain_account_for(&provider))? {
            if !key.is_empty() {
                out.insert("asr_api_key".into(), key);
            }
        }

        for (suffix, flat_name) in [
            ("asr_api_base", "asr_api_base"),
            ("asr_model", "asr_model"),
        ] {
            let stored = kv_get(&conn, &format!("{suffix}__{provider}"))
                .map_err(AppError::database)?
                .unwrap_or_default();
            if !stored.is_empty() {
                out.insert(flat_name.into(), stored);
            }
        }
    }
    if let Some(lang) = kv_get(&conn, "asr_language").map_err(AppError::database)? {
        out.insert("asr_language".into(), lang);
    }
    Ok(out)
}

/// Read the user-configured chunk length for long-audio auto-split.
/// Falls back to `DEFAULT_ASR_CHUNK_SECONDS` if unset or out of range.
/// Kept as its own helper so `run_asr` can call it without touching the
/// provider-facing `HashMap` that `read_asr_config` returns.
fn read_asr_chunk_seconds() -> u32 {
    let Ok(conn) = open_db() else {
        return DEFAULT_ASR_CHUNK_SECONDS;
    };
    kv_get(&conn, "asr_chunk_seconds")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|n| (MIN_ASR_CHUNK_SECONDS..=MAX_ASR_CHUNK_SECONDS).contains(n))
        .unwrap_or(DEFAULT_ASR_CHUNK_SECONDS)
}

/// Write status + optional source. Swallows DB errors (logged) so a failing
/// status update doesn't mask the original pipeline error.
fn set_status(clip_id: i64, status: &str, error: &str, source: Option<&str>) {
    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(target = "transcribe", "open_db failed: {}", e);
            return;
        }
    };
    let res = if let Some(src) = source {
        conn.execute(
            "UPDATE web_clips
                SET transcription_status = ?1,
                    transcription_error = ?2,
                    transcription_source = ?3,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id = ?4",
            rusqlite::params![status, error, src, clip_id],
        )
    } else {
        conn.execute(
            "UPDATE web_clips
                SET transcription_status = ?1,
                    transcription_error = ?2,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id = ?3",
            rusqlite::params![status, error, clip_id],
        )
    };
    if let Err(e) = res {
        tracing::error!(target = "transcribe", clip_id, "status update failed: {}", e);
    }
}

fn update_clip_metadata(
    clip_id: i64,
    meta: &ytdlp::VideoMetadata,
) -> Result<(), AppError> {
    let conn = open_db().map_err(AppError::database)?;
    // Only fill empty fields — protects manual user edits on retry.
    conn.execute(
        "UPDATE web_clips
            SET title    = CASE WHEN title    = '' THEN ?1 ELSE title END,
                summary  = CASE WHEN summary  = '' THEN ?2 ELSE summary END,
                favicon  = CASE WHEN favicon  = '' THEN ?3 ELSE favicon END,
                audio_duration_sec = ?4,
                source_type = CASE WHEN source_type = 'article' THEN 'video' ELSE source_type END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ?5",
        rusqlite::params![
            meta.title,
            truncate(&meta.description, 2000),
            meta.thumbnail,
            i64::try_from(meta.duration_sec).unwrap_or(0),
            clip_id,
        ],
    )?;
    Ok(())
}

fn save_raw_transcript(clip_id: i64, transcript: &str) -> Result<(), AppError> {
    let conn = open_db().map_err(AppError::database)?;
    // Mirror raw → content for now so the UI has something visible. A later
    // slice plugs in `ai_clean_clip_inner(clip_id)` which rewrites `content`
    // to a cleaned Markdown version and leaves `raw_content` untouched for
    // the "查看原始" toggle.
    conn.execute(
        "UPDATE web_clips
            SET raw_content = ?1,
                content     = ?1,
                updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ?2",
        rusqlite::params![transcript, clip_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Create a placeholder clip for `url` and kick off the transcription
/// pipeline in the background. Returns the new `clip_id` so the frontend can
/// start listening to `transcribe://progress` events for it.
///
/// If a (non-deleted) clip already exists for `url`, we reuse its id and
/// just re-run the pipeline.
#[tauri::command]
pub fn import_video_clip(app: AppHandle, url: String) -> Result<i64, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.len() > 4096 {
        return Err("无效的 URL".into());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("仅支持 http/https 链接".into());
    }

    let conn = open_db()?;
    // Upsert a stub row. Using add_web_clip_no_autotag would kick off the
    // article-style text pipeline, which isn't what we want — the video
    // pipeline fills content itself from the transcript.
    conn.execute(
        "INSERT INTO web_clips (url, title, source_type, transcription_status)
             VALUES (?1, '', 'video', 'pending')
         ON CONFLICT(url) DO UPDATE SET
             source_type = 'video',
             transcription_status = 'pending',
             transcription_error = '',
             deleted_at = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        rusqlite::params![trimmed],
    )
    .map_err(|e| e.to_string())?;

    let clip_id: i64 = conn
        .query_row("SELECT id FROM web_clips WHERE url = ?1", [trimmed], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    let app_bg = app.clone();
    let url_bg = trimmed.to_string();
    std::thread::spawn(move || {
        run_pipeline(app_bg, clip_id, url_bg);
    });

    Ok(clip_id)
}

/// Re-run the pipeline for an existing clip. Used by the "重试" button in
/// the UI when a previous run landed in `transcription_status = 'failed'`.
#[tauri::command]
pub fn retry_transcription(app: AppHandle, clip_id: i64) -> Result<(), String> {
    let conn = open_db()?;
    let url: String = conn
        .query_row(
            "SELECT url FROM web_clips WHERE id = ?1 AND deleted_at IS NULL",
            [clip_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        run_pipeline(app, clip_id, url);
    });
    Ok(())
}

/// Read ASR config for the settings panel.
///
/// Security contract:
/// - API keys live in the OS keychain and NEVER reach the frontend. The
///   only signal the UI receives is a `configured: bool` per provider
///   derived from a keychain probe.
/// - Non-secret settings (active provider, `api_base`, model, language)
///   come from `app_kv` as usual.
#[tauri::command]
pub fn get_asr_config() -> Result<AsrFullConfig, String> {
    let conn = open_db()?;
    migrate_asr_keys_to_keychain(&conn)?;

    let active = kv_get(&conn, "asr_selected_provider")?.unwrap_or_default();
    let language = kv_get(&conn, "asr_language")?.unwrap_or_default();

    // Flags + 尾号 are mirrored into app_kv by `set_asr_config`, so we
    // read them straight from the DB without ever probing the keychain —
    // that kept triggering macOS authorization prompts every time the
    // user opened the settings tab (one per provider = 3 prompts).
    let mut providers: BTreeMap<String, AsrProviderState> = BTreeMap::new();
    for p in SUPPORTED_PROVIDERS {
        let configured = kv_get(&conn, &format!("asr_configured__{p}"))?
            .is_some_and(|v| v == "true");
        let key_hint = kv_get(&conn, &format!("asr_key_hint__{p}"))?.unwrap_or_default();
        let api_base = kv_get(&conn, &format!("asr_api_base__{p}"))?.unwrap_or_default();
        let model = kv_get(&conn, &format!("asr_model__{p}"))?.unwrap_or_default();
        providers.insert(
            (*p).to_string(),
            AsrProviderState {
                configured,
                api_base,
                model,
                key_hint,
            },
        );
    }

    let active_state = providers.get(&active).cloned().unwrap_or_default();
    let chunk_seconds = kv_get(&conn, "asr_chunk_seconds")?
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|n| (MIN_ASR_CHUNK_SECONDS..=MAX_ASR_CHUNK_SECONDS).contains(n))
        .unwrap_or(DEFAULT_ASR_CHUNK_SECONDS);
    Ok(AsrFullConfig {
        asr_provider: active,
        asr_language: language,
        asr_api_base: active_state.api_base,
        asr_model: active_state.model,
        asr_chunk_seconds: chunk_seconds,
        providers,
    })
}

/// Persist ASR config. Accepts optional fields so the settings panel can
/// send partial updates:
/// - `asr_provider` → writes the active selection (validated against
///   `SUPPORTED_PROVIDERS`).
/// - `asr_language` → shared across providers.
/// - `asr_api_base` / `asr_model` → written to the per-provider `app_kv`
///   slot keyed by `asr_provider` (or the currently selected provider).
/// - `asr_api_key` → written to the OS keychain under `asr_<provider>`.
///
/// Security contract:
/// - API keys are the only secret; everything else is plain config.
/// - `asr_api_key = Some("")` is the explicit delete command (user hit
///   清除 + 保存) — the keychain entry gets removed.
/// - `asr_api_key = None` leaves the stored key untouched. The settings
///   panel never round-trips key material back to the backend, so there's
///   no mask-detection step like earlier iterations.
#[tauri::command]
pub fn set_asr_config(cfg: AsrSetCfg) -> Result<(), String> {
    let conn = open_db()?;
    migrate_asr_keys_to_keychain(&conn)?;

    // 1. Active selection + shared language (non-secret).
    if let Some(p) = cfg.asr_provider.as_deref() {
        let trimmed = p.trim();
        if !trimmed.is_empty() && !SUPPORTED_PROVIDERS.contains(&trimmed) {
            return Err(format!("未知的 ASR 供应商: {trimmed}"));
        }
        set_kv_entry(&conn, "asr_selected_provider", trimmed).map_err(|e| e.to_string())?;
    }
    if let Some(lang) = cfg.asr_language.as_ref() {
        set_kv_entry(&conn, "asr_language", lang.trim()).map_err(|e| e.to_string())?;
    }
    if let Some(secs) = cfg.asr_chunk_seconds {
        if !(MIN_ASR_CHUNK_SECONDS..=MAX_ASR_CHUNK_SECONDS).contains(&secs) {
            return Err(format!(
                "分片时长必须在 {MIN_ASR_CHUNK_SECONDS} 到 {MAX_ASR_CHUNK_SECONDS} 秒之间"
            ));
        }
        set_kv_entry(&conn, "asr_chunk_seconds", &secs.to_string())
            .map_err(|e| e.to_string())?;
    }

    // 2. Per-provider writes need a target. Prefer the freshly-set
    //    selection; fall back to the stored one.
    let target = match cfg.asr_provider.as_deref() {
        Some(p) if !p.trim().is_empty() => p.trim().to_string(),
        _ => kv_get(&conn, "asr_selected_provider")?.unwrap_or_default(),
    };
    if target.is_empty() {
        // Nothing more to write — the panel was just saving language or
        // hadn't picked a provider yet.
        return Ok(());
    }

    if let Some(key) = cfg.asr_api_key.as_ref() {
        let account = keychain_account_for(&target);
        let trimmed = key.trim();
        if trimmed.is_empty() {
            secrets::delete(&account).map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM app_kv WHERE key = ?1",
                [format!("asr_configured__{target}")],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM app_kv WHERE key = ?1",
                [format!("asr_key_hint__{target}")],
            )
            .map_err(|e| e.to_string())?;
        } else {
            secrets::set(&account, trimmed).map_err(|e| e.to_string())?;
            // Mirror "is configured" + 尾号 into app_kv so the settings
            // screen never has to probe the keychain to render.
            set_kv_entry(&conn, &format!("asr_configured__{target}"), "true")
                .map_err(|e| e.to_string())?;
            set_kv_entry(
                &conn,
                &format!("asr_key_hint__{target}"),
                &secrets::key_last_four(trimmed),
            )
            .map_err(|e| e.to_string())?;
        }
    }
    if let Some(b) = cfg.asr_api_base.as_ref() {
        set_kv_entry(&conn, &format!("asr_api_base__{target}"), b.trim())
            .map_err(|e| e.to_string())?;
    }
    if let Some(m) = cfg.asr_model.as_ref() {
        set_kv_entry(&conn, &format!("asr_model__{target}"), m.trim())
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Emit + small utilities
// ---------------------------------------------------------------------------

fn emit(
    app: &AppHandle,
    clip_id: i64,
    stage: Stage,
    percent: u32,
    detail: Option<&str>,
) {
    let ev = ProgressEvent {
        clip_id,
        stage,
        percent: percent.min(100),
        detail: detail.map(ToString::to_string),
    };
    if let Err(e) = app.emit(PROGRESS_EVENT, &ev) {
        // Log at debug — emit failure means the frontend isn't subscribed,
        // which is fine for headless tests and shouldn't spam warn logs.
        tracing::debug!(target = "transcribe", "emit {} failed: {}", PROGRESS_EVENT, e);
    }
}

/// Char-boundary safe truncate (byte slicing would split multibyte chars).
fn truncate(s: &str, max_chars: usize) -> String {
    let mut out: String = s.chars().take(max_chars).collect();
    if out.len() < s.len() {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Migration: legacy app_kv keys → OS keychain ─────────────────────

    fn open_mem_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("mem db");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS app_kv (
               key TEXT PRIMARY KEY,
               val TEXT NOT NULL
             );",
        )
        .expect("schema");
        conn
    }

    fn insert_kv(conn: &rusqlite::Connection, key: &str, val: &str) {
        set_kv_entry(conn, key, val).expect("kv insert");
    }

    #[test]
    fn migration_moves_flat_legacy_key_into_keychain() {
        secrets::reset();
        let conn = open_mem_db();
        // Shape 1: the very first layout — single flat api_key keyed by
        // asr_provider.
        insert_kv(&conn, "asr_provider", "siliconflow");
        insert_kv(&conn, "asr_api_key", "sk-siliconflow-real-key");
        insert_kv(&conn, "asr_api_base", "https://custom.example");
        insert_kv(&conn, "asr_model", "custom-model");

        migrate_asr_keys_to_keychain(&conn).expect("migrate");

        // Key is gone from the database entirely — never ends up in any
        // per-provider slot, goes straight to the keychain.
        assert!(
            kv_get(&conn, "asr_api_key__siliconflow").unwrap().is_none(),
            "legacy key must not linger in app_kv after migration"
        );
        assert!(kv_get(&conn, "asr_api_key").unwrap().is_none());
        assert!(kv_get(&conn, "asr_provider").unwrap().is_none());

        assert_eq!(
            secrets::get("asr_siliconflow").unwrap().as_deref(),
            Some("sk-siliconflow-real-key")
        );

        // Non-secret settings keep living in app_kv.
        assert_eq!(
            kv_get(&conn, "asr_selected_provider").unwrap().as_deref(),
            Some("siliconflow")
        );
        assert_eq!(
            kv_get(&conn, "asr_api_base__siliconflow").unwrap().as_deref(),
            Some("https://custom.example")
        );
    }

    #[test]
    fn migration_moves_round4_per_provider_keys_into_keychain() {
        secrets::reset();
        let conn = open_mem_db();
        // Shape 2: round-4 layout already split per-provider, but still
        // in app_kv (plaintext in SQLite).
        insert_kv(&conn, "asr_selected_provider", "openai");
        insert_kv(&conn, "asr_api_key__openai", "sk-openai-real");
        insert_kv(&conn, "asr_api_key__siliconflow", "sk-sf-real");

        migrate_asr_keys_to_keychain(&conn).expect("migrate");

        assert!(kv_get(&conn, "asr_api_key__openai").unwrap().is_none());
        assert!(
            kv_get(&conn, "asr_api_key__siliconflow").unwrap().is_none()
        );
        assert_eq!(
            secrets::get("asr_openai").unwrap().as_deref(),
            Some("sk-openai-real")
        );
        assert_eq!(
            secrets::get("asr_siliconflow").unwrap().as_deref(),
            Some("sk-sf-real")
        );
    }

    #[test]
    fn migration_is_idempotent() {
        secrets::reset();
        let conn = open_mem_db();
        insert_kv(&conn, "asr_selected_provider", "openai");
        insert_kv(&conn, "asr_api_key__openai", "sk-openai-key");
        migrate_asr_keys_to_keychain(&conn).expect("1st pass");
        // Running a second time must not touch the keychain entry we
        // just planted, and must not reintroduce the DB row.
        migrate_asr_keys_to_keychain(&conn).expect("2nd pass");
        assert_eq!(
            secrets::get("asr_openai").unwrap().as_deref(),
            Some("sk-openai-key")
        );
        assert!(kv_get(&conn, "asr_api_key__openai").unwrap().is_none());
    }

    #[test]
    fn migration_does_not_clobber_existing_keychain_entry() {
        secrets::reset();
        let conn = open_mem_db();
        // User already saved a newer key via the post-migration UI. The
        // legacy row was left in app_kv by a stale migration run.
        secrets::set("asr_openai", "sk-newer-from-ui").unwrap();
        insert_kv(&conn, "asr_api_key__openai", "sk-stale-legacy");

        migrate_asr_keys_to_keychain(&conn).expect("migrate");

        assert_eq!(
            secrets::get("asr_openai").unwrap().as_deref(),
            Some("sk-newer-from-ui"),
            "newer keychain value must win"
        );
        assert!(
            kv_get(&conn, "asr_api_key__openai").unwrap().is_none(),
            "legacy DB row gets cleaned up even when we decline to overwrite"
        );
    }

    #[test]
    fn migration_no_op_on_fresh_install() {
        secrets::reset();
        let conn = open_mem_db();
        migrate_asr_keys_to_keychain(&conn).expect("migrate");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM app_kv", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        assert!(secrets::get("asr_openai").unwrap().is_none());
    }

    #[test]
    fn keychain_account_naming_is_stable() {
        // External contract — Keychain Access shows users entries by this
        // account name. Changing the format would strand existing secrets.
        assert_eq!(keychain_account_for("openai"), "asr_openai");
        assert_eq!(keychain_account_for("siliconflow"), "asr_siliconflow");
    }

    // ── Stage / progress serialisation ──────────────────────────────────

    #[test]
    fn stage_serializes_snake_case() {
        let v = serde_json::to_string(&Stage::SubtitleProbe).unwrap();
        assert_eq!(v, "\"subtitle_probe\"");
        let v = serde_json::to_string(&Stage::Asr).unwrap();
        assert_eq!(v, "\"asr\"");
    }

    #[test]
    fn progress_event_skips_none_detail() {
        let ev = ProgressEvent {
            clip_id: 7,
            stage: Stage::Download,
            percent: 25,
            detail: None,
        };
        let s = serde_json::to_string(&ev).unwrap();
        assert!(!s.contains("detail"), "expected detail omitted, got: {s}");
        assert!(s.contains("\"stage\":\"download\""));
        assert!(s.contains("\"percent\":25"));
    }

    #[test]
    fn progress_event_includes_some_detail() {
        let ev = ProgressEvent {
            clip_id: 7,
            stage: Stage::Asr,
            percent: 60,
            detail: Some("转录第 2/3 片".into()),
        };
        let s = serde_json::to_string(&ev).unwrap();
        assert!(s.contains("\"detail\":\"转录第 2/3 片\""));
    }

    #[test]
    fn truncate_handles_cjk() {
        assert_eq!(truncate("你好世界", 2), "你好…");
        assert_eq!(truncate("你好", 10), "你好");
        assert_eq!(truncate("", 3), "");
    }

    #[test]
    fn audio_mime_for_path_maps_common_formats() {
        assert_eq!(audio_mime_for_path(Path::new("/tmp/x.m4a")), "audio/mp4");
        assert_eq!(audio_mime_for_path(Path::new("/tmp/x.webm")), "audio/webm");
        assert_eq!(audio_mime_for_path(Path::new("/tmp/x.opus")), "audio/ogg");
        assert_eq!(audio_mime_for_path(Path::new("/tmp/x.MP3")), "audio/mpeg");
        assert_eq!(
            audio_mime_for_path(Path::new("/tmp/unknown")),
            "application/octet-stream"
        );
    }
}
