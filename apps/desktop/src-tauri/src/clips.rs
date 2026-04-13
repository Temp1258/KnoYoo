use serde::{Deserialize, Serialize};

use crate::ai_client::{self, AiClientConfig};
use crate::db::open_db;

// ── Models ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WebClip {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub content: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub source_type: String,
    pub favicon: String,
    pub og_image: String,
    pub is_read: bool,
    pub is_starred: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct NewClip {
    pub url: String,
    pub title: String,
    pub content: String,
    pub source_type: Option<String>,
    pub favicon: Option<String>,
    pub og_image: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────

pub(crate) fn row_to_clip(row: &rusqlite::Row) -> rusqlite::Result<WebClip> {
    let tags_json: String = row.get("tags")?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(WebClip {
        id: row.get("id")?,
        url: row.get("url")?,
        title: row.get("title")?,
        content: row.get("content")?,
        summary: row.get("summary")?,
        tags,
        source_type: row.get("source_type")?,
        favicon: row.get("favicon")?,
        og_image: row.get("og_image")?,
        is_read: row.get::<_, i64>("is_read")? != 0,
        is_starred: row.get::<_, i64>("is_starred")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

// ── Commands ──────────────────────────────────────────────────────────────

/// Add a new web clip. If URL already exists, update it.
#[tauri::command]
pub fn add_web_clip(clip: NewClip) -> Result<WebClip, String> {
    let conn = open_db()?;
    let source_type = clip.source_type.unwrap_or_else(|| "article".to_string());
    let favicon = clip.favicon.unwrap_or_default();
    let og_image = clip.og_image.unwrap_or_default();

    conn.execute(
        "INSERT INTO web_clips (url, title, content, source_type, favicon, og_image)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(url) DO UPDATE SET
           title=excluded.title,
           content=excluded.content,
           source_type=excluded.source_type,
           favicon=excluded.favicon,
           og_image=CASE WHEN excluded.og_image != '' THEN excluded.og_image ELSE web_clips.og_image END,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        rusqlite::params![clip.url, clip.title, clip.content, source_type, favicon, og_image],
    )
    .map_err(|e| e.to_string())?;

    let row = conn
        .query_row(
            "SELECT * FROM web_clips WHERE url = ?1",
            [&clip.url],
            row_to_clip,
        )
        .map_err(|e| e.to_string())?;

    // Trigger async AI tagging in background (best-effort)
    let clip_id = row.id;
    std::thread::spawn(move || {
        if let Err(e) = auto_tag_clip_inner(clip_id) {
            tracing::warn!("Auto-tag clip {} failed: {}", clip_id, e);
        }
    });

    Ok(row)
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

    let mut conditions = vec!["1=1".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref t) = tag {
        conditions.push(format!("tags LIKE ?{}", params.len() + 1));
        params.push(Box::new(format!("%\"{}\"%", t)));
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

/// Full-text search web clips.
#[tauri::command]
pub fn search_web_clips(q: String) -> Result<Vec<WebClip>, String> {
    if q.trim().is_empty() {
        return list_web_clips(Some(1), Some(20), None, None, None);
    }
    let conn = open_db()?;

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
             WHERE web_clips_fts MATCH ?1
             ORDER BY rank
             LIMIT 50",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&fts_q], row_to_clip)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Delete a web clip by ID.
#[tauri::command]
pub fn delete_web_clip(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM web_clips WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
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
    let conn = open_db()?;
    if let Some(ref s) = summary {
        conn.execute(
            "UPDATE web_clips SET summary = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
            rusqlite::params![s, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(ref t) = tags {
        let tags_json = serde_json::to_string(t).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE web_clips SET tags = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
            rusqlite::params![tags_json, id],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.query_row(
        "SELECT * FROM web_clips WHERE id = ?1",
        [id],
        row_to_clip,
    )
    .map_err(|e| e.to_string())
}

/// Count total clips (for pagination).
#[tauri::command]
pub fn count_web_clips() -> Result<i64, String> {
    let conn = open_db()?;
    conn.query_row("SELECT COUNT(*) FROM web_clips", [], |r| r.get(0))
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
        "SELECT COUNT(*) FROM web_clips WHERE summary = ''",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Get all unique tags across all clips.
#[tauri::command]
pub fn list_clip_tags() -> Result<Vec<String>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT tags FROM web_clips WHERE tags != '[]'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut all_tags = std::collections::BTreeSet::new();
    for r in rows {
        let json_str = r.map_err(|e| e.to_string())?;
        if let Ok(tags) = serde_json::from_str::<Vec<String>>(&json_str) {
            for t in tags {
                all_tags.insert(t);
            }
        }
    }
    Ok(all_tags.into_iter().collect())
}

// ── AI Auto-tag ───────────────────────────────────────────────────────────

/// Collect existing tags for AI context (tag reuse).
fn gather_existing_tags(conn: &rusqlite::Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT tags FROM web_clips WHERE tags != '[]'")
        .unwrap_or_else(|_| conn.prepare("SELECT '[]'").unwrap());
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).ok();
    let mut all = std::collections::BTreeSet::new();
    if let Some(rows) = rows {
        for r in rows.flatten() {
            if let Ok(tags) = serde_json::from_str::<Vec<String>>(&r) {
                for t in tags {
                    all.insert(t);
                }
            }
        }
    }
    all.into_iter().collect()
}

fn auto_tag_clip_inner(clip_id: i64) -> Result<(), String> {
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

    // Parse response
    let json_str = crate::ai::extract_json(&reply).unwrap_or(reply);
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_str) {
        let summary = parsed["summary"].as_str().unwrap_or("").to_string();
        let tags = parsed["tags"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let source_type = parsed["source_type"]
            .as_str()
            .unwrap_or("article")
            .to_string();

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
#[tauri::command]
pub fn ai_batch_retag_clips() -> Result<i64, String> {
    let conn = open_db()?;
    let ids: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM web_clips WHERE summary = '' ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };
    let total = ids.len() as i64;
    for id in ids {
        if let Err(e) = auto_tag_clip_inner(id) {
            tracing::warn!("Batch retag clip {} failed: {}", id, e);
        }
    }
    Ok(total)
}

// ── Dedup ─────────────────────────────────────────────────────────────────

/// Check if a URL already exists. Returns the existing clip if found.
#[tauri::command]
pub fn check_clip_exists(url: String) -> Result<Option<WebClip>, String> {
    let conn = open_db()?;
    let result = conn.query_row(
        "SELECT * FROM web_clips WHERE url = ?1",
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
             WHERE web_clips_fts MATCH ?1 AND c.id != ?2
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
    let conn = open_db()?;

    // Gather all clip summaries for AI context
    let mut stmt = conn
        .prepare(
            "SELECT id, title, summary, tags, url FROM web_clips
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

    let mut conditions = vec!["1=1".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref t) = tag {
        conditions.push(format!("tags LIKE ?{}", params.len() + 1));
        params.push(Box::new(format!("%\"{}\"%", t)));
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
        conditions.push(format!("url LIKE ?{}", params.len() + 1));
        params.push(Box::new(format!("%{}%", d)));
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
#[tauri::command]
pub fn list_clip_domains() -> Result<Vec<String>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT url FROM web_clips")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut domains = std::collections::BTreeSet::new();
    for r in rows {
        let url = r.map_err(|e| e.to_string())?;
        if let Some(host) = url.split("//").nth(1).and_then(|s| s.split('/').next()) {
            let domain = host.strip_prefix("www.").unwrap_or(host);
            domains.insert(domain.to_string());
        }
    }
    Ok(domains.into_iter().collect())
}

/// "You may have forgotten" — return random old clips not viewed recently.
#[tauri::command]
pub fn forgotten_clips(limit: Option<u32>) -> Result<Vec<WebClip>, String> {
    let conn = open_db()?;
    let limit = limit.unwrap_or(3).min(10);
    let mut stmt = conn
        .prepare(
            "SELECT * FROM web_clips
             WHERE created_at < datetime('now', '-30 days')
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
             WHERE created_at >= datetime('now', '-7 days')
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
        .query_row("SELECT COUNT(*) FROM web_clips", [], |r| r.get(0))
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
/// Uses lightweight queries to avoid loading all clip content into memory.
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

    // Score candidates using only id, tags, url — NOT loading content
    let mut stmt = conn
        .prepare("SELECT id, tags, url FROM web_clips WHERE id != ?1")
        .map_err(|e| e.to_string())?;
    let mut scored: Vec<(i64, i64)> = Vec::new(); // (score, id)
    let mut rows = stmt.query([clipId]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let cid: i64 = row.get(0).map_err(|e| e.to_string())?;
        let ctags_json: String = row.get(1).map_err(|e| e.to_string())?;
        let curl: String = row.get(2).map_err(|e| e.to_string())?;
        let ctags: Vec<String> = serde_json::from_str(&ctags_json).unwrap_or_default();
        let mut score: i64 = 0;
        for t in &ctags {
            if tags.contains(t) {
                score += 3;
            }
        }
        if !domain.is_empty() && curl.contains(&domain) {
            score += 1;
        }
        if score > 0 {
            scored.push((score, cid));
        }
    }
    drop(rows);

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.truncate(limit as usize);

    if scored.is_empty() {
        return Ok(vec![]);
    }

    // Only now load full WebClip for the top N candidates
    let ids: Vec<i64> = scored.iter().map(|(_, id)| *id).collect();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT * FROM web_clips WHERE id IN ({})", placeholders);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::types::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
    let clip_rows = stmt.query_map(params.as_slice(), row_to_clip).map_err(|e| e.to_string())?;

    let mut result_map: std::collections::HashMap<i64, WebClip> = std::collections::HashMap::new();
    for r in clip_rows {
        let clip = r.map_err(|e| e.to_string())?;
        result_map.insert(clip.id, clip);
    }

    // Return in scored order
    Ok(scored.iter().filter_map(|(_, id)| result_map.remove(id)).collect())
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
             WHERE created_at >= datetime('now', '-28 days')
             GROUP BY day ORDER BY day ASC",
        )
        .map_err(|e| e.to_string())?;
    let daily_counts: Vec<(String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    // Top tags (from all clips)
    let mut tag_counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    let mut tag_stmt = conn
        .prepare("SELECT tags FROM web_clips WHERE tags != '[]'")
        .map_err(|e| e.to_string())?;
    let tag_rows = tag_stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    for r in tag_rows {
        let json_str = r.map_err(|e| e.to_string())?;
        if let Ok(tags) = serde_json::from_str::<Vec<String>>(&json_str) {
            for t in tags {
                *tag_counts.entry(t).or_insert(0) += 1;
            }
        }
    }
    let mut top_tags: Vec<(String, i64)> = tag_counts.into_iter().collect();
    top_tags.sort_by(|a, b| b.1.cmp(&a.1));
    top_tags.truncate(10);

    // Top domains
    let mut dom_counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    let mut dom_stmt = conn
        .prepare("SELECT url FROM web_clips")
        .map_err(|e| e.to_string())?;
    let dom_rows = dom_stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    for r in dom_rows {
        let url = r.map_err(|e| e.to_string())?;
        if let Some(host) = url.split("//").nth(1).and_then(|s| s.split('/').next()) {
            let domain = host.strip_prefix("www.").unwrap_or(host);
            *dom_counts.entry(domain.to_string()).or_insert(0) += 1;
        }
    }
    let mut top_domains: Vec<(String, i64)> = dom_counts.into_iter().collect();
    top_domains.sort_by(|a, b| b.1.cmp(&a.1));
    top_domains.truncate(10);

    let total_clips: i64 = conn
        .query_row("SELECT COUNT(*) FROM web_clips", [], |r| r.get(0))
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

