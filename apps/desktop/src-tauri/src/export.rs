use crate::clips::{row_to_clip, WebClip};
use crate::db::{app_db_path, open_db};
use rusqlite::OptionalExtension;

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
            md.push_str(&format!("## My Notes\n\n{}\n\n", n));
        }
    }

    md.push_str("---\n\n");
    md.push_str(&clip.content);
    md.push_str(&format!("\n\n---\n*Source: [{}]({})*\n", clip.url, clip.url));

    md
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric()
                || c == '-'
                || c == '_'
                || c == ' '
                || ('\u{4e00}'..='\u{9fff}').contains(&c) // CJK Unified Ideographs
                || ('\u{3400}'..='\u{4dbf}').contains(&c) // CJK Extension A
                || ('\u{3000}'..='\u{303f}').contains(&c) // CJK Symbols
            {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .chars()
        .take(80)
        .collect();
    if cleaned.is_empty() { "untitled".to_string() } else { cleaned }
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

#[tauri::command]
#[allow(non_snake_case)]
pub fn export_collection_to_dir(collectionId: i64, dirPath: String) -> Result<u32, String> {
    let conn = open_db()?;
    std::fs::create_dir_all(&dirPath).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT w.* FROM web_clips w
             JOIN collection_clips cc ON w.id = cc.clip_id
             WHERE cc.collection_id = ?1
             ORDER BY cc.sort_order ASC, cc.added_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([collectionId], row_to_clip)
        .map_err(|e| e.to_string())?;

    let mut count = 0u32;
    for r in rows {
        let clip = r.map_err(|e| e.to_string())?;
        let note: Option<String> = conn
            .query_row(
                "SELECT content FROM clip_notes WHERE clip_id = ?1",
                [clip.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let md = clip_to_markdown(&clip, note.as_deref());
        let base = sanitize_filename(&clip.title);
        let mut filename = format!("{}.md", base);
        let mut counter = 1;
        // Use create_new to atomically avoid TOCTOU race
        let dir = std::path::Path::new(&dirPath);
        loop {
            let filepath = dir.join(&filename);
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&filepath)
            {
                Ok(mut file) => {
                    use std::io::Write;
                    file.write_all(md.as_bytes())
                        .map_err(|_| "导出失败：无法写入文件".to_string())?;
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    filename = format!("{}_{}.md", base, counter);
                    counter += 1;
                    if counter > 1000 {
                        return Err("导出失败：文件名冲突过多".to_string());
                    }
                }
                Err(_) => return Err("导出失败：无法创建文件".to_string()),
            }
        }
        count += 1;
    }
    Ok(count)
}

/// Export full database as a backup file using SQLite's online backup API.
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
