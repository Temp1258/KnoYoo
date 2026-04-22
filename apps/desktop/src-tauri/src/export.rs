use crate::clips::{row_to_clip, WebClip};
use crate::db::{app_db_path, open_db};
use rusqlite::OptionalExtension;

// ─── Phase B.7: media_items export ────────────────────────────────────
// `export_media_item_to_file` mirrors `export_clip_to_file` but pulls from
// `media_items` and uses its inline `notes` column (no separate
// `clip_notes` round-trip). YAML frontmatter swaps `url` / `source_type`
// for `media_type` / `file_path` / `file_hash` so the exported markdown
// is self-describing even without a remembering reader.

/// Escape a string for use in YAML double-quoted values.
fn yaml_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn clip_to_markdown(clip: &WebClip, note: Option<&str>) -> String {
    let tags_str = clip
        .tags
        .iter()
        .map(|t| format!("\"{}\"", yaml_escape(t)))
        .collect::<Vec<_>>()
        .join(", ");

    let mut md = format!(
        "---\ntitle: \"{}\"\nurl: \"{}\"\ntags: [{}]\nsource_type: \"{}\"\nsaved_at: \"{}\"\n---\n\n# {}\n\n",
        yaml_escape(&clip.title),
        yaml_escape(&clip.url),
        tags_str,
        yaml_escape(&clip.source_type),
        clip.created_at,
        clip.title,
    );

    if !clip.summary.is_empty() {
        md.push_str(&format!("> **AI Summary:** {}\n\n", clip.summary));
    }

    if let Some(n) = note {
        if !n.is_empty() {
            md.push_str(&format!("## My Notes\n\n{n}\n\n"));
        }
    }

    md.push_str("---\n\n");
    md.push_str(&clip.content);
    md.push_str(&format!("\n\n---\n*Source: [{}]({})*\n", clip.url, clip.url));

    md
}

/// Validate that a path is a regular file target (not a symlink to sensitive location).
fn validate_export_path(path: &std::path::Path) -> Result<(), String> {
    if path.file_name().is_none() {
        return Err("无效的文件路径".to_string());
    }
    // Block writes to symlinks (prevents symlink attacks)
    if path.is_symlink() {
        return Err("不能导出到符号链接".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn export_clip_to_file(id: i64, path: String) -> Result<(), String> {
    let dest = std::path::Path::new(&path);
    validate_export_path(dest)?;

    let conn = open_db()?;
    let clip = conn
        .query_row("SELECT * FROM web_clips WHERE id = ?1", [id], row_to_clip)
        .map_err(|e| e.to_string())?;

    let note: Option<String> = conn
        .query_row(
            "SELECT content FROM clip_notes WHERE clip_id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let md = clip_to_markdown(&clip, note.as_deref());
    std::fs::write(dest, md).map_err(|_| "导出失败：无法写入文件".to_string())
}

fn media_item_to_markdown(
    title: &str,
    media_type: &str,
    file_path: &str,
    file_hash: &str,
    tags_json: &str,
    summary: &str,
    transcription_source: &str,
    source_language: &str,
    notes: &str,
    created_at: &str,
    content: &str,
) -> String {
    // tags is persisted as a JSON array string; parse + re-render in the
    // YAML shape so the exported file matches the clip export format.
    let tags: Vec<String> = serde_json::from_str(tags_json).unwrap_or_default();
    let tags_yaml = tags
        .iter()
        .map(|t| format!("\"{}\"", yaml_escape(t)))
        .collect::<Vec<_>>()
        .join(", ");

    let type_label = if media_type == "audio" {
        "音频"
    } else if media_type == "local_video" {
        "本地视频"
    } else {
        media_type
    };

    let mut md = format!(
        "---\n\
         title: \"{title}\"\n\
         media_type: \"{media_type}\"\n\
         file_path: \"{file_path}\"\n\
         file_hash: \"{file_hash}\"\n\
         tags: [{tags_yaml}]\n\
         saved_at: \"{created_at}\"\n\
         ---\n\n\
         # {title_h1}\n\n\
         *类型：{type_label}*\n\n",
        title = yaml_escape(title),
        media_type = yaml_escape(media_type),
        file_path = yaml_escape(file_path),
        file_hash = yaml_escape(file_hash),
        title_h1 = title,
    );

    if !summary.is_empty() {
        md.push_str(&format!("> **AI 摘要：** {summary}\n\n"));
    }
    if !transcription_source.is_empty() {
        let tlabel = if transcription_source == "subtitle" {
            "字幕".to_string()
        } else if let Some(id) = transcription_source.strip_prefix("asr:") {
            format!("ASR · {id}")
        } else {
            transcription_source.to_string()
        };
        md.push_str(&format!("*转录来源：{tlabel}*  "));
    }
    if !source_language.is_empty() {
        md.push_str(&format!("*源语言：{source_language}*"));
    }
    if !transcription_source.is_empty() || !source_language.is_empty() {
        md.push_str("\n\n");
    }

    if !notes.is_empty() {
        md.push_str(&format!("## 我的笔记\n\n{notes}\n\n"));
    }

    md.push_str("---\n\n");
    md.push_str(content);
    md.push('\n');
    md
}

#[tauri::command]
pub fn export_media_item_to_file(id: i64, path: String) -> Result<(), String> {
    let dest = std::path::Path::new(&path);
    validate_export_path(dest)?;

    let conn = open_db()?;
    let (
        title,
        media_type,
        file_path,
        file_hash,
        tags,
        summary,
        transcription_source,
        source_language,
        notes,
        created_at,
        content,
    ): (
        String, String, String, String, String, String, String, String,
        String, String, String,
    ) = conn
        .query_row(
            "SELECT title, media_type, file_path, file_hash, tags, summary,
                    transcription_source, source_language, notes, created_at, content
             FROM media_items WHERE id = ?1",
            [id],
            |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                    r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?,
                    r.get(10)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let md = media_item_to_markdown(
        &title, &media_type, &file_path, &file_hash, &tags,
        &summary, &transcription_source, &source_language, &notes,
        &created_at, &content,
    );
    std::fs::write(dest, md).map_err(|_| "导出失败：无法写入文件".to_string())
}

/// Export full database as a backup file using `SQLite`'s online backup API.
/// This is safe against concurrent writes and produces a consistent snapshot.
#[tauri::command]
pub fn export_full_database(path: String) -> Result<(), String> {
    let dest = std::path::Path::new(&path);

    if dest.file_name().is_none() || dest.is_dir() {
        return Err("无效的导出路径".to_string());
    }
    if let Some(parent) = dest.parent() {
        if !parent.exists() {
            return Err("目标目录不存在".to_string());
        }
    }

    let src_conn = open_db()?;
    let mut dst_conn =
        rusqlite::Connection::open(dest).map_err(|_| "备份失败：无法创建目标文件".to_string())?;

    let backup = rusqlite::backup::Backup::new(&src_conn, &mut dst_conn)
        .map_err(|_| "备份失败：无法初始化备份".to_string())?;
    backup
        .run_to_completion(100, std::time::Duration::from_millis(50), None)
        .map_err(|_| "备份失败：写入中断".to_string())?;

    tracing::info!("Database backup exported to: {}", path);
    Ok(())
}

/// Import (restore) full database from a backup file.
/// Replaces the current database with the backup.
#[tauri::command]
pub fn import_full_database(path: String) -> Result<(), String> {
    let src = std::path::Path::new(&path);
    if !src.exists() {
        return Err("备份文件不存在".to_string());
    }

    // Validate the backup is a valid SQLite database
    // Open in read-only mode to prevent triggers from executing
    let test_conn = rusqlite::Connection::open_with_flags(
        src,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| {
        tracing::error!("Failed to open backup file: {}", e);
        "无效的备份文件".to_string()
    })?;

    // Integrity check
    let result: String = test_conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| {
            tracing::error!("Backup integrity check failed: {}", e);
            "备份文件损坏".to_string()
        })?;
    if result != "ok" {
        tracing::error!("Backup integrity: {}", result);
        return Err("备份文件完整性检查失败".to_string());
    }

    // Verify expected tables exist to confirm it's a KnoYoo database
    let has_clips: bool = test_conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='web_clips'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if !has_clips {
        return Err("备份文件不是有效的 KnoYoo 数据库".to_string());
    }
    drop(test_conn);

    let db_path = app_db_path()?;

    // Create a safety backup of current database before replacing
    let safety_backup = db_path.with_extension("db.bak");
    if db_path.exists() {
        std::fs::copy(&db_path, &safety_backup).map_err(|e| {
            tracing::error!("Safety backup failed: {}", e);
            "创建安全备份失败".to_string()
        })?;
    }

    // Replace current database with the backup
    std::fs::copy(src, &db_path).map_err(|e| {
        tracing::error!("Database restore failed: {}", e);
        "恢复失败".to_string()
    })?;

    // The backup's `*_configured__*` / `*_key_hint__*` rows describe the
    // SOURCE machine's keychain — they're meaningless here. If we left
    // them, the settings panel would show "已配置 · 尾号 xxxx" for keys
    // the current keychain doesn't hold, and the pipeline would fail on
    // first use. Clear them so the user sees "未配置" and knows to
    // re-enter, matching the toast message in SettingsPage.
    if let Ok(conn) = crate::db::open_db() {
        let _ = conn.execute(
            "DELETE FROM app_kv WHERE \
                key LIKE 'ai_configured__%' OR key LIKE 'ai_key_hint__%' OR \
                key LIKE 'asr_configured__%' OR key LIKE 'asr_key_hint__%'",
            [],
        );
    }

    tracing::info!("Database restored from: {}", path);
    Ok(())
}
