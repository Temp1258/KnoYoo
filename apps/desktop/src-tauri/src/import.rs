use serde::Serialize;

use crate::clips::NewClip;
use crate::db::open_db;
use scraper::{Html, Selector};

#[derive(Debug, Serialize)]
pub struct BookmarkEntry {
    pub url: String,
    pub title: String,
    pub folder: String,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub total: usize,
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
}

/// Maximum bookmark file size (50 MB).
const MAX_BOOKMARK_FILE_SIZE: u64 = 50 * 1024 * 1024;

/// Hard cap on number of entries parsed from a single file — protects against
/// pathological HTML bombs that would otherwise blow up memory before any
/// dedup/insertion happens. A real export from a mainstream browser rarely
/// exceeds a few thousand bookmarks.
const MAX_BOOKMARK_ENTRIES: usize = 10_000;

/// Parse a Netscape Bookmark File (Chrome/Firefox/Edge export format).
#[tauri::command]
pub fn parse_bookmark_file(path: String) -> Result<Vec<BookmarkEntry>, String> {
    let meta = std::fs::metadata(&path).map_err(|_| "无法读取文件".to_string())?;
    if meta.len() > MAX_BOOKMARK_FILE_SIZE {
        return Err("书签文件过大（最大 50 MB）".to_string());
    }
    let content = std::fs::read_to_string(&path).map_err(|_| "无法读取文件内容".to_string())?;
    let doc = Html::parse_document(&content);

    let a_sel = Selector::parse("a").map_err(|e| format!("Selector error: {e:?}"))?;
    let mut entries = Vec::new();

    for el in doc.select(&a_sel) {
        if entries.len() >= MAX_BOOKMARK_ENTRIES {
            tracing::warn!(
                "parse_bookmark_file: truncated at {} entries (file may be pathological)",
                MAX_BOOKMARK_ENTRIES
            );
            break;
        }

        let url = el.value().attr("href").unwrap_or("").to_string();
        // Use proper URL parsing rather than prefix-matching to block
        // javascript:/data:/file:/vbscript: and malformed URLs like "http:foo".
        if !crate::clips::is_http_url(&url) {
            continue;
        }
        let title = el.text().collect::<String>().trim().to_string();

        // Try to get folder from parent DL/DT structure
        let folder = el
            .parent()
            .and_then(|p| p.parent())
            .and_then(|dl| dl.prev_sibling())
            .and_then(|h3| {
                scraper::ElementRef::wrap(h3).map(|e| e.text().collect::<String>().trim().to_string())
            })
            .unwrap_or_default();

        entries.push(BookmarkEntry { url, title, folder });
    }

    Ok(entries)
}

/// Import bookmarks: parse file → dedupe → insert clips.
#[tauri::command]
#[allow(non_snake_case)]
pub fn import_bookmarks(path: String, fetchContent: bool) -> Result<ImportResult, String> {
    let entries = parse_bookmark_file(path)?;
    let total = entries.len();
    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;

    // Single connection for all dedup checks
    let conn = open_db()?;

    for entry in &entries {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM web_clips WHERE url = ?1",
                [&entry.url],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;

        if exists {
            skipped += 1;
            continue;
        }

        if fetchContent {
            match crate::html_extract::fetch_and_extract(&entry.url) {
                Ok(page) => {
                    let clip = NewClip {
                        url: entry.url.clone(),
                        title: if page.title.is_empty() { entry.title.clone() } else { page.title },
                        content: page.content,
                        raw_content: Some(page.raw_content),
                        source_type: Some("article".to_string()),
                        favicon: Some(page.favicon),
                        og_image: Some(page.og_image),
                    };
                    // Use no-autotag variant to avoid spawning a thread per import
                    match crate::clips::add_web_clip_no_autotag(clip) {
                        Ok(_) => imported += 1,
                        Err(_) => failed += 1,
                    }
                }
                Err(_) => {
                    let clip = NewClip {
                        url: entry.url.clone(),
                        title: entry.title.clone(),
                        content: String::new(),
                        raw_content: None,
                        source_type: Some("article".to_string()),
                        favicon: None,
                        og_image: None,
                    };
                    match crate::clips::add_web_clip_no_autotag(clip) {
                        Ok(_) => imported += 1,
                        Err(_) => failed += 1,
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        } else {
            // Quick import: insert directly using the same connection
            let result = conn.execute(
                "INSERT INTO web_clips (url, title, source_type) VALUES (?1, ?2, 'article')
                 ON CONFLICT(url) DO NOTHING",
                rusqlite::params![entry.url, entry.title],
            );
            match result {
                Ok(n) if n > 0 => imported += 1,
                Ok(_) => skipped += 1,
                Err(_) => failed += 1,
            }
        }
    }

    // Trigger batch auto-tagging in background for any newly imported clips
    if imported > 0 {
        std::thread::spawn(|| {
            if let Err(e) = crate::clips::ai_batch_retag_clips() {
                tracing::warn!("Post-import batch retag failed: {}", e);
            }
        });
    }

    Ok(ImportResult { total, imported, skipped, failed })
}
