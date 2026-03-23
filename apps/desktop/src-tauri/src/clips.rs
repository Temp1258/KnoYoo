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

/// Collect existing tags and skill names for AI context (tag reuse + skill linking).
fn gather_existing_context(conn: &rusqlite::Connection) -> (Vec<String>, Vec<(i64, String)>) {
    // Existing tags from all clips
    let existing_tags: Vec<String> = {
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
    };

    // Skill tree node names
    let skills: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, name FROM industry_skill ORDER BY id LIMIT 100")
            .unwrap_or_else(|_| conn.prepare("SELECT 0, ''").unwrap());
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    };

    (existing_tags, skills)
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

    let (existing_tags, skills) = gather_existing_context(&conn);
    let skill_names: Vec<&str> = skills.iter().map(|(_, n)| n.as_str()).collect();

    // Truncate content for AI
    let truncated: String = content.chars().take(4000).collect();

    let existing_tags_str = if existing_tags.is_empty() {
        "（暂无）".to_string()
    } else {
        existing_tags.join("、")
    };
    let skill_names_str = if skill_names.is_empty() {
        "（暂无）".to_string()
    } else {
        skill_names.join("、")
    };

    let system = format!(
        r#"你是一个知识整理助手。用户收藏了一篇网页内容，请你：

1. 用中文生成 2-3 句话的摘要，提炼核心要点
2. 提取 3-5 个关键词标签
3. 判断内容类型：article / video / doc / tweet / code
4. 如果内容与用户技能树中的某个技能相关，返回该技能名称

用户已有的标签：{existing_tags}
如果内容与已有标签相关，优先复用已有标签保持一致性。

用户技能树中的技能：{skills}
如果内容与某个技能相关，在 related_skills 中返回匹配的技能名称。

严格返回 JSON：
{{"summary":"摘要","tags":["标签1","标签2"],"source_type":"article","related_skills":["技能名"]}}
只输出 JSON，不要其他文字。"#,
        existing_tags = existing_tags_str,
        skills = skill_names_str,
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

        // Link to skill tree nodes if AI found related skills
        if let Some(related) = parsed["related_skills"].as_array() {
            for skill_val in related {
                if let Some(skill_name) = skill_val.as_str() {
                    // Find matching skill by name
                    if let Some((skill_id, _)) = skills.iter().find(|(_, n)| n == skill_name) {
                        // Insert into note_skill_map (reuse existing mapping table)
                        // Use negative clip_id to distinguish from note mappings
                        let _ = conn.execute(
                            "INSERT OR IGNORE INTO note_skill_map (note_id, skill_id, weight) VALUES (?1, ?2, 1)",
                            rusqlite::params![-clip_id, skill_id],
                        );
                    }
                }
            }
        }

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
        stmt.query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .flatten()
            .collect()
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

    // Extract keywords (3+ chars, skip common words)
    let keywords: Vec<&str> = title
        .split(|c: char| !c.is_alphanumeric() && c != '\u{4e00}'..='\u{9fff}')
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

/// List clips with advanced filters: time range, domain, source type.
#[tauri::command]
#[allow(non_snake_case)]
pub fn list_web_clips_advanced(
    page: Option<u32>,
    pageSize: Option<u32>,
    tag: Option<String>,
    sourceType: Option<String>,
    starred: Option<bool>,
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
