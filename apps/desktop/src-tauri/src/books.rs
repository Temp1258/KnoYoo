use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

use crate::ai_client::{self, AiClientConfig};
use crate::db::{app_book_covers_dir, app_books_dir, app_data_dir, open_db};

// ── Models ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Book {
    pub id: i64,
    pub file_hash: String,
    pub title: String,
    pub author: String,
    pub publisher: String,
    pub published_year: Option<i64>,
    pub description: String,
    pub cover_path: String, // relative to app_data_dir
    pub file_path: String,  // relative to app_data_dir
    pub file_format: String,
    pub file_size: i64,
    pub page_count: Option<i64>,
    pub status: String,
    pub progress_percent: f64,
    pub rating: Option<i64>,
    pub notes: String,
    pub tags: Vec<String>,
    pub added_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub last_opened_at: Option<String>,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Default)]
struct BookMeta {
    title: String,
    author: String,
    publisher: String,
    published_year: Option<i64>,
    description: String,
    page_count: Option<i64>,
    cover: Option<(Vec<u8>, &'static str)>, // (bytes, ext)
}

#[derive(Debug, Deserialize, Default)]
pub struct BookPatch {
    pub title: Option<String>,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub published_year: Option<i64>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub progress_percent: Option<f64>,
    pub rating: Option<i64>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
}

const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024; // 500 MB hard cap
const MAX_TITLE_LEN: usize = 2048;
const MAX_NOTES_LEN: usize = 50_000;

const ALLOWED_STATUSES: &[&str] = &["want", "reading", "read", "dropped"];

// ── Helpers ───────────────────────────────────────────────────────────────

fn row_to_book(row: &rusqlite::Row) -> rusqlite::Result<Book> {
    let tags_json: String = row.get("tags")?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Book {
        id: row.get("id")?,
        file_hash: row.get("file_hash")?,
        title: row.get("title")?,
        author: row.get("author")?,
        publisher: row.get("publisher")?,
        published_year: row.get("published_year")?,
        description: row.get("description")?,
        cover_path: row.get("cover_path")?,
        file_path: row.get("file_path")?,
        file_format: row.get("file_format")?,
        file_size: row.get("file_size")?,
        page_count: row.get("page_count")?,
        status: row.get("status")?,
        progress_percent: row.get("progress_percent")?,
        rating: row.get("rating")?,
        notes: row.get("notes")?,
        tags,
        added_at: row.get("added_at")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        last_opened_at: row.get("last_opened_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn hex_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Infer image extension from magic bytes (no heavy image crate needed).
fn detect_image_ext(bytes: &[u8]) -> &'static str {
    if bytes.len() < 8 {
        return "bin";
    }
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "jpg"
    } else if bytes.starts_with(&[0x47, 0x49, 0x46]) {
        "gif"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "webp"
    } else {
        "bin"
    }
}

fn filename_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(std::string::ToString::to_string)
        .unwrap_or_else(|| "未命名".to_string())
}

fn year_from_date_string(s: &str) -> Option<i64> {
    s.get(..4).and_then(|y| y.parse().ok())
}

// ── EPUB extraction ──────────────────────────────────────────────────────

fn extract_epub(path: &Path) -> Result<BookMeta, String> {
    let mut doc = epub::doc::EpubDoc::new(path).map_err(|e| format!("EPUB 解析失败: {e}"))?;

    // In epub v2, mdata returns Option<&MetadataItem> where MetadataItem has a `value` String.
    let md = |key: &str| -> String {
        doc.mdata(key)
            .map(|item| item.value.clone())
            .unwrap_or_default()
    };

    let raw_title = md("title");
    let title = if raw_title.trim().is_empty() {
        filename_stem(path)
    } else {
        raw_title
    };
    let author = md("creator");
    let publisher = md("publisher");
    let description = md("description");
    let published_year = {
        let date = md("date");
        if date.is_empty() {
            None
        } else {
            year_from_date_string(&date)
        }
    };

    let cover = doc.get_cover().map(|(bytes, _mime)| {
        let ext = detect_image_ext(&bytes);
        (bytes, ext)
    });

    Ok(BookMeta {
        title: truncate_chars(&title, 500),
        author: truncate_chars(&author, 200),
        publisher: truncate_chars(&publisher, 200),
        published_year,
        description: truncate_chars(&description, 5000),
        page_count: None,
        cover,
    })
}

// ── PDF extraction ───────────────────────────────────────────────────────

/// Decode PDF metadata strings. PDFs use either PDFDocEncoding (Latin-1 subset)
/// or UTF-16BE with a BOM. We handle both; unknown bytes become U+FFFD.
fn decode_pdf_string(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let utf16: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&utf16)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

fn pdf_info_field(info: &lopdf::Dictionary, key: &[u8]) -> Option<String> {
    info.get(key)
        .ok()
        .and_then(|obj| obj.as_str().ok())
        .map(decode_pdf_string)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn extract_pdf(path: &Path) -> Result<BookMeta, String> {
    let doc = lopdf::Document::load(path).map_err(|e| format!("PDF 解析失败: {e}"))?;

    let info_dict: Option<lopdf::Dictionary> = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|obj| match obj {
            lopdf::Object::Reference(id) => doc.get_object(*id).ok().cloned(),
            other => Some(other.clone()),
        })
        .and_then(|obj| obj.as_dict().ok().cloned());

    let (title, author, publisher, published_year) = if let Some(info) = info_dict {
        let title = pdf_info_field(&info, b"Title").unwrap_or_else(|| filename_stem(path));
        let author = pdf_info_field(&info, b"Author").unwrap_or_default();
        let publisher = pdf_info_field(&info, b"Producer").unwrap_or_default();
        let year = pdf_info_field(&info, b"CreationDate")
            .and_then(|s| {
                // CreationDate often looks like "D:20230101120000Z00'00'"
                let stripped = s.trim_start_matches("D:");
                year_from_date_string(stripped)
            });
        (title, author, publisher, year)
    } else {
        (filename_stem(path), String::new(), String::new(), None)
    };

    // Page count — get_pages returns BTreeMap<u32, ObjectId>
    let page_count = i64::try_from(doc.get_pages().len()).ok();

    Ok(BookMeta {
        title: truncate_chars(&title, 500),
        author: truncate_chars(&author, 200),
        publisher: truncate_chars(&publisher, 200),
        published_year,
        description: String::new(),
        page_count,
        cover: None, // v1: generated placeholder on frontend
    })
}

fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

// ── Full-text extraction (for AI summary) ────────────────────────────────

/// Rough character budget to send to the LLM — ~8K chars ≈ 2-3K tokens for CN/EN
/// mix. Small enough for cheap summarization, large enough to capture the core
/// thesis of most non-fiction books (preface + intro + ch1).
const MAX_AI_TEXT_CHARS: usize = 8000;

/// Strip HTML into plain text for AI consumption. We don't need perfect
/// fidelity — paragraphs joined with newlines are enough for summarization.
fn html_to_text(html: &str) -> String {
    use scraper::{Html, Selector};
    let doc = Html::parse_document(html);
    // If the chapter has a body, walk that; otherwise fall back to whole doc.
    let root_sel = Selector::parse("body").ok();
    let body_iter = root_sel.as_ref().and_then(|s| doc.select(s).next());

    fn collect(el: &scraper::ElementRef) -> String {
        let noise = ["script", "style", "nav", "header", "footer", "aside", "svg"];
        let mut out = String::new();
        for child in el.children() {
            if let Some(e) = child.value().as_element() {
                let tag = e.name().to_lowercase();
                if noise.contains(&tag.as_str()) {
                    continue;
                }
                if let Some(er) = scraper::ElementRef::wrap(child) {
                    let sub = collect(&er);
                    if !sub.is_empty() {
                        out.push_str(&sub);
                        // Insert paragraph breaks after common block elements
                        if matches!(
                            tag.as_str(),
                            "p" | "div" | "br" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li"
                        ) {
                            out.push('\n');
                        }
                    }
                }
            } else if let Some(text) = child.value().as_text() {
                out.push_str(text);
            }
        }
        out
    }

    let raw = match body_iter {
        Some(body) => collect(&body),
        None => doc
            .root_element()
            .text()
            .collect::<Vec<_>>()
            .join(" "),
    };

    // Collapse whitespace runs, keep single newlines for paragraph separation.
    let mut cleaned = String::with_capacity(raw.len());
    let mut prev_blank = true;
    for line in raw.lines() {
        let t = line.trim();
        if t.is_empty() {
            if !prev_blank {
                cleaned.push('\n');
                prev_blank = true;
            }
        } else {
            cleaned.push_str(t);
            cleaned.push('\n');
            prev_blank = false;
        }
    }
    cleaned
}

fn extract_epub_text(path: &Path, budget: usize) -> Result<String, String> {
    let mut doc = epub::doc::EpubDoc::new(path).map_err(|e| format!("EPUB: {e}"))?;
    let total_chapters = doc.get_num_chapters();
    let mut out = String::with_capacity(budget);

    for i in 0..total_chapters {
        if out.chars().count() >= budget {
            break;
        }
        if !doc.set_current_chapter(i) {
            continue;
        }
        if let Some((html, _mime)) = doc.get_current_str() {
            let text = html_to_text(&html);
            if text.trim().is_empty() {
                continue;
            }
            out.push_str(&text);
            out.push_str("\n\n");
        }
    }

    Ok(out.chars().take(budget).collect())
}

fn extract_pdf_text(path: &Path, budget: usize) -> Result<String, String> {
    let doc = lopdf::Document::load(path).map_err(|e| format!("PDF: {e}"))?;
    let pages = doc.get_pages();
    // First N pages is usually enough for summary; cap to avoid slow scans.
    const MAX_PDF_PAGES: usize = 20;
    let page_numbers: Vec<u32> = pages.keys().copied().take(MAX_PDF_PAGES).collect();
    if page_numbers.is_empty() {
        return Ok(String::new());
    }
    let raw = doc
        .extract_text(&page_numbers)
        .map_err(|e| format!("PDF text: {e}"))?;
    Ok(raw.chars().take(budget).collect())
}

/// Return a plain-text slice of the book's contents (bounded by `budget`) for
/// feeding to the summarization LLM. Returns empty string on any failure so
/// the caller can still fall back to title-only prompting.
fn extract_book_text(file_rel: &str, file_format: &str, budget: usize) -> String {
    let abs = match app_data_dir() {
        Ok(d) => d.join(file_rel),
        Err(_) => return String::new(),
    };
    if !abs.exists() {
        return String::new();
    }
    let result = match file_format {
        "epub" => extract_epub_text(&abs, budget),
        "pdf" => extract_pdf_text(&abs, budget),
        _ => Ok(String::new()),
    };
    match result {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("extract_book_text({file_rel}): {e}");
            String::new()
        }
    }
}

// ── Command: add_book ────────────────────────────────────────────────────

#[tauri::command]
pub fn add_book(file_path: String) -> Result<Book, String> {
    let src = PathBuf::from(&file_path);
    if !src.exists() {
        return Err("文件不存在".to_string());
    }

    let file_size = fs::metadata(&src).map_err(|e| e.to_string())?.len();
    if file_size > MAX_FILE_SIZE {
        return Err(format!(
            "文件过大（{:.1} MB），上限 {} MB",
            file_size as f64 / 1_048_576.0,
            MAX_FILE_SIZE / 1_048_576
        ));
    }

    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    let format = match ext.as_str() {
        "epub" => "epub",
        "pdf" => "pdf",
        _ => return Err("仅支持 EPUB / PDF 格式".to_string()),
    };

    // Read + hash the file. Simple read_all is fine for typical book sizes.
    let bytes = fs::read(&src).map_err(|e| e.to_string())?;
    let hash = hex_sha256(&bytes);

    // Duplicate check — against BOTH active and trashed rows, with distinct messages.
    {
        let conn = open_db()?;
        let dup: Option<(String, Option<String>)> = conn
            .query_row(
                "SELECT title, deleted_at FROM books WHERE file_hash = ?1",
                [&hash],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        if let Some((t, deleted_at)) = dup {
            if deleted_at.is_some() {
                return Err(format!(
                    "《{t}》在回收站中，请先恢复或彻底清除后再添加"
                ));
            }
            return Err(format!("《{t}》已在图书角"));
        }
    }

    // Copy file into managed storage
    let dest_name = format!("{hash}.{ext}");
    let dest = app_books_dir()?.join(&dest_name);
    fs::write(&dest, &bytes).map_err(|e| format!("复制文件失败: {e}"))?;
    let file_rel = format!("books/{dest_name}");

    // Insert phase: anything that fails here must roll back the copied file
    // (and any cover we wrote). The inner fn returns Ok once the INSERT has
    // committed successfully.
    if let Err(e) = add_book_insert(hash.clone(), file_rel, format, file_size as i64, &dest) {
        if dest.exists() {
            if let Err(rm) = fs::remove_file(&dest) {
                tracing::warn!("rollback: remove book file failed: {}", rm);
            }
        }
        return Err(e);
    }

    // Fetch phase: the row is committed so a failure here should NOT delete
    // the book file — that would leave an orphan DB row pointing to nothing.
    // In practice the SELECT only fails on transient DB issues, and the caller
    // can recover by re-fetching via list_books / get_book.
    let conn = open_db()?;
    let book = conn
        .query_row(
            "SELECT * FROM books WHERE file_hash = ?1 AND deleted_at IS NULL",
            [&hash],
            row_to_book,
        )
        .map_err(|e| e.to_string())?;

    // Kick off AI summarization in the background so the drawer fills in on
    // its own. Silent best-effort: if AI isn't configured or the call fails,
    // the user still has a usable book record, and can retry manually.
    let book_id = book.id;
    std::thread::spawn(move || {
        if let Err(e) = ai_summarize_book(book_id) {
            tracing::info!("auto AI summary for book {} skipped: {}", book_id, e);
        }
    });

    Ok(book)
}

fn add_book_insert(
    hash: String,
    file_rel: String,
    format: &'static str,
    file_size: i64,
    dest: &Path,
) -> Result<(), String> {
    // Extract metadata + cover (fall back to filename on parse failure)
    let meta = match format {
        "epub" => extract_epub(dest).unwrap_or_else(|e| {
            tracing::warn!("EPUB metadata failed: {}", e);
            BookMeta {
                title: filename_stem(dest),
                ..BookMeta::default()
            }
        }),
        "pdf" => extract_pdf(dest).unwrap_or_else(|e| {
            tracing::warn!("PDF metadata failed: {}", e);
            BookMeta {
                title: filename_stem(dest),
                ..BookMeta::default()
            }
        }),
        _ => unreachable!(),
    };

    // Persist cover bytes if any. Keep a handle so we can clean up if INSERT
    // fails later.
    let cover_rel = match meta.cover {
        Some((cover_bytes, cover_ext)) => {
            let cover_name = format!("{hash}.{cover_ext}");
            let covers_dir = app_book_covers_dir().map_err(|e| {
                tracing::warn!("covers dir: {}", e);
                e
            })?;
            let cover_path = covers_dir.join(&cover_name);
            if let Err(e) = fs::write(&cover_path, &cover_bytes) {
                tracing::warn!("save cover failed: {}", e);
                String::new()
            } else {
                format!("book_covers/{cover_name}")
            }
        }
        None => String::new(),
    };

    let remove_cover = || {
        if cover_rel.is_empty() {
            return;
        }
        if let Ok(base) = app_data_dir() {
            let cover_abs = base.join(&cover_rel);
            if cover_abs.exists() {
                if let Err(e) = fs::remove_file(&cover_abs) {
                    tracing::warn!("rollback: remove cover failed: {}", e);
                }
            }
        }
    };

    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => {
            remove_cover();
            return Err(e);
        }
    };

    if let Err(e) = conn.execute(
        "INSERT INTO books (
            file_hash, title, author, publisher, published_year, description,
            cover_path, file_path, file_format, file_size, page_count
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            hash,
            meta.title,
            meta.author,
            meta.publisher,
            meta.published_year,
            meta.description,
            cover_rel,
            file_rel,
            format,
            file_size,
            meta.page_count,
        ],
    ) {
        remove_cover();
        return Err(format!("写入数据库失败：{e}"));
    }

    Ok(())
}

// ── Command: list_books ──────────────────────────────────────────────────

#[tauri::command]
pub fn list_books(status: Option<String>) -> Result<Vec<Book>, String> {
    let conn = open_db()?;
    let (query, params): (&str, Vec<Box<dyn rusqlite::ToSql>>) = match status.as_deref() {
        Some(s) if ALLOWED_STATUSES.contains(&s) => (
            "SELECT * FROM books WHERE deleted_at IS NULL AND status = ?1
             ORDER BY datetime(updated_at) DESC",
            vec![Box::new(s.to_string())],
        ),
        _ => (
            "SELECT * FROM books WHERE deleted_at IS NULL
             ORDER BY datetime(updated_at) DESC",
            vec![],
        ),
    };

    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let params_ref: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();
    let rows = stmt
        .query_map(params_ref.as_slice(), row_to_book)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// ── Command: get_book ────────────────────────────────────────────────────

#[tauri::command]
pub fn get_book(id: i64) -> Result<Book, String> {
    let conn = open_db()?;
    conn.query_row("SELECT * FROM books WHERE id = ?1", [id], row_to_book)
        .map_err(|e| e.to_string())
}

// ── Command: update_book ─────────────────────────────────────────────────

#[tauri::command]
pub fn update_book(id: i64, patch: BookPatch) -> Result<Book, String> {
    // Validate
    if let Some(ref t) = patch.title {
        if t.is_empty() || t.chars().count() > MAX_TITLE_LEN {
            return Err("标题长度不合法".to_string());
        }
    }
    if let Some(ref n) = patch.notes {
        if n.chars().count() > MAX_NOTES_LEN {
            return Err("笔记过长".to_string());
        }
    }
    if let Some(ref s) = patch.status {
        if !ALLOWED_STATUSES.contains(&s.as_str()) {
            return Err("非法状态".to_string());
        }
    }
    if let Some(p) = patch.progress_percent {
        if !(0.0..=100.0).contains(&p) {
            return Err("进度需在 0-100 之间".to_string());
        }
    }
    if let Some(r) = patch.rating {
        if !(1..=5).contains(&r) {
            return Err("评分需在 1-5 之间".to_string());
        }
    }
    if let Some(ref tags) = patch.tags {
        if tags.len() > 100 {
            return Err("标签过多".to_string());
        }
        if tags.iter().any(|t| t.chars().count() > 200) {
            return Err("单个标签过长".to_string());
        }
    }

    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Read current status for transition-time-stamping
    let prev_status: String = tx
        .query_row("SELECT status FROM books WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    macro_rules! set_field {
        ($col:literal, $val:expr) => {
            tx.execute(
                concat!(
                    "UPDATE books SET ",
                    $col,
                    " = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2"
                ),
                rusqlite::params![$val, id],
            )
            .map_err(|e| e.to_string())?;
        };
    }

    if let Some(v) = patch.title { set_field!("title", v); }
    if let Some(v) = patch.author { set_field!("author", v); }
    if let Some(v) = patch.publisher { set_field!("publisher", v); }
    if let Some(v) = patch.published_year { set_field!("published_year", v); }
    if let Some(v) = patch.description { set_field!("description", v); }
    if let Some(v) = patch.notes { set_field!("notes", v); }
    if let Some(v) = patch.progress_percent { set_field!("progress_percent", v); }
    if let Some(v) = patch.rating { set_field!("rating", v); }
    if let Some(v) = patch.tags {
        let json = serde_json::to_string(&v).unwrap_or_else(|_| "[]".to_string());
        set_field!("tags", json);
    }

    if let Some(new_status) = patch.status {
        set_field!("status", new_status.clone());

        // Auto-stamp transitions
        if prev_status != "reading" && new_status == "reading" {
            tx.execute(
                "UPDATE books SET started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                 WHERE id = ?1",
                [id],
            )
            .map_err(|e| e.to_string())?;
        }
        if prev_status != "read" && new_status == "read" {
            tx.execute(
                "UPDATE books SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                                  progress_percent = 100
                 WHERE id = ?1",
                [id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let book = tx
        .query_row("SELECT * FROM books WHERE id = ?1", [id], row_to_book)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(book)
}

// ── Commands: delete / restore / purge / trash ───────────────────────────

#[tauri::command]
pub fn delete_book(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE books SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn restore_book(id: i64) -> Result<Book, String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE books SET deleted_at = NULL,
                          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    conn.query_row("SELECT * FROM books WHERE id = ?1", [id], row_to_book)
        .map_err(|e| e.to_string())
}

/// Permanently delete the row AND the stored files (book + cover).
#[tauri::command]
pub fn purge_book(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    let (file_rel, cover_rel): (String, String) = conn
        .query_row(
            "SELECT file_path, cover_path FROM books WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM books WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;

    let base = app_data_dir()?;
    for rel in [file_rel, cover_rel] {
        if rel.is_empty() {
            continue;
        }
        let abs = base.join(&rel);
        if abs.exists() {
            if let Err(e) = fs::remove_file(&abs) {
                tracing::warn!("remove {} failed: {}", abs.display(), e);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn list_books_trash() -> Result<Vec<Book>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT * FROM books WHERE deleted_at IS NOT NULL
             ORDER BY datetime(deleted_at) DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_book).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn count_books_trash() -> Result<i64, String> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT COUNT(*) FROM books WHERE deleted_at IS NOT NULL",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn empty_books_trash() -> Result<i64, String> {
    let ids: Vec<i64> = {
        let conn = open_db()?;
        let mut stmt = conn
            .prepare("SELECT id FROM books WHERE deleted_at IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };
    let total = ids.len();
    let mut purged: i64 = 0;
    for id in ids {
        match purge_book(id) {
            Ok(()) => purged += 1,
            Err(e) => tracing::error!("purge book {} failed during empty_books_trash: {}", id, e),
        }
    }
    if (purged as usize) < total {
        tracing::warn!(
            "empty_books_trash: purged {}/{} rows; {} failed",
            purged,
            total,
            total - purged as usize
        );
    }
    Ok(purged)
}

#[tauri::command]
pub fn count_books() -> Result<i64, String> {
    let conn = open_db()?;
    conn.query_row("SELECT COUNT(*) FROM books WHERE deleted_at IS NULL", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

// ── Command: set_book_cover ──────────────────────────────────────────────

/// User provides a path to an image file; we copy it as the new cover.
#[tauri::command]
pub fn set_book_cover(id: i64, image_path: String) -> Result<Book, String> {
    let src = PathBuf::from(&image_path);
    if !src.exists() {
        return Err("图片不存在".to_string());
    }
    let bytes = fs::read(&src).map_err(|e| e.to_string())?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("封面图过大（>10MB）".to_string());
    }
    let ext = detect_image_ext(&bytes);
    if ext == "bin" {
        return Err("仅支持 PNG / JPG / GIF / WebP".to_string());
    }

    // Read existing hash + cover_path so we can clean up the old cover file.
    let (hash, old_cover_rel): (String, String) = {
        let conn = open_db()?;
        conn.query_row(
            "SELECT file_hash, cover_path FROM books WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?
    };

    let cover_name = format!("{hash}.{ext}");
    let cover_path = app_book_covers_dir()?.join(&cover_name);
    fs::write(&cover_path, &bytes).map_err(|e| e.to_string())?;
    let cover_rel = format!("book_covers/{cover_name}");

    let conn = open_db()?;
    conn.execute(
        "UPDATE books SET cover_path = ?1,
                          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
        rusqlite::params![cover_rel, id],
    )
    .map_err(|e| e.to_string())?;

    // Remove the previous cover file if it pointed to a different on-disk path
    // (e.g. jpg → png). If the path is identical we've just overwritten it.
    if !old_cover_rel.is_empty() && old_cover_rel != cover_rel {
        if let Ok(base) = app_data_dir() {
            let old_abs = base.join(&old_cover_rel);
            if old_abs.exists() {
                if let Err(e) = fs::remove_file(&old_abs) {
                    tracing::warn!("remove old cover {} failed: {}", old_cover_rel, e);
                }
            }
        }
    }

    conn.query_row("SELECT * FROM books WHERE id = ?1", [id], row_to_book)
        .map_err(|e| e.to_string())
}

// ── Command: read_book_cover ─────────────────────────────────────────────

/// Read a cover image and return it as a base64 data URL so the frontend can
/// render it via <img src> without needing tauri's asset protocol config.
/// Covers are small (< 1MB typical) so base64 overhead is acceptable.
#[tauri::command]
pub fn read_book_cover(relative: String) -> Result<String, String> {
    use base64::Engine;

    let base = app_data_dir()?;
    let abs = base.join(&relative);
    // Path-traversal guard: canonicalized path must remain under base.
    let canonical_abs = abs.canonicalize().map_err(|e| e.to_string())?;
    let canonical_base = base.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_abs.starts_with(&canonical_base) {
        return Err("非法路径".to_string());
    }

    let bytes = fs::read(&canonical_abs).map_err(|e| e.to_string())?;
    let mime = match detect_image_ext(&bytes) {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("未知图片格式".to_string()),
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

// ── Command: open_book_externally ────────────────────────────────────────

#[tauri::command]
pub fn open_book_externally(id: i64) -> Result<(), String> {
    let file_rel: String = {
        let conn = open_db()?;
        conn.query_row("SELECT file_path FROM books WHERE id = ?1", [id], |r| r.get(0))
            .map_err(|e| e.to_string())?
    };

    let abs = app_data_dir()?.join(&file_rel);
    if !abs.exists() {
        return Err("原文件缺失，可能已被移动或清理".to_string());
    }

    tauri_plugin_opener::open_path(abs.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("打开失败：{e}"))?;

    // Best-effort: update last_opened_at
    let conn = open_db()?;
    let _ = conn.execute(
        "UPDATE books SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [id],
    );

    Ok(())
}

// ── Command: ai_summarize_book ───────────────────────────────────────────

/// Use configured AI to generate a summary + tags for a book, based on its
/// title / author / description. Writes to `description` and `tags`.
#[tauri::command]
pub fn ai_summarize_book(id: i64) -> Result<(), String> {
    let (title, author, description, existing_tags, file_path, file_format): (
        String,
        String,
        String,
        String,
        String,
        String,
    ) = {
        let conn = open_db()?;
        conn.query_row(
            "SELECT title, author, description, tags, file_path, file_format
             FROM books WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
    };

    let cfg = {
        let conn = open_db()?;
        crate::db::read_ai_config(&conn)?
    };
    let config = AiClientConfig::from_map(&cfg).map_err(|e| format!("AI 未配置：{e}"))?;

    let existing: Vec<String> = serde_json::from_str(&existing_tags).unwrap_or_default();
    let existing_str = if existing.is_empty() {
        "（无）".to_string()
    } else {
        existing.join("、")
    };

    // Pull the actual book contents so the AI has something to read. Falls
    // back to empty string on any extraction failure — better a title-only
    // summary than no summary at all.
    let book_text = extract_book_text(&file_path, &file_format, MAX_AI_TEXT_CHARS);
    let desc_trim: String = description.chars().take(1500).collect();

    let system = format!(
        r#"你是一位专业的图书摘要助手。用户刚上传了一本书，请你**基于下面提供的正文节选**：

1. 用中文生成 3-4 句话的精准摘要，总结本书的核心主题、作者观点和亮点；
2. 提取 3-5 个关键词标签（主题、学科、适合读者等）。

用户该书已有的标签：{existing}
如与已有标签相关，优先复用以保持一致性。

严格返回 JSON，不要输出其他内容：
{{"summary":"...","tags":["..."]}}"#,
        existing = existing_str,
    );

    let mut user_parts: Vec<String> = Vec::new();
    user_parts.push(format!("书名：{title}"));
    if !author.is_empty() {
        user_parts.push(format!("作者：{author}"));
    }
    if !desc_trim.is_empty() {
        user_parts.push(format!("已有简介：{desc_trim}"));
    }
    if !book_text.trim().is_empty() {
        user_parts.push(format!("正文节选（开头约 {} 字）：\n---\n{}\n---", book_text.chars().count(), book_text));
    }
    let user = user_parts.join("\n\n");

    let messages = vec![
        serde_json::json!({"role": "system", "content": system}),
        serde_json::json!({"role": "user", "content": user}),
    ];

    let reply = ai_client::chat(&config, messages, 0.3).map_err(String::from)?;
    let json_str = crate::ai::extract_json(&reply).unwrap_or(reply);
    let parsed: serde_json::Value =
        serde_json::from_str(&json_str).map_err(|e| format!("解析 AI 响应失败：{e}"))?;

    let summary = parsed["summary"].as_str().unwrap_or("").to_string();
    let ai_tags: Vec<String> = parsed["tags"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    // Merge with existing tags (preserve order, dedup). AI must never clobber
    // tags the user deliberately set. Sanitize AI strings to match the limits
    // update_book enforces, so AI hallucinations can't inject invalid tags.
    let mut merged: Vec<String> = existing.clone();
    for raw in ai_tags {
        let t = raw.trim();
        if t.is_empty() || t.chars().count() > 200 {
            continue;
        }
        let owned = t.to_string();
        if !merged.contains(&owned) {
            merged.push(owned);
        }
    }
    merged.truncate(100);
    let tags_json = serde_json::to_string(&merged).unwrap_or_else(|_| "[]".to_string());

    let conn = open_db()?;
    conn.execute(
        "UPDATE books SET description = CASE WHEN ?1 <> '' THEN ?1 ELSE description END,
                          tags = ?2,
                          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?3",
        rusqlite::params![summary, tags_json, id],
    )
    .map_err(|e| e.to_string())?;

    tracing::info!("AI summarized book {} (tags: {} → {})", id, existing.len(), merged.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_image_ext_png() {
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00];
        assert_eq!(detect_image_ext(&png), "png");
    }

    #[test]
    fn detect_image_ext_jpg() {
        let jpg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
        assert_eq!(detect_image_ext(&jpg), "jpg");
    }

    #[test]
    fn detect_image_ext_unknown() {
        let junk = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
        assert_eq!(detect_image_ext(&junk), "bin");
    }

    #[test]
    fn decode_pdf_string_utf16be() {
        // "A" in UTF-16BE with BOM
        let bytes = [0xFE, 0xFF, 0x00, 0x41];
        assert_eq!(decode_pdf_string(&bytes), "A");
    }

    #[test]
    fn decode_pdf_string_latin1() {
        let bytes = b"Hello";
        assert_eq!(decode_pdf_string(bytes), "Hello");
    }

    #[test]
    fn year_from_date_ok() {
        assert_eq!(year_from_date_string("2023-01-02"), Some(2023));
        assert_eq!(year_from_date_string("20230102120000"), Some(2023));
        assert_eq!(year_from_date_string("xy"), None);
    }

    #[test]
    fn truncate_chars_handles_multibyte() {
        let s = "中文测试abcdef";
        assert_eq!(truncate_chars(s, 4), "中文测试");
    }
}
