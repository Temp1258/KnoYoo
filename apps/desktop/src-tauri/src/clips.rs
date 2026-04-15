use serde::{Deserialize, Serialize};

use crate::ai_client::{self, AiClientConfig};
use crate::db::open_db;

// ── Helpers ──────────────────────────────────────────────────────────────

/// Escape special characters in SQLite LIKE patterns.
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Reject any URL whose scheme isn't http/https. Protects the UI from
/// clickable XSS via `<a href={clip.url}>` when the URL is e.g. `javascript:`.
/// Also blocks `file:`, `data:`, `chrome://`, `vbscript:`, etc.
pub(crate) fn is_http_url(s: &str) -> bool {
    match url::Url::parse(s) {
        Ok(u) => matches!(u.scheme(), "http" | "https"),
        Err(_) => false,
    }
}

// ── Models ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WebClip {
    pub id: i64,
    pub url: String,
    pub title: String,
    /// The user-facing readable content. For new clips this starts as the
    /// first-pass scraper output and gets overwritten by the AI-cleaned
    /// version in stage 2 of the ingestion pipeline.
    pub content: String,
    /// The full HTML-stripped dump of the page, preserved as a fallback so
    /// the UI can offer a "查看原始" toggle even after AI cleanup. Empty for
    /// clips imported before the 3-stage pipeline existed.
    pub raw_content: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub source_type: String,
    pub favicon: String,
    pub og_image: String,
    pub is_read: bool,
    pub is_starred: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    /// Empty for non-video clips. For video clips: `pending | downloading |
    /// transcribing | cleaning | completed | failed`.
    #[serde(default)]
    pub transcription_status: String,
    #[serde(default)]
    pub transcription_error: String,
    /// Provenance tag: `subtitle | asr:openai | asr:deepgram | asr:siliconflow`.
    #[serde(default)]
    pub transcription_source: String,
    /// Video duration in seconds; 0 for non-video clips.
    #[serde(default)]
    pub audio_duration_sec: i64,
}

#[derive(Debug, Deserialize)]
pub struct NewClip {
    pub url: String,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub raw_content: Option<String>,
    pub source_type: Option<String>,
    pub favicon: Option<String>,
    pub og_image: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────

pub(crate) fn row_to_clip(row: &rusqlite::Row) -> rusqlite::Result<WebClip> {
    let tags_json: String = row.get("tags")?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    // raw_content was added in a migration; older rows read as empty string
    // thanks to the column's DEFAULT ''.
    let raw_content: String = row.get("raw_content").unwrap_or_default();
    Ok(WebClip {
        id: row.get("id")?,
        url: row.get("url")?,
        title: row.get("title")?,
        content: row.get("content")?,
        raw_content,
        summary: row.get("summary")?,
        tags,
        source_type: row.get("source_type")?,
        favicon: row.get("favicon")?,
        og_image: row.get("og_image")?,
        is_read: row.get::<_, i64>("is_read")? != 0,
        is_starred: row.get::<_, i64>("is_starred")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
        // Transcription columns were added in a migration; older DBs without
        // the columns surface as empty / 0 thanks to the default-on-missing
        // pattern (unwrap_or_default) we already use for raw_content.
        transcription_status: row
            .get::<_, String>("transcription_status")
            .unwrap_or_default(),
        transcription_error: row
            .get::<_, String>("transcription_error")
            .unwrap_or_default(),
        transcription_source: row
            .get::<_, String>("transcription_source")
            .unwrap_or_default(),
        audio_duration_sec: row
            .get::<_, i64>("audio_duration_sec")
            .unwrap_or_default(),
    })
}

// ── Commands ──────────────────────────────────────────────────────────────

/// Maximum allowed size for clip content (500 KB) to prevent DoS via oversized payloads.
const MAX_CONTENT_LEN: usize = 512_000;

/// Internal: insert a clip without triggering auto-tag. Used by import paths.
pub(crate) fn add_web_clip_no_autotag(clip: NewClip) -> Result<WebClip, String> {
    if clip.url.is_empty() || clip.url.len() > 4096 {
        return Err("无效的 URL".to_string());
    }
    if !is_http_url(&clip.url) {
        return Err("仅支持 http/https 链接".to_string());
    }
    if clip.title.len() > 2048 {
        return Err("标题过长".to_string());
    }
    if clip.content.len() > MAX_CONTENT_LEN {
        return Err("内容过长".to_string());
    }

    let conn = open_db()?;
    let source_type = clip.source_type.unwrap_or_else(|| "article".to_string());
    let favicon = clip.favicon.unwrap_or_default();
    let og_image = clip.og_image.unwrap_or_default();
    // Clamp raw_content to the same byte budget as content so a single huge
    // page can't balloon the DB. If the caller (typically the popup path via
    // /api/clip) didn't provide a raw dump, fall back to the content itself —
    // that way the UI's "原始" toggle always has something, and if stage-2 AI
    // cleaning goes haywire we still have the unmodified first-pass text.
    let raw_content = {
        let provided = clip.raw_content.unwrap_or_default();
        let mut r = if provided.is_empty() {
            clip.content.clone()
        } else {
            provided
        };
        if r.len() > MAX_CONTENT_LEN {
            r.truncate(MAX_CONTENT_LEN);
        }
        r
    };

    conn.execute(
        "INSERT INTO web_clips (url, title, content, raw_content, source_type, favicon, og_image)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(url) DO UPDATE SET
           title=excluded.title,
           content=excluded.content,
           raw_content=CASE WHEN excluded.raw_content != '' THEN excluded.raw_content ELSE web_clips.raw_content END,
           source_type=excluded.source_type,
           favicon=excluded.favicon,
           og_image=CASE WHEN excluded.og_image != '' THEN excluded.og_image ELSE web_clips.og_image END,
           deleted_at=NULL,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        rusqlite::params![clip.url, clip.title, clip.content, raw_content, source_type, favicon, og_image],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT * FROM web_clips WHERE url = ?1",
        [&clip.url],
        row_to_clip,
    )
    .map_err(|e| e.to_string())
}

/// Add a new web clip. If URL already exists, update it.
#[tauri::command]
pub fn add_web_clip(clip: NewClip) -> Result<WebClip, String> {
    let row = add_web_clip_no_autotag(clip)?;

    // Kick off the background pipeline:
    //   1a. If the pushed content is thin (SPA sites like spacex.com where
    //       the content-script selectors miss), try a server-side fetch to
    //       top up raw_content so AI has something real to work with.
    //   1b. AI clean raw → readable content (stage 2).
    //   2.  AI summarize + tag (stage 3).
    // Each stage is independent — a failure at 1a still lets stages 2 and 3
    // run on whatever we have.
    let clip_id = row.id;
    std::thread::spawn(move || {
        if let Err(e) = enrich_raw_content_if_thin(clip_id) {
            tracing::warn!("Enrich clip {} failed: {}", clip_id, e);
        }
        if let Err(e) = ai_clean_clip_inner(clip_id) {
            tracing::warn!("AI clean clip {} failed: {}", clip_id, e);
        }
        if let Err(e) = auto_tag_clip_inner(clip_id) {
            tracing::warn!("Auto-tag clip {} failed: {}", clip_id, e);
        }
    });

    Ok(row)
}

/// Threshold below which we consider a clip's content "too thin" and try a
/// server-side scrape to supplement it. Set at 100 chars — that's roughly
/// "title + one short phrase". Title-only SPA cases (SpaceX at 16 chars)
/// still trigger. Legitimately short pages like paulgraham.com's homepage
/// (116 chars of link text) no longer burn a server fetch they wouldn't
/// benefit from.
const THIN_CONTENT_THRESHOLD: usize = 100;

/// Stage 1.5: when the browser content-script pushed an essentially empty
/// clip (common on modern SPAs whose initial DOM doesn't match our article
/// selectors), fetch the URL server-side via `html_extract` and use whichever
/// side got more text. The two extraction paths have different failure
/// modes, so this recovers many sites that previously saved as title-only.
fn enrich_raw_content_if_thin(clip_id: i64) -> Result<(), String> {
    let (url, current_content, current_raw): (String, String, String) = {
        let conn = open_db()?;
        conn.query_row(
            "SELECT url, content, raw_content FROM web_clips WHERE id = ?1",
            [clip_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?
    };

    let cur_content_len = current_content.chars().count();
    let cur_raw_len = current_raw.chars().count();
    if cur_content_len >= THIN_CONTENT_THRESHOLD || cur_raw_len >= THIN_CONTENT_THRESHOLD {
        return Ok(());
    }

    tracing::info!(
        "clip {} is thin (content={} raw={}), attempting server-side fetch of {}",
        clip_id,
        cur_content_len,
        cur_raw_len,
        url
    );

    let page = match crate::html_extract::fetch_and_extract(&url) {
        Ok(p) => p,
        Err(e) => {
            // Not fatal — stages 2/3 still run on whatever the client sent us.
            tracing::info!("clip {} server fetch failed: {}", clip_id, e);
            return Ok(());
        }
    };

    let fetched_content_len = page.content.chars().count();
    let fetched_raw_len = page.raw_content.chars().count();

    let new_content = if fetched_content_len > cur_content_len {
        page.content.clone()
    } else {
        current_content
    };
    let new_raw = if fetched_raw_len > cur_raw_len {
        page.raw_content.clone()
    } else {
        current_raw
    };
    let new_content_len = new_content.chars().count();
    let new_raw_len = new_raw.chars().count();

    let conn = open_db()?;
    conn.execute(
        "UPDATE web_clips
            SET content = ?1,
                raw_content = ?2,
                og_image = CASE WHEN og_image = '' THEN ?3 ELSE og_image END,
                favicon = CASE WHEN favicon = '' THEN ?4 ELSE favicon END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ?5",
        rusqlite::params![new_content, new_raw, page.og_image, page.favicon, clip_id],
    )
    .map_err(|e| e.to_string())?;

    tracing::info!(
        "clip {} enriched: content {}→{} chars, raw {}→{} chars",
        clip_id,
        cur_content_len,
        new_content_len,
        cur_raw_len,
        new_raw_len,
    );
    Ok(())
}

/// List web clips with pagination and filters.
#[tauri::command]
#[allow(non_snake_case)]
pub fn list_web_clips(
    page: Option<u32>,
    pageSize: Option<u32>,
    tag: Option<String>,
    sourceType: Option<String>,
    starred: Option<bool>,
) -> Result<Vec<WebClip>, String> {
    let conn = open_db()?;
    let page = page.unwrap_or(1).max(1);
    let size = pageSize.unwrap_or(20).min(100);
    let offset = (page - 1) * size;

    let mut conditions = vec!["deleted_at IS NULL".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref t) = tag {
        conditions.push(format!("tags LIKE ?{} ESCAPE '\\'", params.len() + 1));
        params.push(Box::new(format!("%\"{}\"%", escape_like(t))));
    }
    if let Some(ref st) = sourceType {
        conditions.push(format!("source_type = ?{}", params.len() + 1));
        params.push(Box::new(st.clone()));
    }
    if let Some(s) = starred {
        conditions.push(format!("is_starred = ?{}", params.len() + 1));
        params.push(Box::new(if s { 1i64 } else { 0i64 }));
    }

    let sql = format!(
        "SELECT * FROM web_clips WHERE {} ORDER BY datetime(created_at) DESC LIMIT ?{} OFFSET ?{}",
        conditions.join(" AND "),
        params.len() + 1,
        params.len() + 2,
    );
    params.push(Box::new(i64::from(size)));
    params.push(Box::new(i64::from(offset)));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), row_to_clip)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Full-text search web clips with pagination support.
#[tauri::command]
#[allow(non_snake_case)]
pub fn search_web_clips(
    q: String,
    page: Option<u32>,
    pageSize: Option<u32>,
) -> Result<Vec<WebClip>, String> {
    if q.trim().is_empty() {
        return list_web_clips(Some(page.unwrap_or(1)), Some(pageSize.unwrap_or(20)), None, None, None);
    }
    if q.len() > 1000 {
        return Err("搜索关键词过长".to_string());
    }
    let conn = open_db()?;
    let size = pageSize.unwrap_or(20).min(100);
    let offset = (page.unwrap_or(1).max(1) - 1) * size;

    // FTS5 query: wrap each token with *
    let fts_q: String = q
        .split_whitespace()
        .map(|w| format!("\"{}\"*", w.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ");

    let mut stmt = conn
        .prepare(
            "SELECT c.* FROM web_clips c
             JOIN web_clips_fts f ON c.id = f.rowid
             WHERE web_clips_fts MATCH ?1 AND c.deleted_at IS NULL
             ORDER BY rank
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![fts_q, size, offset], row_to_clip)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Soft-delete a web clip by ID (moves to trash).
#[tauri::command]
pub fn delete_web_clip(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE web_clips SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// List clips in trash (soft-deleted).
#[tauri::command]
#[allow(non_snake_case)]
pub fn list_trash(page: Option<u32>, pageSize: Option<u32>) -> Result<Vec<WebClip>, String> {
    let conn = open_db()?;
    let page = page.unwrap_or(1).max(1);
    let size = pageSize.unwrap_or(20).min(100);
    let offset = (page - 1) * size;

    let mut stmt = conn
        .prepare(
            "SELECT * FROM web_clips WHERE deleted_at IS NOT NULL
             ORDER BY datetime(deleted_at) DESC LIMIT ?1 OFFSET ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![size, offset], row_to_clip)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Restore a clip from trash.
#[tauri::command]
pub fn restore_clip(id: i64) -> Result<WebClip, String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE web_clips SET deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    conn.query_row("SELECT * FROM web_clips WHERE id = ?1", [id], row_to_clip)
        .map_err(|e| e.to_string())
}

/// Permanently delete a clip (bypass trash).
#[tauri::command]
pub fn purge_clip(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM web_clips WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Empty all trash permanently.
#[tauri::command]
pub fn empty_trash() -> Result<i64, String> {
    let conn = open_db()?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM web_clips WHERE deleted_at IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM web_clips WHERE deleted_at IS NOT NULL", [])
        .map_err(|e| e.to_string())?;
    Ok(count)
}

/// Count clips in trash.
#[tauri::command]
pub fn count_trash() -> Result<i64, String> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT COUNT(*) FROM web_clips WHERE deleted_at IS NOT NULL",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Toggle star on a web clip.
#[tauri::command]
pub fn toggle_star_clip(id: i64) -> Result<bool, String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE web_clips SET is_starred = 1 - is_starred, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;

    let starred: bool = conn
        .query_row(
            "SELECT is_starred FROM web_clips WHERE id = ?1",
            [id],
            |r| Ok(r.get::<_, i64>(0)? != 0),
        )
        .map_err(|e| e.to_string())?;
    Ok(starred)
}

/// Update summary and/or tags for a clip.
#[tauri::command]
pub fn update_web_clip(
    id: i64,
    summary: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<WebClip, String> {
    if let Some(ref s) = summary {
        if s.len() > 10_000 {
            return Err("摘要过长".to_string());
        }
    }
    if let Some(ref t) = tags {
        if t.len() > 100 {
            return Err("标签过多".to_string());
        }
        if t.iter().any(|tag| tag.len() > 200) {
            return Err("单个标签过长".to_string());
        }
    }
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if let Some(ref s) = summary {
        tx.execute(
            "UPDATE web_clips SET summary = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
            rusqlite::params![s, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(ref t) = tags {
        let tags_json = serde_json::to_string(t).unwrap_or_else(|_| "[]".to_string());
        tx.execute(
            "UPDATE web_clips SET tags = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
            rusqlite::params![tags_json, id],
        )
        .map_err(|e| e.to_string())?;
    }
    let clip = tx
        .query_row(
            "SELECT * FROM web_clips WHERE id = ?1",
            [id],
            row_to_clip,
        )
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(clip)
}

/// Fetch a single clip by id. Used by the detail view to poll for the
/// staged AI pipeline's progress (raw → clean → summary + tags) without
/// reloading the whole list.
#[tauri::command]
pub fn get_clip(id: i64) -> Result<WebClip, String> {
    let conn = open_db()?;
    conn.query_row("SELECT * FROM web_clips WHERE id = ?1", [id], row_to_clip)
        .map_err(|e| e.to_string())
}

/// Count total active clips (for pagination).
#[tauri::command]
pub fn count_web_clips() -> Result<i64, String> {
    let conn = open_db()?;
    conn.query_row("SELECT COUNT(*) FROM web_clips WHERE deleted_at IS NULL", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

/// Count clips still pending AI processing (empty summary).
/// Returns 0 if AI is not configured (nothing can be processed).
#[tauri::command]
pub fn count_pending_clips() -> Result<i64, String> {
    let conn = open_db()?;

    // If AI is not configured, nothing is "pending" — it just can't run
    let cfg = crate::db::read_ai_config(&conn)?;
    if AiClientConfig::from_map(&cfg).is_err() {
        return Ok(0);
    }

    conn.query_row(
        "SELECT COUNT(*) FROM web_clips WHERE summary = '' AND deleted_at IS NULL",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Get all unique tags across all clips (aggregated in SQL via json_each).
#[tauri::command]
pub fn list_clip_tags() -> Result<Vec<String>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT je.value FROM web_clips, json_each(web_clips.tags) je
             WHERE web_clips.tags != '[]' AND web_clips.deleted_at IS NULL
             ORDER BY je.value",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

// ── AI Auto-tag ───────────────────────────────────────────────────────────

/// Collect existing tags for AI context (tag reuse).
fn gather_existing_tags(conn: &rusqlite::Connection) -> Vec<String> {
    conn.prepare(
        "SELECT DISTINCT je.value FROM web_clips, json_each(web_clips.tags) je
         WHERE web_clips.tags != '[]' AND web_clips.deleted_at IS NULL
         ORDER BY je.value",
    )
    .and_then(|mut stmt| {
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.flatten().collect())
    })
    .unwrap_or_default()
}

/// Character budget for the AI cleaning prompt. Most articles fit well inside
/// 24K chars; truncating here keeps LLM costs bounded and the round trip
/// under a couple of seconds on a typical provider.
const AI_CLEAN_INPUT_CHARS: usize = 24_000;

/// Stage 2 of the web-clip pipeline: read `raw_content` and ask the AI to
/// produce a cleaned, readable Markdown version. Writes the result back to
/// `content`, overwriting the first-pass scraper output.
///
/// Deliberately asks the model **not** to summarize — we want size-preserving
/// cleanup. Summarization happens in stage 3 (`auto_tag_clip_inner`).
pub(crate) fn ai_clean_clip_inner(clip_id: i64) -> Result<(), String> {
    let conn = open_db()?;

    let (raw, current): (String, String) = conn
        .query_row(
            "SELECT raw_content, content FROM web_clips WHERE id = ?1",
            [clip_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    // Fall back to current content if raw is empty (old clip, or extension
    // pushed a pre-extracted payload without a raw dump). AI still gets value
    // from cleaning the first-pass scraper output.
    let source = if raw.trim().is_empty() { &current } else { &raw };
    if source.trim().is_empty() {
        return Ok(());
    }

    let cfg = crate::db::read_ai_config(&conn)?;
    let config = match AiClientConfig::from_map(&cfg) {
        Ok(c) => c,
        Err(_) => return Ok(()), // No AI configured, skip silently
    };

    let truncated: String = source.chars().take(AI_CLEAN_INPUT_CHARS).collect();
    let source_chars = truncated.chars().count();

    let system = r#"你是网页正文清洗助手。输入是一段从网页抓取的原始文本，可能包含导航、广告、推荐阅读、版权声明、脚注、乱码字符或重复换行。请输出清洗后的**完整可读正文 Markdown**。

【核心要求 · 必须严格遵守】
⚠️ 这是**清洗任务，不是摘要任务**。输出长度应与原文接近（至少保留 70% 的字符数）。**严禁概括、压缩、简化、翻译**。如果你把 3000 字的文章输出成 30 字，你就失败了。

【允许去掉】
- 导航栏、侧边栏、广告、推荐阅读、"猜你喜欢"、评论区、订阅弹窗
- 登录/版权声明、分享按钮、面包屑、页脚
- 明显重复的链接列表、乱码/控制字符

【必须保留，逐字保留】
- 所有段落正文、标题、列表项
- 代码块、引用、图注、表格
- 数据、引用、数字、名字、观点、论证
- 如含中英双语混排，保持原文，不要翻译

【输出格式】
- 仅输出清洗后的正文 Markdown
- 不要附加任何解释、前言、代码块包裹
- 不要写"以下是清洗后的内容"之类的话"#;

    let user = format!(
        "原始网页文本（约 {source_chars} 字）：\n---\n{truncated}\n---\n\n请按照系统指令输出清洗后的完整正文 Markdown（长度应接近 {source_chars} 字）。",
    );

    let messages = vec![
        serde_json::json!({"role": "system", "content": system}),
        serde_json::json!({"role": "user", "content": user}),
    ];

    let reply = ai_client::chat(&config, messages, 0.2).map_err(String::from)?;
    let cleaned = reply.trim();
    if cleaned.is_empty() {
        return Err("AI 清洗返回空".into());
    }

    let cleaned_chars = cleaned.chars().count();

    // Reject drastic compressions. The prompt forbids summarization, so if
    // the model collapsed a 3000-char article to 30 chars it ignored us.
    // Keeping the original content is always safer than overwriting with the
    // hallucinated digest — we have the summary field for that use case.
    // Threshold: for any source > 200 chars, cleaned must keep at least 1/3
    // of the chars (i.e. reject >66% shrink). Short sources (< 200) are let
    // through because for e.g. a tweet the "cleaned" version CAN legitimately
    // be shorter after stripping boilerplate.
    if source_chars > 200 && cleaned_chars * 3 < source_chars {
        tracing::warn!(
            "AI clean rejected for clip {}: {} chars → {} (>66% reduction). Keeping original.",
            clip_id,
            source_chars,
            cleaned_chars
        );
        return Err(format!(
            "AI 清洗输出过短（{cleaned_chars} / 原始 {source_chars}），已保留原文"
        ));
    }

    let cleaned_capped: String = cleaned.chars().take(MAX_CONTENT_LEN).collect();

    conn.execute(
        "UPDATE web_clips SET content = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?2",
        rusqlite::params![cleaned_capped, clip_id],
    )
    .map_err(|e| e.to_string())?;

    tracing::info!(
        "AI cleaned clip {} (source: {} → cleaned: {} chars)",
        clip_id,
        source_chars,
        cleaned_capped.chars().count()
    );
    Ok(())
}

pub(crate) fn auto_tag_clip_inner(clip_id: i64) -> Result<(), String> {
    let conn = open_db()?;

    let (title, content): (String, String) = conn
        .query_row(
            "SELECT title, content FROM web_clips WHERE id = ?1",
            [clip_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let cfg = crate::db::read_ai_config(&conn)?;
    let config = match AiClientConfig::from_map(&cfg) {
        Ok(c) => c,
        Err(_) => return Ok(()), // No AI configured, skip
    };

    let existing_tags = gather_existing_tags(&conn);

    // Truncate content for AI
    let truncated: String = content.chars().take(4000).collect();

    let existing_tags_str = if existing_tags.is_empty() {
        "（暂无）".to_string()
    } else {
        existing_tags.join("、")
    };

    let system = format!(
        r#"你是一个知识整理助手。用户收藏了一篇网页内容，请你：

1. 用中文生成 2-3 句话的摘要，提炼核心要点
2. 提取 3-5 个关键词标签
3. 判断内容类型：article / video / doc / tweet / code

用户已有的标签：{existing_tags}
如果内容与已有标签相关，优先复用已有标签保持一致性。

严格返回 JSON：
{{"summary":"摘要","tags":["标签1","标签2"],"source_type":"article"}}
只输出 JSON，不要其他文字。"#,
        existing_tags = existing_tags_str,
    );

    let user = format!("网页标题：{}\n网页正文：\n{}", title, truncated);

    let messages = vec![
        serde_json::json!({"role": "system", "content": system}),
        serde_json::json!({"role": "user", "content": user}),
    ];

    let reply = ai_client::chat(&config, messages, 0.2).map_err(String::from)?;

    // Parse response. AI output is *untrusted* — sanitize every field before
    // we write it to the DB so a compromised provider can't bloat rows or
    // inject forbidden source_type values.
    let json_str = crate::ai::extract_json(&reply).unwrap_or(reply);
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_str) {
        // Summary: hard cap so a 10MB AI response can't DoS the DB.
        const MAX_SUMMARY_CHARS: usize = 10_000;
        let summary: String = parsed["summary"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(MAX_SUMMARY_CHARS)
            .collect();

        // Tags: trim + 200-char cap per tag + 100-count cap overall + dedup.
        const MAX_TAG_CHARS: usize = 200;
        const MAX_TAG_COUNT: usize = 100;
        let tags: Vec<String> = parsed["tags"]
            .as_array()
            .map(|arr| {
                let mut out: Vec<String> = Vec::new();
                for v in arr {
                    if out.len() >= MAX_TAG_COUNT {
                        break;
                    }
                    if let Some(s) = v.as_str() {
                        let t = s.trim();
                        if t.is_empty() || t.chars().count() > MAX_TAG_CHARS {
                            continue;
                        }
                        let owned = t.to_string();
                        if !out.contains(&owned) {
                            out.push(owned);
                        }
                    }
                }
                out
            })
            .unwrap_or_default();

        // source_type: whitelist. Anything unexpected falls back to "article".
        const ALLOWED_SOURCE_TYPES: &[&str] = &["article", "video", "tweet", "code", "doc"];
        let st_raw = parsed["source_type"].as_str().unwrap_or("article");
        let source_type = if ALLOWED_SOURCE_TYPES.contains(&st_raw) {
            st_raw.to_string()
        } else {
            "article".to_string()
        };

        let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "UPDATE web_clips SET summary = ?1, tags = ?2, source_type = ?3,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?4",
            rusqlite::params![summary, tags_json, source_type, clip_id],
        )
        .map_err(|e| e.to_string())?;

        tracing::info!("Auto-tagged clip {}: [{}]", clip_id, tags_json);
    }

    Ok(())
}

/// Manually trigger AI auto-tag for a clip.
#[tauri::command]
pub fn ai_auto_tag_clip(id: i64) -> Result<(), String> {
    auto_tag_clip_inner(id)
}

/// Batch re-tag all clips that have no summary yet.
/// Returns the count of clips to process; actual tagging runs in a background thread.
#[tauri::command]
pub fn ai_batch_retag_clips() -> Result<i64, String> {
    let conn = open_db()?;
    let ids: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM web_clips WHERE summary = '' AND deleted_at IS NULL ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };
    let total = ids.len() as i64;

    if total > 0 {
        std::thread::spawn(move || {
            for id in ids {
                if let Err(e) = auto_tag_clip_inner(id) {
                    tracing::warn!("Batch retag clip {} failed: {}", id, e);
                }
            }
            tracing::info!("Batch retag completed: {} clips processed", total);
        });
    }

    Ok(total)
}

// ── Dedup ─────────────────────────────────────────────────────────────────

/// Check if a URL already exists. Returns the existing clip if found.
#[tauri::command]
pub fn check_clip_exists(url: String) -> Result<Option<WebClip>, String> {
    let conn = open_db()?;
    let result = conn.query_row(
        "SELECT * FROM web_clips WHERE url = ?1 AND deleted_at IS NULL",
        [&url],
        row_to_clip,
    );
    match result {
        Ok(clip) => Ok(Some(clip)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Find similar clips by matching title keywords.
/// Returns clips whose titles share significant words with the given title.
#[tauri::command]
pub fn find_similar_clips(title: String, exclude_id: Option<i64>) -> Result<Vec<WebClip>, String> {
    let conn = open_db()?;

    // Extract keywords (2+ chars, including CJK characters)
    let keywords: Vec<&str> = title
        .split(|c: char| !c.is_alphanumeric() && !('\u{4e00}'..='\u{9fff}').contains(&c))
        .filter(|w| w.chars().count() >= 2)
        .take(5)
        .collect();

    if keywords.is_empty() {
        return Ok(vec![]);
    }

    // Build FTS query from keywords
    let fts_q = keywords
        .iter()
        .map(|w| format!("\"{}\"", w.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ");

    let exclude = exclude_id.unwrap_or(-1);
    let mut stmt = conn
        .prepare(
            "SELECT c.* FROM web_clips c
             JOIN web_clips_fts f ON c.id = f.rowid
             WHERE web_clips_fts MATCH ?1 AND c.id != ?2 AND c.deleted_at IS NULL
             ORDER BY rank LIMIT 5",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![fts_q, exclude], row_to_clip)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// ── Smart Search (Phase 3) ────────────────────────────────────────────────

/// AI fuzzy search: user describes what they remember, AI finds matching clips.
#[tauri::command]
pub fn ai_fuzzy_search_clips(description: String) -> Result<Vec<WebClip>, String> {
    if description.len() > 1000 {
        return Err("搜索描述过长".to_string());
    }
    let conn = open_db()?;

    // Gather all clip summaries for AI context
    let mut stmt = conn
        .prepare(
            "SELECT id, title, summary, tags, url FROM web_clips
             WHERE deleted_at IS NULL
             ORDER BY datetime(created_at) DESC LIMIT 200",
        )
        .map_err(|e| e.to_string())?;

    let clip_index: Vec<(i64, String)> = stmt
        .query_map([], |r| {
            let id: i64 = r.get(0)?;
            let title: String = r.get(1)?;
            let summary: String = r.get(2)?;
            let tags: String = r.get(3)?;
            let url: String = r.get(4)?;
            let domain = url
                .split("//")
                .nth(1)
                .and_then(|s| s.split('/').next())
                .unwrap_or("");
            Ok((
                id,
                format!(
                    "[{}] {} | {} | 标签:{} | {}",
                    id, title, summary, tags, domain
                ),
            ))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    if clip_index.is_empty() {
        return Ok(vec![]);
    }

    let cfg = crate::db::read_ai_config(&conn)?;
    let config = AiClientConfig::from_map(&cfg).map_err(String::from)?;

    let index_text = clip_index
        .iter()
        .map(|(_, s)| s.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let system = r#"你是一个搜索助手。用户模糊地描述了一篇他之前收藏过的内容，请你从收藏列表中找出最匹配的条目。

返回最匹配的条目 ID（最多 5 个），严格按 JSON 格式：
{"ids":[1,2,3]}
只输出 JSON，不要其他文字。"#;

    let user = format!("用户描述：{}\n\n收藏列表：\n{}", description, index_text);

    let messages = vec![
        serde_json::json!({"role": "system", "content": system}),
        serde_json::json!({"role": "user", "content": user}),
    ];

    let reply = ai_client::chat(&config, messages, 0.1).map_err(String::from)?;

    let json_str = crate::ai::extract_json(&reply).unwrap_or(reply);
    let parsed: serde_json::Value =
        serde_json::from_str(&json_str).unwrap_or(serde_json::json!({"ids":[]}));

    let ids: Vec<i64> = parsed["ids"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_i64()).collect())
        .unwrap_or_default();

    if ids.is_empty() {
        return Ok(vec![]);
    }

    // Fetch matched clips in order
    let placeholders = ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT * FROM web_clips WHERE id IN ({})", placeholders);

    let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids
        .iter()
        .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
        .collect();
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), row_to_clip)
        .map_err(|e| e.to_string())?;

    let mut result_map: std::collections::HashMap<i64, WebClip> = std::collections::HashMap::new();
    for r in rows {
        let clip = r.map_err(|e| e.to_string())?;
        result_map.insert(clip.id, clip);
    }

    // Return in AI-ranked order
    let mut out = Vec::new();
    for id in &ids {
        if let Some(clip) = result_map.remove(id) {
            out.push(clip);
        }
    }
    Ok(out)
}

/// Mark a clip as read.
#[tauri::command]
pub fn mark_clip_read(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE web_clips SET is_read = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggle read status on a clip.
#[tauri::command]
pub fn toggle_read_clip(id: i64) -> Result<bool, String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE web_clips SET is_read = 1 - is_read, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    let is_read: bool = conn
        .query_row(
            "SELECT is_read FROM web_clips WHERE id = ?1",
            [id],
            |r| Ok(r.get::<_, i64>(0)? != 0),
        )
        .map_err(|e| e.to_string())?;
    Ok(is_read)
}

/// List clips with advanced filters: time range, domain, source type.
#[tauri::command]
#[allow(non_snake_case)]
pub fn list_web_clips_advanced(
    page: Option<u32>,
    pageSize: Option<u32>,
    tag: Option<String>,
    sourceType: Option<String>,
    starred: Option<bool>,
    unread: Option<bool>,
    domain: Option<String>,
    dateFrom: Option<String>,
    dateTo: Option<String>,
) -> Result<Vec<WebClip>, String> {
    let conn = open_db()?;
    let page = page.unwrap_or(1).max(1);
    let size = pageSize.unwrap_or(20).min(100);
    let offset = (page - 1) * size;

    let mut conditions = vec!["deleted_at IS NULL".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref t) = tag {
        conditions.push(format!("tags LIKE ?{} ESCAPE '\\'", params.len() + 1));
        params.push(Box::new(format!("%\"{}\"%", escape_like(t))));
    }
    if let Some(ref st) = sourceType {
        conditions.push(format!("source_type = ?{}", params.len() + 1));
        params.push(Box::new(st.clone()));
    }
    if let Some(s) = starred {
        conditions.push(format!("is_starred = ?{}", params.len() + 1));
        params.push(Box::new(if s { 1i64 } else { 0i64 }));
    }
    if let Some(true) = unread {
        conditions.push("is_read = 0".to_string());
    }
    if let Some(ref d) = domain {
        conditions.push(format!("url LIKE ?{} ESCAPE '\\'", params.len() + 1));
        params.push(Box::new(format!("%{}%", escape_like(d))));
    }
    if let Some(ref from) = dateFrom {
        conditions.push(format!("created_at >= ?{}", params.len() + 1));
        params.push(Box::new(from.clone()));
    }
    if let Some(ref to) = dateTo {
        conditions.push(format!("created_at <= ?{}", params.len() + 1));
        params.push(Box::new(to.clone()));
    }

    let sql = format!(
        "SELECT * FROM web_clips WHERE {} ORDER BY datetime(created_at) DESC LIMIT ?{} OFFSET ?{}",
        conditions.join(" AND "),
        params.len() + 1,
        params.len() + 2,
    );
    params.push(Box::new(i64::from(size)));
    params.push(Box::new(i64::from(offset)));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), row_to_clip)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Get all unique domains from clips (for domain filter).
/// Extracts host from URL in SQL to avoid loading all URLs into memory.
#[tauri::command]
pub fn list_clip_domains() -> Result<Vec<String>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT
               REPLACE(
                 SUBSTR(url,
                   INSTR(url, '://') + 3,
                   CASE WHEN INSTR(SUBSTR(url, INSTR(url, '://') + 3), '/') > 0
                     THEN INSTR(SUBSTR(url, INSTR(url, '://') + 3), '/') - 1
                     ELSE LENGTH(url)
                   END
                 ),
                 'www.', ''
               ) AS domain
             FROM web_clips
             WHERE INSTR(url, '://') > 0 AND deleted_at IS NULL
             ORDER BY domain",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

/// "You may have forgotten" — return random old clips not viewed recently.
#[tauri::command]
pub fn forgotten_clips(limit: Option<u32>) -> Result<Vec<WebClip>, String> {
    let conn = open_db()?;
    let limit = limit.unwrap_or(3).min(10);
    let mut stmt = conn
        .prepare(
            "SELECT * FROM web_clips
             WHERE created_at < datetime('now', '-30 days') AND deleted_at IS NULL
             ORDER BY RANDOM()
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit], row_to_clip)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Generate weekly clip summary using AI.
#[tauri::command]
pub fn ai_weekly_clip_summary() -> Result<String, String> {
    let conn = open_db()?;

    let mut stmt = conn
        .prepare(
            "SELECT title, summary, tags FROM web_clips
             WHERE created_at >= datetime('now', '-7 days') AND deleted_at IS NULL
             ORDER BY datetime(created_at) DESC",
        )
        .map_err(|e| e.to_string())?;

    let clips_text: Vec<String> = stmt
        .query_map([], |r| {
            let title: String = r.get(0)?;
            let summary: String = r.get(1)?;
            let tags: String = r.get(2)?;
            Ok(format!("- {} | {} | {}", title, summary, tags))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    if clips_text.is_empty() {
        return Ok("本周没有新的收藏内容。".to_string());
    }

    let cfg = crate::db::read_ai_config(&conn)?;
    let config = match AiClientConfig::from_map(&cfg) {
        Ok(c) => c,
        Err(_) => {
            return Ok(format!(
                "本周收藏了 {} 篇内容。（AI 未配置，无法生成摘要）",
                clips_text.len()
            ))
        }
    };

    let system =
        "你是用户的知识管理助手。请根据用户本周收藏的内容，生成一段简短的周报摘要（3-5句话），\
概括本周的学习兴趣方向和关键知识点。用亲切、鼓励的口吻。";

    let user = format!(
        "本周收藏了 {} 篇内容：\n{}",
        clips_text.len(),
        clips_text.join("\n")
    );

    let messages = vec![
        serde_json::json!({"role": "system", "content": system}),
        serde_json::json!({"role": "user", "content": user}),
    ];

    ai_client::chat(&config, messages, 0.4).map_err(String::from)
}

// ── App Status ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AppStatus {
    pub clip_count: i64,
    pub ai_configured: bool,
    pub has_collections: bool,
    pub has_notes: bool,
    pub onboarding_complete: bool,
}

#[tauri::command]
pub fn get_app_status() -> Result<AppStatus, String> {
    let conn = open_db()?;
    let clip_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM web_clips WHERE deleted_at IS NULL", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let ai_configured = crate::db::read_ai_config(&conn)
        .map(|cfg| AiClientConfig::from_map(&cfg).is_ok())
        .unwrap_or(false);
    let has_collections: bool = conn
        .query_row("SELECT COUNT(*) > 0 FROM collections", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let has_notes: bool = conn
        .query_row("SELECT COUNT(*) > 0 FROM clip_notes", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let onboarding_complete = crate::db::kv_get(&conn, "onboarding_complete")?
        .map(|v| v == "true")
        .unwrap_or(false);
    Ok(AppStatus {
        clip_count,
        ai_configured,
        has_collections,
        has_notes,
        onboarding_complete,
    })
}

#[tauri::command]
pub fn set_onboarding_complete() -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO app_kv(key, val) VALUES('onboarding_complete', 'true')
         ON CONFLICT(key) DO UPDATE SET val='true'",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Related Clips ────────────────────────────────────────────────────────

/// Find clips related to the given clip via shared tags and domain.
/// Uses SQL json_each to match tags in the database instead of loading all clips.
#[tauri::command]
#[allow(non_snake_case)]
pub fn find_related_clips(clipId: i64, limit: Option<u32>) -> Result<Vec<WebClip>, String> {
    let conn = open_db()?;
    let limit = limit.unwrap_or(5).min(10);

    // Get source clip's tags and domain
    let (tags_json, url): (String, String) = conn
        .query_row(
            "SELECT tags, url FROM web_clips WHERE id = ?1",
            [clipId],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let domain = url
        .split("//")
        .nth(1)
        .and_then(|s| s.split('/').next())
        .map(|h| h.strip_prefix("www.").unwrap_or(h))
        .unwrap_or("")
        .to_string();

    if tags.is_empty() && domain.is_empty() {
        return Ok(vec![]);
    }

    // Build tag matching via SQL json_each — no full table scan needed
    if !tags.is_empty() {
        let tag_placeholders = tags
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(",");

        // Score = 3 * matching_tags + 1 if same domain
        let sql = format!(
            "SELECT wc.*, (COUNT(je.value) * 3) AS tag_score
             FROM web_clips wc, json_each(wc.tags) je
             WHERE je.value IN ({tag_placeholders})
               AND wc.id != ?1
               AND wc.tags != '[]'
               AND wc.deleted_at IS NULL
             GROUP BY wc.id
             ORDER BY tag_score DESC
             LIMIT ?{}",
            tags.len() + 2,
        );

        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        params.push(Box::new(clipId));
        for t in &tags {
            params.push(Box::new(t.clone()));
        }
        params.push(Box::new(i64::from(limit)));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(param_refs.as_slice(), row_to_clip)
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        return Ok(out);
    }

    // Tags empty but domain exists — fall back to domain matching only
    let mut stmt = conn
        .prepare(
            "SELECT * FROM web_clips
             WHERE id != ?1 AND url LIKE ?2 ESCAPE '\\' AND deleted_at IS NULL
             ORDER BY datetime(created_at) DESC
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let domain_pattern = format!("%{}%", escape_like(&domain));
    let rows = stmt
        .query_map(rusqlite::params![clipId, domain_pattern, limit], row_to_clip)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// ── Clip Notes ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClipNote {
    pub id: i64,
    pub clip_id: i64,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Save or update a note for a clip (UPSERT).
#[tauri::command]
#[allow(non_snake_case)]
pub fn save_clip_note(clipId: i64, content: String) -> Result<ClipNote, String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO clip_notes (clip_id, content)
         VALUES (?1, ?2)
         ON CONFLICT(clip_id) DO UPDATE SET
           content = excluded.content,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        rusqlite::params![clipId, content],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, clip_id, content, created_at, updated_at FROM clip_notes WHERE clip_id = ?1",
        [clipId],
        |r| {
            Ok(ClipNote {
                id: r.get(0)?,
                clip_id: r.get(1)?,
                content: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

/// Get a note for a clip.
#[tauri::command]
#[allow(non_snake_case)]
pub fn get_clip_note(clipId: i64) -> Result<Option<ClipNote>, String> {
    use rusqlite::OptionalExtension;
    let conn = open_db()?;
    conn.query_row(
        "SELECT id, clip_id, content, created_at, updated_at FROM clip_notes WHERE clip_id = ?1",
        [clipId],
        |r| {
            Ok(ClipNote {
                id: r.get(0)?,
                clip_id: r.get(1)?,
                content: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

// ── Weekly Stats ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct WeeklyStats {
    pub daily_counts: Vec<(String, i64)>,
    pub top_tags: Vec<(String, i64)>,
    pub top_domains: Vec<(String, i64)>,
    pub total_clips: i64,
    pub total_notes: i64,
    pub total_collections: i64,
}

/// Get lightweight weekly stats (no AI call).
#[tauri::command]
pub fn get_weekly_stats() -> Result<WeeklyStats, String> {
    let conn = open_db()?;

    // Daily counts for last 28 days
    let mut stmt = conn
        .prepare(
            "SELECT date(created_at) AS day, COUNT(*) AS cnt
             FROM web_clips
             WHERE created_at >= datetime('now', '-28 days') AND deleted_at IS NULL
             GROUP BY day ORDER BY day ASC",
        )
        .map_err(|e| e.to_string())?;
    let daily_counts: Vec<(String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    // Top tags — aggregated in SQL via json_each (no full-table Rust deserialization)
    let mut tag_stmt = conn
        .prepare(
            "SELECT je.value AS tag, COUNT(*) AS cnt
             FROM web_clips, json_each(web_clips.tags) je
             WHERE web_clips.tags != '[]' AND web_clips.deleted_at IS NULL
             GROUP BY je.value
             ORDER BY cnt DESC
             LIMIT 10",
        )
        .map_err(|e| e.to_string())?;
    let top_tags: Vec<(String, i64)> = tag_stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    // Top domains — extract host from URL in SQL
    // SQLite doesn't have a built-in host extractor, so we use SUBSTR + INSTR
    let mut dom_stmt = conn
        .prepare(
            "SELECT
               REPLACE(
                 SUBSTR(url,
                   INSTR(url, '://') + 3,
                   CASE WHEN INSTR(SUBSTR(url, INSTR(url, '://') + 3), '/') > 0
                     THEN INSTR(SUBSTR(url, INSTR(url, '://') + 3), '/') - 1
                     ELSE LENGTH(url)
                   END
                 ),
                 'www.', ''
               ) AS domain,
               COUNT(*) AS cnt
             FROM web_clips
             WHERE INSTR(url, '://') > 0 AND deleted_at IS NULL
             GROUP BY domain
             ORDER BY cnt DESC
             LIMIT 10",
        )
        .map_err(|e| e.to_string())?;
    let top_domains: Vec<(String, i64)> = dom_stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    let total_clips: i64 = conn
        .query_row("SELECT COUNT(*) FROM web_clips WHERE deleted_at IS NULL", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let total_notes: i64 = conn
        .query_row("SELECT COUNT(*) FROM clip_notes", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let total_collections: i64 = conn
        .query_row("SELECT COUNT(*) FROM collections", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    Ok(WeeklyStats {
        daily_counts,
        top_tags,
        top_domains,
        total_clips,
        total_notes,
        total_collections,
    })
}

/// Delete a note for a clip.
#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_clip_note(clipId: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM clip_notes WHERE clip_id = ?1", [clipId])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Chat Sessions ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatSession {
    pub id: i64,
    pub title: String,
    pub messages: Vec<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn create_chat_session(title: Option<String>) -> Result<ChatSession, String> {
    let conn = open_db()?;
    let title = title.unwrap_or_else(|| "新对话".to_string());
    conn.execute(
        "INSERT INTO chat_sessions (title) VALUES (?1)",
        [&title],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, title, messages, created_at, updated_at FROM chat_sessions WHERE id = ?1",
        [id],
        |r| {
            let msgs_json: String = r.get(2)?;
            Ok(ChatSession {
                id: r.get(0)?,
                title: r.get(1)?,
                messages: serde_json::from_str(&msgs_json).unwrap_or_default(),
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_chat_sessions() -> Result<Vec<ChatSession>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, messages, created_at, updated_at FROM chat_sessions
             ORDER BY datetime(updated_at) DESC LIMIT 50",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let msgs_json: String = r.get(2)?;
            Ok(ChatSession {
                id: r.get(0)?,
                title: r.get(1)?,
                messages: serde_json::from_str(&msgs_json).unwrap_or_default(),
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn update_chat_session(
    id: i64,
    title: Option<String>,
    messages: Option<Vec<serde_json::Value>>,
) -> Result<(), String> {
    let conn = open_db()?;
    if let Some(ref t) = title {
        if t.len() > 500 {
            return Err("会话标题过长".to_string());
        }
        conn.execute(
            "UPDATE chat_sessions SET title = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
            rusqlite::params![t, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(ref m) = messages {
        let json = serde_json::to_string(m).unwrap_or_else(|_| "[]".to_string());
        if json.len() > 5_000_000 {
            return Err("会话消息数据过大".to_string());
        }
        conn.execute(
            "UPDATE chat_sessions SET messages = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
            rusqlite::params![json, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_chat_session(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM chat_sessions WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_http_url;

    #[test]
    fn accepts_http_and_https() {
        assert!(is_http_url("http://example.com"));
        assert!(is_http_url("https://example.com/path?q=1"));
        assert!(is_http_url("HTTPS://EXAMPLE.COM"));
    }

    #[test]
    fn rejects_dangerous_schemes() {
        assert!(!is_http_url("javascript:alert(1)"));
        assert!(!is_http_url("data:text/html,<script>alert(1)</script>"));
        assert!(!is_http_url("file:///etc/passwd"));
        assert!(!is_http_url("vbscript:msgbox"));
        assert!(!is_http_url("chrome://settings"));
    }

    #[test]
    fn rejects_malformed() {
        // We only defend against dangerous schemes; `http:foo` has scheme=http
        // and would be accepted (browsers consider it valid-ish), but obvious
        // garbage without any scheme must be rejected.
        assert!(!is_http_url(""));
        assert!(!is_http_url("not a url"));
        assert!(!is_http_url("//example.com")); // scheme-relative; not a full URL
    }
}

