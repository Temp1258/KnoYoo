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
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn row_to_clip(row: &rusqlite::Row) -> rusqlite::Result<WebClip> {
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

    conn.execute(
        "INSERT INTO web_clips (url, title, content, source_type, favicon)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(url) DO UPDATE SET
           title=excluded.title,
           content=excluded.content,
           source_type=excluded.source_type,
           favicon=excluded.favicon,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        rusqlite::params![clip.url, clip.title, clip.content, source_type, favicon],
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

/// Count total clips (for pagination).
#[tauri::command]
pub fn count_web_clips() -> Result<i64, String> {
    let conn = open_db()?;
    conn.query_row("SELECT COUNT(*) FROM web_clips", [], |r| r.get(0))
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

    // Truncate content for AI
    let truncated: String = content.chars().take(4000).collect();

    let system = r#"你是一个知识整理助手。用户收藏了一篇网页内容，请你：
1. 用中文生成 2-3 句话的摘要，提炼核心要点
2. 提取 3-5 个关键词标签
3. 判断内容类型：article / video / doc / tweet / code

严格返回 JSON：{"summary":"摘要","tags":["标签1","标签2"],"source_type":"article"}
只输出 JSON，不要其他文字。"#;

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
