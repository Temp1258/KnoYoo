//! `media_items` CRUD commands + manual pipeline triggers.
//!
//! Pairs with `audio.rs`, which owns the *import* commands
//! (`import_audio_file` / `import_local_video_file`). This module is the
//! post-import side: listing, detail fetch, starring, trash, notes edit,
//! and manual re-runs of the AI pipeline stages.
//!
//! Shape mirrors the equivalent command set in `clips.rs` so the frontend
//! can swap `list_web_clips` for `list_media_items` with minimal
//! translation. Fields that don't apply to media (`url`, `favicon`,
//! `og_image`) are dropped; fields unique to media (`media_type`,
//! `file_path`, `audio_duration_sec`) are added.

use rusqlite::Row;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db::open_db;
use crate::transcribe::ClipTarget;

/// Row shape the frontend receives. Matches the column layout in `db.rs`
/// except `tags` is parsed from the stored JSON string and
/// `is_starred`/`is_read` are mapped to bool.
#[derive(Debug, Serialize)]
pub struct MediaItem {
    pub id: i64,
    pub media_type: String,
    pub title: String,
    pub file_path: String,
    pub file_hash: String,
    pub file_size: i64,
    pub audio_duration_sec: i64,
    pub content: String,
    pub raw_content: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub notes: String,
    pub transcription_status: String,
    pub transcription_error: String,
    pub transcription_source: String,
    pub source_language: String,
    pub translated_content: String,
    pub ai_status: String,
    pub ai_error: String,
    pub is_starred: bool,
    pub is_read: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

/// Whitelisted SELECT column list — single source of truth for field order
/// across every query in this module so `row_to_media_item` can index by
/// position without drifting.
const SELECT_COLS: &str = "id, media_type, title, file_path, file_hash, file_size,
    audio_duration_sec, content, raw_content, summary, tags, notes,
    transcription_status, transcription_error, transcription_source,
    source_language, translated_content, ai_status, ai_error,
    is_starred, is_read, created_at, updated_at, deleted_at";

fn row_to_media_item(row: &Row) -> rusqlite::Result<MediaItem> {
    // tags is stored as a JSON array string; fall back to empty Vec if the
    // row has legacy shape or a parse error. Never fail the row decode over
    // it — the UI can survive "no tags" but can't survive a 500.
    let tags_raw: String = row.get("tags").unwrap_or_default();
    let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();

    Ok(MediaItem {
        id: row.get("id")?,
        media_type: row.get("media_type")?,
        title: row.get("title")?,
        file_path: row.get("file_path")?,
        file_hash: row.get("file_hash")?,
        file_size: row.get("file_size")?,
        audio_duration_sec: row.get("audio_duration_sec")?,
        content: row.get("content")?,
        raw_content: row.get("raw_content")?,
        summary: row.get("summary")?,
        tags,
        notes: row.get("notes")?,
        transcription_status: row.get("transcription_status")?,
        transcription_error: row.get("transcription_error")?,
        transcription_source: row.get("transcription_source")?,
        source_language: row.get("source_language")?,
        translated_content: row.get("translated_content")?,
        ai_status: row.get("ai_status")?,
        ai_error: row.get("ai_error")?,
        is_starred: row.get::<_, i64>("is_starred")? != 0,
        is_read: row.get::<_, i64>("is_read")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

/// Filter accepted by `list_media_items`. All fields optional; omitted
/// fields are "no filter on this axis". Pagination caps are enforced —
/// `limit` above 500 is treated as 500 to keep a single IPC payload sane.
#[derive(Debug, Default, Deserialize)]
pub struct MediaFilter {
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(default)]
    pub is_starred: Option<bool>,
    #[serde(default)]
    pub is_read: Option<bool>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

const DEFAULT_LIST_LIMIT: i64 = 50;
const MAX_LIST_LIMIT: i64 = 500;

/// List active (non-trashed) media items with optional filters. Ordered by
/// `updated_at DESC` so the most recently touched items surface first.
#[tauri::command]
pub fn list_media_items(filter: Option<MediaFilter>) -> Result<Vec<MediaItem>, String> {
    let filter = filter.unwrap_or_default();
    let conn = open_db()?;

    let mut where_clauses: Vec<String> = vec!["deleted_at IS NULL".into()];
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(mt) = filter.media_type.as_deref().filter(|s| !s.is_empty()) {
        where_clauses.push(format!("media_type = ?{}", params.len() + 1));
        params.push(Box::new(mt.to_string()));
    }
    if let Some(starred) = filter.is_starred {
        where_clauses.push(format!("is_starred = ?{}", params.len() + 1));
        params.push(Box::new(i64::from(starred)));
    }
    if let Some(read) = filter.is_read {
        where_clauses.push(format!("is_read = ?{}", params.len() + 1));
        params.push(Box::new(i64::from(read)));
    }
    if let Some(tag) = filter.tag.as_deref().filter(|s| !s.is_empty()) {
        // Tag match: stored as a JSON array string; LIKE on "tag" handles
        // simple presence. Users typing a Chinese tag will match its
        // literal occurrence in the JSON, which is what they expect.
        where_clauses.push(format!("tags LIKE ?{}", params.len() + 1));
        params.push(Box::new(format!("%\"{tag}\"%")));
    }

    let limit = filter
        .limit
        .unwrap_or(DEFAULT_LIST_LIMIT)
        .clamp(1, MAX_LIST_LIMIT);
    let offset = filter.offset.unwrap_or(0).max(0);

    let where_sql = where_clauses.join(" AND ");
    let sql = format!(
        "SELECT {SELECT_COLS}
         FROM media_items
         WHERE {where_sql}
         ORDER BY updated_at DESC
         LIMIT ?{limit_pos} OFFSET ?{offset_pos}",
        limit_pos = params.len() + 1,
        offset_pos = params.len() + 2,
    );
    params.push(Box::new(limit));
    params.push(Box::new(offset));

    let params_refs: Vec<&dyn rusqlite::ToSql> =
        params.iter().map(std::convert::AsRef::as_ref).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params_refs), row_to_media_item)
        .map_err(|e| e.to_string())?;
    let items: Vec<MediaItem> = rows.filter_map(Result::ok).collect();
    Ok(items)
}

/// Single-item fetch. Includes trashed items so the trash page can show
/// full detail without a separate command.
#[tauri::command]
pub fn get_media_item(id: i64) -> Result<MediaItem, String> {
    let conn = open_db()?;
    let sql = format!("SELECT {SELECT_COLS} FROM media_items WHERE id = ?1");
    conn.query_row(&sql, [id], row_to_media_item)
        .map_err(|e| e.to_string())
}

/// Count active media items for a `media_type` (used by `NavSidebar` badges).
#[tauri::command]
pub fn count_media_items(media_type: Option<String>) -> Result<i64, String> {
    let conn = open_db()?;
    let n: i64 = if let Some(mt) = media_type.as_deref().filter(|s| !s.is_empty()) {
        conn.query_row(
            "SELECT COUNT(*) FROM media_items
             WHERE deleted_at IS NULL AND media_type = ?1",
            [mt],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM media_items WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    Ok(n)
}

#[tauri::command]
pub fn toggle_star_media_item(id: i64) -> Result<bool, String> {
    let conn = open_db()?;
    let new_val: i64 = {
        let current: i64 = conn
            .query_row(
                "SELECT is_starred FROM media_items WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        i64::from(current == 0)
    };
    conn.execute(
        "UPDATE media_items SET is_starred = ?1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?2",
        rusqlite::params![new_val, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(new_val != 0)
}

/// Idempotent "mark as read" — used when the detail drawer opens. Mirrors
/// `clips::mark_clip_read`: no-op if already read, no toggle.
#[tauri::command]
pub fn mark_media_item_read(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE media_items SET is_read = 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1 AND is_read = 0",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn toggle_read_media_item(id: i64) -> Result<bool, String> {
    let conn = open_db()?;
    let new_val: i64 = {
        let current: i64 = conn
            .query_row(
                "SELECT is_read FROM media_items WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        i64::from(current == 0)
    };
    conn.execute(
        "UPDATE media_items SET is_read = ?1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?2",
        rusqlite::params![new_val, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(new_val != 0)
}

/// Partial user-editable patch. All fields optional — callers send only
/// what they want to change. Body fields that would come from the AI
/// pipeline (`content`, `raw_content`) are intentionally excluded; edit
/// them would race the background pipeline and desync the cleaned/raw
/// pair. Mirrors the surface `update_web_clip` exposes for web clips.
#[derive(Deserialize, Debug)]
pub struct MediaItemUpdate {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

/// Returns the updated row so the UI can swap in fresh state without a
/// separate `get_media_item` round trip (matching `update_web_clip`).
#[tauri::command]
pub fn update_media_item(id: i64, patch: MediaItemUpdate) -> Result<MediaItem, String> {
    let conn = open_db()?;

    // Build the SET clause dynamically from present patch fields. Each
    // absent field simply isn't touched. All string caps match the same
    // ballpark clips.rs uses so a runaway paste can't bloat rows.
    let mut sets: Vec<&'static str> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(title) = patch.title {
        sets.push("title = ?");
        let capped: String = title.chars().take(1000).collect();
        params.push(Box::new(capped));
    }
    if let Some(summary) = patch.summary {
        sets.push("summary = ?");
        let capped: String = summary.chars().take(10_000).collect();
        params.push(Box::new(capped));
    }
    if let Some(tags) = patch.tags {
        sets.push("tags = ?");
        // Stable dedup + per-tag cap matches auto_tag_clip_inner so
        // backend-sanitised and user-edited tags live in the same shape.
        let sanitized: Vec<String> = {
            let mut out: Vec<String> = Vec::new();
            for t in tags {
                if out.len() >= 100 {
                    break;
                }
                let trimmed = t.trim();
                if trimmed.is_empty() || trimmed.chars().count() > 200 {
                    continue;
                }
                let owned = trimmed.to_string();
                if !out.contains(&owned) {
                    out.push(owned);
                }
            }
            out
        };
        let tags_json =
            serde_json::to_string(&sanitized).unwrap_or_else(|_| "[]".to_string());
        params.push(Box::new(tags_json));
    }

    if !sets.is_empty() {
        sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        let sql = format!(
            "UPDATE media_items SET {} WHERE id = ?",
            sets.join(", ")
        );
        params.push(Box::new(id));
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params.iter().map(std::convert::AsRef::as_ref).collect();
        conn.execute(&sql, rusqlite::params_from_iter(params_refs))
            .map_err(|e| e.to_string())?;
    }

    // Echo the updated row back so the frontend doesn't need a second IPC.
    let sql = format!("SELECT {SELECT_COLS} FROM media_items WHERE id = ?1");
    conn.query_row(&sql, [id], row_to_media_item)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_media_item_notes(id: i64, content: String) -> Result<(), String> {
    // Notes are inline on the row (contrast with clip_notes, which is a
    // separate table for web_clips). 100 KB hard cap — plenty for user
    // annotations, protects against runaway paste.
    let capped: String = content.chars().take(100_000).collect();
    let conn = open_db()?;
    conn.execute(
        "UPDATE media_items SET notes = ?1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?2",
        rusqlite::params![capped, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Soft-delete → trash bin. `deleted_at` timestamp doubles as the sort key
/// for the 30-day auto-purge the frontend can trigger via `empty_media_trash`.
#[tauri::command]
pub fn delete_media_item(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE media_items SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn restore_media_item(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE media_items SET deleted_at = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Hard-delete. We don't touch `file_path` on disk: the user kept their
/// file locally before importing (we never copied it), and a delete in
/// `KnoYoo` shouldn't reach out and remove a file from the user's
/// Downloads folder. Future: if/when we start *copying* imported files
/// into `app_data_dir/media/`, purge should delete those copies.
#[tauri::command]
pub fn purge_media_item(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM media_items WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Trash listing — media items with `deleted_at IS NOT NULL`, ordered by
/// most-recently trashed. Paginated like the main list.
#[tauri::command]
pub fn list_media_trash(limit: Option<i64>, offset: Option<i64>) -> Result<Vec<MediaItem>, String> {
    let conn = open_db()?;
    let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT);
    let offset = offset.unwrap_or(0).max(0);
    let sql = format!(
        "SELECT {SELECT_COLS}
         FROM media_items
         WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC
         LIMIT ?1 OFFSET ?2"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit, offset], row_to_media_item)
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command]
pub fn count_media_trash() -> Result<i64, String> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT COUNT(*) FROM media_items WHERE deleted_at IS NOT NULL",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Permanently drop every soft-deleted media item. Called from the "清空
/// 乐色" button on the trash page. Mirrors `clips::empty_trash`.
#[tauri::command]
pub fn empty_media_trash() -> Result<i64, String> {
    let conn = open_db()?;
    let affected = conn
        .execute(
            "DELETE FROM media_items WHERE deleted_at IS NOT NULL",
            [],
        )
        .map_err(|e| e.to_string())?;
    i64::try_from(affected).map_err(|e| e.to_string())
}

/// Re-run the transcription pipeline for a media item. Used by the "重试"
/// button after a previous run ended in `transcription_status = 'failed'`
/// and by the manual "重新转录" affordance in the detail drawer.
#[tauri::command]
pub fn retry_media_transcription(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = open_db()?;
    let (media_type, file_path): (String, String) = conn
        .query_row(
            "SELECT media_type, file_path FROM media_items
             WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    drop(conn);

    if file_path.is_empty() {
        return Err(
            "这条媒体没有保存原始文件路径（可能是老版本导入的），无法重新转录。请重新拖入文件。"
                .into(),
        );
    }
    let path = std::path::PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!(
            "原始文件已移动或删除：{file_path}。请重新导入。"
        ));
    }

    let target = ClipTarget::Media(id);
    let app_bg = app.clone();
    match media_type.as_str() {
        "audio" => {
            std::thread::spawn(move || {
                crate::transcribe::run_audio_pipeline(app_bg, target, path);
            });
        }
        "local_video" => {
            std::thread::spawn(move || {
                // For local video, re-run means re-extracting audio via
                // ffmpeg (the temp mp3 from the original run was purged).
                // We can't call the private `extract_audio_from_video` in
                // audio.rs from here, so the retry path for local_video
                // goes through import_local_video_file again under the
                // hood — which dedups via the file_hash UNIQUE index and
                // updates the existing row's transcription_status back to
                // 'pending' before spawning the pipeline.
                //
                // TODO: expose audio::extract_audio_from_video as crate-
                // public and call it directly here to avoid the dedup
                // round-trip. Not doing it now to keep the B.4 surface
                // minimal.
                let _ = crate::audio::import_local_video_file(
                    app_bg,
                    file_path.clone(),
                );
            });
        }
        other => {
            return Err(format!("未知的 media_type: {other}"));
        }
    }
    Ok(())
}

/// Manually trigger AI auto-tag for a media item. Used by the "让 AI 重新
/// 归类" action in the detail drawer when a user disagrees with the
/// auto-generated tags/summary.
#[tauri::command]
pub fn ai_auto_tag_media_item(id: i64) -> Result<(), String> {
    crate::clips::auto_tag_clip_inner(ClipTarget::Media(id))
}

/// Manually trigger AI translation for a media item. Same contract as
/// `clips::ai_translate_clip` but targets `media_items`.
#[tauri::command]
pub fn ai_translate_media_item(id: i64) -> Result<(), String> {
    crate::clips::ai_translate_clip_inner(ClipTarget::Media(id))
}
