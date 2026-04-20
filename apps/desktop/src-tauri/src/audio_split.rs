//! FFmpeg-based audio splitter for long-audio ASR.
//!
//! Cloud ASR providers cap single-upload size (Whisper 25MB / Deepgram 100MB /
//! `SiliconFlow` 20MB). Anything larger has to be split upstream — that's
//! exactly what this module does. We go through ffmpeg's `segment` muxer
//! with a forced re-encode to mono 16 kHz 64 kbps MP3 so the chunk size
//! stays predictable regardless of the source codec / bitrate.
//!
//! Chunks land in a caller-provided `out_dir`. The caller owns lifetime
//! (typically a `WorkDirGuard` in the transcribe pipeline), so this module
//! doesn't install its own cleanup — that way repeated invocations don't
//! fight over the same scratch directory.

use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::error::AppError;

/// One chunk produced by `split_audio_by_duration`. `index` is 0-based in
/// source order — used both to display per-chunk progress ("转录 3/12")
/// and as a tiebreaker for stable concatenation.
#[derive(Debug)]
pub struct SegmentFile {
    pub path: PathBuf,
    pub index: usize,
}

/// Split `input` into a series of `segment_secs`-long MP3 chunks under
/// `out_dir`. The caller must ensure `out_dir` exists and is writable.
///
/// Output format is forced mono / 16 kHz / 64 kbps MP3 — the smallest
/// format every cloud ASR provider accepts. A 5-minute chunk at 64 kbps
/// is ≈ 2.4 MB, well under every provider's single-upload cap.
pub fn split_audio_by_duration(
    app: &AppHandle,
    input: &Path,
    segment_secs: u32,
    out_dir: &Path,
) -> Result<Vec<SegmentFile>, AppError> {
    if segment_secs == 0 {
        return Err(AppError::validation("分片时长必须大于 0"));
    }
    if !input.exists() {
        return Err(AppError::io(format!(
            "输入音频不存在: {}",
            input.display()
        )));
    }
    if !out_dir.exists() {
        return Err(AppError::io(format!(
            "分片输出目录不存在: {}",
            out_dir.display()
        )));
    }

    let input_str = input
        .to_str()
        .ok_or_else(|| AppError::io("音频路径含非 UTF-8 字符".to_string()))?;
    // `%03d` gives lexicographic order matching numeric order up to 999
    // chunks — that's >83 hours at a 5-minute segment, more than enough.
    let out_pattern = out_dir.join("chunk_%03d.mp3");
    let out_pattern_str = out_pattern
        .to_str()
        .ok_or_else(|| AppError::io("分片输出路径含非 UTF-8 字符".to_string()))?;

    let segment_time = segment_secs.to_string();
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
            input_str,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "64k",
            "-f",
            "segment",
            "-segment_time",
            &segment_time,
            // Each chunk starts at PTS 0, making per-chunk ASR calls
            // timestamp-clean if we ever want to emit SRT later.
            "-reset_timestamps",
            "1",
            "-y",
            out_pattern_str,
        ]);

    let (mut rx, _child) = cmd
        .spawn()
        .map_err(|e| AppError::io(format!("ffmpeg 启动失败: {e}")))?;

    let mut stderr_tail = String::new();
    let code = tauri::async_runtime::block_on(async {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line) => {
                    let s = String::from_utf8_lossy(&line);
                    if stderr_tail.len() < 4096 {
                        stderr_tail.push_str(&s);
                        stderr_tail.push('\n');
                    }
                }
                CommandEvent::Terminated(payload) => return payload.code,
                _ => {}
            }
        }
        None
    });

    match code {
        Some(0) => {}
        Some(c) => {
            return Err(AppError::io(format!(
                "ffmpeg 分片失败，退出码 {c}：{}",
                stderr_tail.trim()
            )))
        }
        None => return Err(AppError::io("ffmpeg 分片异常终止".to_string())),
    }

    // Collect produced chunks. ffmpeg writes them lazily into `out_dir`;
    // we enumerate to handle both the happy path and the edge case where
    // ffmpeg exited 0 but produced zero chunks (unusable input).
    let mut chunks: Vec<PathBuf> = std::fs::read_dir(out_dir)
        .map_err(|e| AppError::io(format!("读取分片目录失败: {e}")))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            let name = path.file_name()?.to_str()?;
            let ext_matches = path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("mp3"));
            if name.starts_with("chunk_") && ext_matches {
                Some(path)
            } else {
                None
            }
        })
        .collect();
    // File names `chunk_000.mp3 / chunk_001.mp3 / ...` sort lexicographically
    // in the same order as their numeric index because of the zero-padded
    // `%03d` format specifier.
    chunks.sort();

    if chunks.is_empty() {
        return Err(AppError::io(format!(
            "ffmpeg 未生成任何分片：{}",
            stderr_tail.trim()
        )));
    }

    let segs = chunks
        .into_iter()
        .enumerate()
        .map(|(index, path)| SegmentFile { path, index })
        .collect();
    Ok(segs)
}
