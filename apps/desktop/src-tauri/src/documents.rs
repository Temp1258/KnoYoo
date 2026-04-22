//! `documents` CRUD + import pipeline.
//!
//! User-uploaded local text files (pdf / docx / md / txt) live in their
//! own table, independent of `web_clips` and `media_items`. The import
//! flow mirrors `books::add_book`:
//!   1. validate (existence, size, extension)
//!   2. stream-hash → dedup against active rows via partial UNIQUE index
//!   3. copy file into the managed `app_documents_dir()`
//!   4. parse text + TOC synchronously via `doc_extract` (fast on small
//!      files; pdf-heavy imports block for a few seconds but that's fine —
//!      the UI already shows a spinner on the drag-and-drop placeholder)
//!   5. INSERT the row with `ai_status = 'pending'`
//!   6. spawn a background thread that runs the shared clip AI pipeline
//!      (`ai_clean_clip_inner` + `auto_tag_clip_inner`) against
//!      `ClipTarget::Document(id)` — no translate step for documents in
//!      v1 (schema currently doesn't carry `source_language` /
//!      `translated_content`)
//!
//! CRUD surface parallels `media.rs` so the frontend's `DocumentsPage`
//! can crib directly from `MediaPage` patterns.

use std::path::{Path, PathBuf};

use rusqlite::Row;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::db::{app_documents_dir, open_db};
use crate::doc_extract;
use crate::transcribe::ClipTarget;

/// Hard cap on import file size (500 MB). Matches `books::add_book` so
/// pdf uploads have identical expectations across both entry points —
/// user can't accidentally get through the document dropzone what the
/// books dropzone rejects.
const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024;

/// Supported extensions. Order mirrors the product copy in
/// `BLUEPRINT.md`'s Phase C section (pdf / docx / md / txt).
const ALLOWED_EXTS: &[&str] = &["pdf", "docx", "md", "txt"];

/// Row shape the frontend receives. Tag list is parsed from the stored
/// JSON string so the UI never handles the raw `[\"…\"]` encoding.
#[derive(Debug, Serialize)]
pub struct Document {
    pub id: i64,
    pub title: String,
    pub file_path: String,
    pub file_hash: String,
    pub file_format: String,
    pub file_size: i64,
    pub word_count: i64,
    pub toc_json: String,
    pub content: String,
    pub raw_content: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub notes: String,
    pub ai_status: String,
    pub ai_error: String,
    pub is_starred: bool,
    pub is_read: bool,
    pub last_opened_at: Option<String>,
    pub added_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

/// Single source of truth for the SELECT column list — drifts between
/// the query and the row decoder caused silent field mis-mapping bugs in
/// clips.rs's history; centralize here so every query reads the same
/// columns in the same order.
const SELECT_COLS: &str = "id, title, file_path, file_hash, file_format,
    file_size, word_count, toc_json, content, raw_content, summary, tags,
    notes, ai_status, ai_error, is_starred, is_read,
    last_opened_at, added_at, updated_at, deleted_at";

fn row_to_document(row: &Row) -> rusqlite::Result<Document> {
    let tags_raw: String = row.get("tags").unwrap_or_default();
    let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
    Ok(Document {
        id: row.get("id")?,
        title: row.get("title")?,
        file_path: row.get("file_path")?,
        file_hash: row.get("file_hash")?,
        file_format: row.get("file_format")?,
        file_size: row.get("file_size")?,
        word_count: row.get("word_count")?,
        toc_json: row.get("toc_json")?,
        content: row.get("content")?,
        raw_content: row.get("raw_content")?,
        summary: row.get("summary")?,
        tags,
        notes: row.get("notes")?,
        ai_status: row.get("ai_status")?,
        ai_error: row.get("ai_error")?,
        is_starred: row.get::<_, i64>("is_starred")? != 0,
        is_read: row.get::<_, i64>("is_read")? != 0,
        last_opened_at: row.get("last_opened_at")?,
        added_at: row.get("added_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

/// Streaming SHA-256 — identical reasoning to `audio::hex_sha256_file`:
/// a 400 MB PDF read via `fs::read` peaks at ~400 MB RAM on the import
/// thread. Chunked reads keep memory flat.
fn hex_sha256_file(path: &Path) -> Result<String, String> {
    use std::io::Read as _;
    let file = std::fs::File::open(path).map_err(|e| format!("打开文件失败: {e}"))?;
    let mut reader = std::io::BufReader::with_capacity(64 * 1024, file);
    let mut hasher = Sha256::new();
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

/// Filename stem without extension, falling back to a generic label so
/// empty-stem files (e.g. `.pdf`) still get a usable title. User can
/// rename later.
fn filename_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "未命名文档".to_string())
}

// ── Tauri commands ─────────────────────────────────────────────────────

/// Import a local document file. Returns the new `document_id` so the
/// frontend can deep-link into the detail view while the AI pipeline
/// runs in the background.
#[tauri::command]
#[allow(non_snake_case)]
pub fn import_document(app: AppHandle, filePath: String) -> Result<i64, String> {
    let src = PathBuf::from(&filePath);
    if !src.exists() {
        return Err("文件不存在".into());
    }
    let meta = std::fs::metadata(&src).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("所选路径不是文件".into());
    }
    let size = meta.len();
    if size > MAX_FILE_SIZE {
        return Err(format!(
            "文件过大（{:.1} MB），上限 {} MB",
            size as f64 / 1_048_576.0,
            MAX_FILE_SIZE / 1_048_576
        ));
    }

    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(format!(
            "不支持的文档格式 .{ext}（仅支持 pdf / docx / md / txt）"
        ));
    }

    let hash = hex_sha256_file(&src)?;

    // Duplicate check (active rows only; soft-deleted rows are excluded
    // by the partial UNIQUE index so re-import after trash is allowed).
    {
        let conn = open_db()?;
        let dup: Option<(i64, String, Option<String>)> = conn
            .query_row(
                "SELECT id, title, deleted_at FROM documents WHERE file_hash = ?1",
                [&hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        if let Some((_id, t, deleted_at)) = dup {
            if deleted_at.is_some() {
                return Err(format!(
                    "《{t}》在乐色中，请先恢复或彻底清除后再导入"
                ));
            }
            return Err(format!("《{t}》已在文档"));
        }
    }

    // Copy into managed storage so future re-parses / exports don't
    // depend on the original file location.
    let dest_name = format!("{hash}.{ext}");
    let dest = app_documents_dir()?.join(&dest_name);
    std::fs::copy(&src, &dest).map_err(|e| format!("复制文件失败: {e}"))?;
    let file_rel = format!("documents/{dest_name}");

    // Parse text + TOC synchronously. Small files (md/txt) are instant;
    // large PDFs can take a couple seconds but that's no worse than the
    // books.rs import path the user is already used to.
    let extract = match doc_extract::extract(&dest, &ext) {
        Ok(e) => e,
        Err(e) => {
            // Roll back the file copy so the next retry doesn't dedup-
            // reject based on a row we didn't insert.
            let _ = std::fs::remove_file(&dest);
            return Err(format!("解析失败：{e}"));
        }
    };

    let title = filename_stem(&src);
    let file_size_i64 = i64::try_from(size).unwrap_or(i64::MAX);
    let word_count_i64 = i64::from(extract.word_count);

    let conn = open_db()?;
    conn.execute(
        "INSERT INTO documents
            (title, file_path, file_hash, file_format, file_size, word_count,
             toc_json, content, raw_content, ai_status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 'pending')",
        rusqlite::params![
            title,
            file_rel,
            hash,
            ext,
            file_size_i64,
            word_count_i64,
            extract.toc_json,
            extract.text,
        ],
    )
    .map_err(|e| {
        // Roll back file on failed INSERT.
        let _ = std::fs::remove_file(&dest);
        e.to_string()
    })?;
    let document_id = conn.last_insert_rowid();
    drop(conn);

    // Kick off the background AI pipeline: cleanup + auto-tag. Bounded
    // to a detached thread so import_document returns immediately.
    let _ = app;
    std::thread::spawn(move || {
        let target = ClipTarget::Document(document_id);
        if let Err(e) = crate::clips::ai_clean_clip_inner(target) {
            tracing::warn!(
                target = "documents",
                id = document_id,
                "AI cleanup skipped: {}",
                e
            );
        }
        if let Err(e) = crate::clips::auto_tag_clip_inner(target) {
            tracing::warn!(
                target = "documents",
                id = document_id,
                "auto-tag failed: {}",
                e
            );
            // Record failure so the UI can surface a retry affordance,
            // matching the books.rs ai_status convention.
            let _ = crate::db::open_db().map(|c| {
                c.execute(
                    "UPDATE documents SET ai_status = 'failed', ai_error = ?1,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE id = ?2",
                    rusqlite::params![e.clone(), document_id],
                )
            });
            return;
        }
        // Mark ok — auto_tag was the last stage; cleanup failing is a
        // soft warning already (we fall back to raw text).
        let _ = crate::db::open_db().map(|c| {
            c.execute(
                "UPDATE documents SET ai_status = 'ok',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE id = ?1 AND ai_status <> 'failed'",
                [document_id],
            )
        });
    });

    Ok(document_id)
}

// ── Filter / list / detail ────────────────────────────────────────────

#[derive(Debug, Default, Deserialize)]
pub struct DocumentFilter {
    #[serde(default)]
    pub file_format: Option<String>,
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

#[tauri::command]
pub fn list_documents(filter: Option<DocumentFilter>) -> Result<Vec<Document>, String> {
    let filter = filter.unwrap_or_default();
    let conn = open_db()?;

    let mut where_clauses: Vec<String> = vec!["deleted_at IS NULL".into()];
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(f) = filter.file_format.as_deref().filter(|s| !s.is_empty()) {
        where_clauses.push(format!("file_format = ?{}", params.len() + 1));
        params.push(Box::new(f.to_string()));
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
        where_clauses.push(format!("tags LIKE ?{}", params.len() + 1));
        params.push(Box::new(format!("%\"{tag}\"%")));
    }

    let limit = filter.limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT);
    let offset = filter.offset.unwrap_or(0).max(0);

    let where_sql = where_clauses.join(" AND ");
    let sql = format!(
        "SELECT {SELECT_COLS}
         FROM documents
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
        .query_map(rusqlite::params_from_iter(params_refs), row_to_document)
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command]
pub fn get_document(id: i64) -> Result<Document, String> {
    let conn = open_db()?;
    let sql = format!("SELECT {SELECT_COLS} FROM documents WHERE id = ?1");
    conn.query_row(&sql, [id], row_to_document)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn count_documents(file_format: Option<String>) -> Result<i64, String> {
    let conn = open_db()?;
    let n: i64 = if let Some(f) = file_format.as_deref().filter(|s| !s.is_empty()) {
        conn.query_row(
            "SELECT COUNT(*) FROM documents
             WHERE deleted_at IS NULL AND file_format = ?1",
            [f],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    Ok(n)
}

// ── Read / star / mark / update ───────────────────────────────────────

#[tauri::command]
pub fn toggle_star_document(id: i64) -> Result<bool, String> {
    let conn = open_db()?;
    let current: i64 = conn
        .query_row(
            "SELECT is_starred FROM documents WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let new_val = i64::from(current == 0);
    conn.execute(
        "UPDATE documents SET is_starred = ?1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?2",
        rusqlite::params![new_val, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(new_val != 0)
}

#[tauri::command]
pub fn toggle_read_document(id: i64) -> Result<bool, String> {
    let conn = open_db()?;
    let current: i64 = conn
        .query_row(
            "SELECT is_read FROM documents WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let new_val = i64::from(current == 0);
    conn.execute(
        "UPDATE documents SET is_read = ?1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?2",
        rusqlite::params![new_val, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(new_val != 0)
}

/// Idempotent "mark as read" plus refresh `last_opened_at` — used by the
/// detail drawer's auto-read behaviour.
#[tauri::command]
pub fn mark_document_read(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE documents SET
            is_read = 1,
            last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            updated_at    = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize, Debug)]
pub struct DocumentUpdate {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[tauri::command]
pub fn update_document(id: i64, patch: DocumentUpdate) -> Result<Document, String> {
    let conn = open_db()?;

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
        let tags_json = serde_json::to_string(&sanitized).unwrap_or_else(|_| "[]".to_string());
        params.push(Box::new(tags_json));
    }

    if !sets.is_empty() {
        sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        let sql = format!("UPDATE documents SET {} WHERE id = ?", sets.join(", "));
        params.push(Box::new(id));
        let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(std::convert::AsRef::as_ref).collect();
        conn.execute(&sql, rusqlite::params_from_iter(refs))
            .map_err(|e| e.to_string())?;
    }

    let sql = format!("SELECT {SELECT_COLS} FROM documents WHERE id = ?1");
    conn.query_row(&sql, [id], row_to_document)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_document_notes(id: i64, content: String) -> Result<(), String> {
    let capped: String = content.chars().take(100_000).collect();
    let conn = open_db()?;
    conn.execute(
        "UPDATE documents SET notes = ?1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?2",
        rusqlite::params![capped, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Trash ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn delete_document(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE documents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn restore_document(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE documents SET deleted_at = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Hard-delete: removes the row AND the managed file on disk. Mirrors
/// `books::purge_book` — we own the file once import copied it into
/// `app_documents_dir/`, so purge must release the disk space too.
#[tauri::command]
pub fn purge_document(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    let file_rel: Option<String> = conn
        .query_row(
            "SELECT file_path FROM documents WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .ok();
    conn.execute("DELETE FROM documents WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if let Some(rel) = file_rel {
        if let Ok(base) = crate::db::app_data_dir() {
            let abs = base.join(&rel);
            if abs.exists() {
                if let Err(e) = std::fs::remove_file(&abs) {
                    tracing::warn!(
                        "purge_document: file cleanup ({:?}) failed: {}",
                        abs,
                        e
                    );
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_document_trash(limit: Option<i64>, offset: Option<i64>) -> Result<Vec<Document>, String> {
    let conn = open_db()?;
    let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT);
    let offset = offset.unwrap_or(0).max(0);
    let sql = format!(
        "SELECT {SELECT_COLS}
         FROM documents
         WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC
         LIMIT ?1 OFFSET ?2"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit, offset], row_to_document)
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command]
pub fn count_document_trash() -> Result<i64, String> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT COUNT(*) FROM documents WHERE deleted_at IS NOT NULL",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Permanently drop every soft-deleted document AND its file on disk.
#[tauri::command]
pub fn empty_document_trash() -> Result<i64, String> {
    let conn = open_db()?;
    // Collect file paths first so we can clean up disk after the DELETE.
    let mut stmt = conn
        .prepare("SELECT file_path FROM documents WHERE deleted_at IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let files: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    drop(stmt);

    let affected = conn
        .execute("DELETE FROM documents WHERE deleted_at IS NOT NULL", [])
        .map_err(|e| e.to_string())?;

    if let Ok(base) = crate::db::app_data_dir() {
        for rel in files {
            let abs = base.join(&rel);
            if abs.exists() {
                let _ = std::fs::remove_file(&abs);
            }
        }
    }
    i64::try_from(affected).map_err(|e| e.to_string())
}

// ── Manual AI triggers ────────────────────────────────────────────────

/// Re-run the AI pipeline (cleanup + auto-tag) for a single document.
/// Used by a "让 AI 重新归类" button in the detail drawer.
#[tauri::command]
pub fn retry_document_ai(id: i64) -> Result<(), String> {
    std::thread::spawn(move || {
        let target = ClipTarget::Document(id);
        let _ = crate::clips::ai_clean_clip_inner(target);
        let _ = crate::clips::auto_tag_clip_inner(target);
        let _ = crate::db::open_db().map(|c| {
            c.execute(
                "UPDATE documents SET ai_status = 'ok', ai_error = '',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE id = ?1",
                [id],
            )
        });
    });
    Ok(())
}

#[tauri::command]
pub fn ai_auto_tag_document(id: i64) -> Result<(), String> {
    crate::clips::auto_tag_clip_inner(ClipTarget::Document(id))
}

// ── Cross-type movement (Phase C.11) ──────────────────────────────────
//
// Documents and books share pdf as a common format but nothing else
// (books accept epub; documents accept docx/md/txt). Conversion is
// gated to `file_format = 'pdf'` on both sides — attempting to move a
// docx to books or an epub to documents returns an actionable error
// the UI can turn into a toast.
//
// The file itself is **copied** (not moved) between `app_documents_dir`
// and `app_books_dir`. Two reasons:
//   1. The source row is soft-deleted (goes to trash) rather than hard-
//      deleted. The user might restore it; its `file_path` must keep
//      resolving until purge.
//   2. Sharing a single file between two live rows would couple their
//      lifecycles; purging either would rug-pull the other.
// The cost is one PDF's worth of disk for the duration of the source's
// trash retention. Acceptable.

/// Read file bytes + basic metadata for a managed source path (rel path
/// under `app_data_dir`). Returns Err with a user-facing message when the
/// file is missing — the row's `file_path` pointed at a vanished file.
fn read_managed_file(file_rel: &str) -> Result<Vec<u8>, String> {
    let base = crate::db::app_data_dir()?;
    let abs = base.join(file_rel);
    if !abs.exists() {
        return Err(format!("原始文件已丢失：{file_rel}"));
    }
    std::fs::read(&abs).map_err(|e| format!("读取原文件失败: {e}"))
}

/// Move a document to the books library. Only works for pdf — other
/// formats (docx / md / txt) aren't valid book formats and return an
/// error. Returns the new `book_id` so the UI can navigate there.
#[tauri::command]
pub fn convert_document_to_book(document_id: i64) -> Result<i64, String> {
    let conn = open_db()?;

    // Read source document + early-reject non-pdf.
    let (title, file_format, file_hash, file_rel): (String, String, String, String) = conn
        .query_row(
            "SELECT title, file_format, file_hash, file_path FROM documents
             WHERE id = ?1 AND deleted_at IS NULL",
            [document_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| format!("找不到文档：{e}"))?;
    if file_format != "pdf" {
        return Err(format!(
            "只有 PDF 格式可以移动到书籍（当前：{file_format}）"
        ));
    }

    // Check books doesn't already have this file_hash active.
    let existing_book: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, title FROM books
             WHERE file_hash = ?1 AND deleted_at IS NULL",
            [&file_hash],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    if let Some((_id, t)) = existing_book {
        return Err(format!("《{t}》已在书籍"));
    }

    // Copy physical file — see module comment for why we copy not move.
    let bytes = read_managed_file(&file_rel)?;
    let file_size = i64::try_from(bytes.len()).unwrap_or(i64::MAX);
    let dest_name = format!("{file_hash}.pdf");
    let dest = crate::db::app_books_dir()?.join(&dest_name);
    std::fs::write(&dest, &bytes).map_err(|e| format!("写入 books 目录失败: {e}"))?;
    let book_file_rel = format!("books/{dest_name}");

    // INSERT into books; AI metadata fills in on the pending background
    // run. Soft-delete the document in the same DB call sequence —
    // this isn't wrapped in an explicit transaction since a mid-sequence
    // crash would leave the file on disk but no row referencing it
    // (cleaned up at next empty-trash).
    let insert = conn.execute(
        "INSERT INTO books
            (file_hash, title, file_path, file_format, file_size, ai_status)
         VALUES (?1, ?2, ?3, 'pdf', ?4, 'pending')",
        rusqlite::params![file_hash, title, book_file_rel, file_size],
    );
    if let Err(e) = insert {
        let _ = std::fs::remove_file(&dest);
        return Err(format!("插入书籍失败: {e}"));
    }
    let book_id = conn.last_insert_rowid();

    conn.execute(
        "UPDATE documents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;

    tracing::info!(
        "convert document {} → book {} ({})",
        document_id,
        book_id,
        title
    );
    Ok(book_id)
}

/// Move a book to documents. Only works for pdf books — epub isn't a
/// document format in v1 and returns an error. Returns the new
/// `document_id` so the UI can navigate there.
#[tauri::command]
pub fn convert_book_to_document(book_id: i64) -> Result<i64, String> {
    let conn = open_db()?;

    let (title, file_format, file_hash, file_rel): (String, String, String, String) = conn
        .query_row(
            "SELECT title, file_format, file_hash, file_path FROM books
             WHERE id = ?1 AND deleted_at IS NULL",
            [book_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| format!("找不到书籍：{e}"))?;
    if file_format != "pdf" {
        return Err(format!(
            "只有 PDF 格式可以移动到文档（当前：{file_format}）"
        ));
    }

    let existing_doc: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, title FROM documents
             WHERE file_hash = ?1 AND deleted_at IS NULL",
            [&file_hash],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    if let Some((_id, t)) = existing_doc {
        return Err(format!("《{t}》已在文档"));
    }

    let bytes = read_managed_file(&file_rel)?;
    let file_size = i64::try_from(bytes.len()).unwrap_or(i64::MAX);
    let dest_name = format!("{file_hash}.pdf");
    let dest = app_documents_dir()?.join(&dest_name);
    std::fs::write(&dest, &bytes).map_err(|e| format!("写入 documents 目录失败: {e}"))?;
    let doc_file_rel = format!("documents/{dest_name}");

    // Parse text synchronously — same as import_document does — so the
    // new document row is immediately useful (search, AI summary).
    let extract = match crate::doc_extract::extract(&dest, "pdf") {
        Ok(e) => e,
        Err(e) => {
            let _ = std::fs::remove_file(&dest);
            return Err(format!("PDF 文本抽取失败: {e}"));
        }
    };
    let word_count_i64 = i64::from(extract.word_count);

    let insert = conn.execute(
        "INSERT INTO documents
            (title, file_path, file_hash, file_format, file_size, word_count,
             toc_json, content, raw_content, ai_status)
         VALUES (?1, ?2, ?3, 'pdf', ?4, ?5, ?6, ?7, ?7, 'pending')",
        rusqlite::params![
            title,
            doc_file_rel,
            file_hash,
            file_size,
            word_count_i64,
            extract.toc_json,
            extract.text,
        ],
    );
    if let Err(e) = insert {
        let _ = std::fs::remove_file(&dest);
        return Err(format!("插入文档失败: {e}"));
    }
    let document_id = conn.last_insert_rowid();

    conn.execute(
        "UPDATE books SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1",
        [book_id],
    )
    .map_err(|e| e.to_string())?;

    // Kick off doc AI pipeline in background (clean + auto-tag).
    std::thread::spawn(move || {
        let target = ClipTarget::Document(document_id);
        let _ = crate::clips::ai_clean_clip_inner(target);
        let _ = crate::clips::auto_tag_clip_inner(target);
        let _ = crate::db::open_db().map(|c| {
            c.execute(
                "UPDATE documents SET ai_status = 'ok',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE id = ?1 AND ai_status <> 'failed'",
                [document_id],
            )
        });
    });

    tracing::info!(
        "convert book {} → document {} ({})",
        book_id,
        document_id,
        title
    );
    Ok(document_id)
}
