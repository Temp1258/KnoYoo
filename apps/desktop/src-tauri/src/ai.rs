use std::collections::HashMap;

use serde::Serialize;

use crate::ai_client::{self, AiClientConfig};
use crate::db::open_db;
use crate::models::ChatMessage;

/// Mask an API key for display: show first 3 and last 4 chars.
/// Uses char-based indexing to avoid panics on multi-byte strings.
fn mask_api_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    let len = chars.len();
    if len <= 8 {
        return "*".repeat(len);
    }
    let prefix: String = chars[..3].iter().collect();
    let suffix: String = chars[len - 4..].iter().collect();
    format!("{}{}{}", prefix, "*".repeat(len - 7), suffix)
}

/// Read AI config: returns {provider, api_base, api_key (masked), model}
#[tauri::command]
pub fn get_ai_config() -> Result<HashMap<String, String>, String> {
    let conn = open_db()?;
    let mut cfg = crate::db::read_ai_config(&conn)?;
    // Never expose the real API key via IPC
    if let Some(key) = cfg.get("api_key") {
        cfg.insert("api_key".to_string(), mask_api_key(key));
    }
    Ok(cfg)
}

/// Allowed keys for AI configuration.
const ALLOWED_AI_KEYS: &[&str] = &["provider", "api_base", "api_key", "model"];

/// Write AI config: only updates provided keys.
/// Skips api_key if it looks masked (contains consecutive ***).
#[tauri::command]
pub fn set_ai_config(cfg: HashMap<String, String>) -> Result<(), String> {
    for k in cfg.keys() {
        if !ALLOWED_AI_KEYS.contains(&k.as_str()) {
            return Err(format!("不允许的配置键: {k}"));
        }
    }
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (k, v) in &cfg {
        // Don't overwrite real key with masked placeholder
        if k == "api_key" && v.contains("***") {
            continue;
        }
        tx.execute(
            "INSERT INTO app_kv(key, val) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET val=excluded.val",
            rusqlite::params![k, v],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Read raw (unmasked) AI config from DB — for internal use only.
fn read_raw_config() -> Result<std::collections::HashMap<String, String>, String> {
    let conn = open_db()?;
    crate::db::read_ai_config(&conn)
}

/// Test AI connection: validates config and makes a real API call.
#[tauri::command]
pub fn ai_smoketest() -> Result<String, String> {
    let cfg = read_raw_config()?;
    let provider = cfg.get("provider").cloned().unwrap_or_default();
    let api_key = cfg.get("api_key").cloned().unwrap_or_default();
    if provider.is_empty() {
        return Ok("未选择 AI 提供商".to_string());
    }
    if api_key.is_empty() {
        return Ok("未填写 API Key".to_string());
    }

    let config = match AiClientConfig::from_map(&cfg) {
        Ok(c) => c,
        Err(e) => return Ok(format!("配置不完整: {e}")),
    };

    // Make a real API call with a minimal message
    let messages = vec![
        serde_json::json!({"role": "user", "content": "hi"}),
    ];
    let api_base = config.api_base.clone();
    match ai_client::chat(&config, messages, 0.0) {
        Ok(_) => Ok(format!("ok:{api_base}")),
        Err(e) => Ok(format!("连接失败: {e}")),
    }
}

/// Extract JSON from AI response (allows ```json ... ``` wrapping).
pub fn extract_json(s: &str) -> Option<String> {
    let t = s.trim();
    if t.starts_with("```") {
        if let Some(start) = t.find('\n') {
            let body = &t[start + 1..];
            if let Some(end) = body.rfind("```") {
                return Some(body[..end].trim().to_string());
            }
        }
    }
    if t.starts_with('[') || t.starts_with('{') {
        return Some(t.to_string());
    }
    None
}

#[tauri::command]
pub fn ai_chat(messages: Vec<ChatMessage>) -> Result<String, String> {
    tracing::info!("AI chat: {} messages", messages.len());
    let cfg = read_raw_config()?;
    let config = AiClientConfig::from_map(&cfg).map_err(String::from)?;

    let msg_values: Vec<serde_json::Value> = messages
        .into_iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    ai_client::chat(&config, msg_values, 0.2).map_err(String::from)
}

/// AI chat response with referenced clip IDs for attribution.
#[derive(Debug, Serialize)]
pub struct AiChatResponse {
    pub content: String,
    pub referenced_clip_ids: Vec<i64>,
}

/// AI chat with automatic context: gathers recent clips for context.
#[tauri::command]
pub fn ai_chat_with_context(messages: Vec<ChatMessage>) -> Result<AiChatResponse, String> {
    let conn = open_db()?;

    // Gather recent web clips with IDs for reference tracking
    let mut clip_ids: Vec<i64> = Vec::new();
    let clips_ctx: String = {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, summary, tags, url FROM web_clips
                 WHERE deleted_at IS NULL
                 ORDER BY datetime(created_at) DESC LIMIT 20",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut buf = String::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let id: i64 = row.get(0).map_err(|e| e.to_string())?;
            let title: String = row.get(1).map_err(|e| e.to_string())?;
            let summary: String = row.get(2).map_err(|e| e.to_string())?;
            let tags: String = row.get(3).map_err(|e| e.to_string())?;
            let url: String = row.get(4).map_err(|e| e.to_string())?;
            let domain = url
                .split("//")
                .nth(1)
                .and_then(|s| s.split('/').next())
                .unwrap_or("");
            let desc = if summary.is_empty() {
                title.clone()
            } else {
                format!("{}: {}", title, summary)
            };
            buf.push_str(&format!("- [ID:{}][{}] {} (标签:{})\n", id, domain, desc, tags));
            clip_ids.push(id);
        }
        buf
    };

    // Gather collections
    let collections_ctx: String = {
        let mut stmt = conn
            .prepare("SELECT name FROM collections ORDER BY updated_at DESC LIMIT 10")
            .map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .flatten()
            .collect();
        if names.is_empty() {
            String::new()
        } else {
            format!("\n## 用户的知识集合\n{}\n", names.join(", "))
        }
    };

    // Gather recent notes
    let notes_ctx: String = {
        let mut stmt = conn
            .prepare(
                "SELECT cn.content, wc.title FROM clip_notes cn
                 JOIN web_clips wc ON cn.clip_id = wc.id
                 WHERE wc.deleted_at IS NULL
                 ORDER BY cn.updated_at DESC LIMIT 5",
            )
            .map_err(|e| e.to_string())?;
        let mut buf = String::new();
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let content: String = row.get(0).map_err(|e| e.to_string())?;
            let title: String = row.get(1).map_err(|e| e.to_string())?;
            buf.push_str(&format!("- 关于「{}」的笔记: {}\n", title, content.chars().take(100).collect::<String>()));
        }
        if buf.is_empty() {
            String::new()
        } else {
            format!("\n## 用户的学习笔记\n{}", buf)
        }
    };

    let system_prompt = format!(
        "你是 KnoYoo AI 知识助手。用户有一个个人知识库，以下是知识库中的内容。\n\n\
        **重要规则：回答问题时必须优先基于知识库中的内容。**\n\
        - 如果知识库中有相关信息，直接引用并回答，使用 [ID:数字] 格式标注来源\n\
        - 如果知识库中没有相关信息，再用你自己的知识补充，并说明这不是来自用户的知识库\n\n\
        ## 用户知识库\n{}{}{}",
        if clips_ctx.is_empty() {
            "（知识库暂无内容）\n"
        } else {
            &clips_ctx
        },
        collections_ctx,
        notes_ctx,
    );

    let mut full_messages: Vec<serde_json::Value> =
        vec![serde_json::json!({"role": "system", "content": system_prompt})];
    for m in &messages {
        full_messages.push(serde_json::json!({"role": m.role, "content": m.content}));
    }

    let cfg = read_raw_config()?;
    let config = AiClientConfig::from_map(&cfg).map_err(String::from)?;
    let content = ai_client::chat(&config, full_messages, 0.3).map_err(String::from)?;

    // Extract referenced clip IDs from the AI response (looks for [ID:123] patterns)
    let referenced: Vec<i64> = content
        .split("[ID:")
        .skip(1)
        .filter_map(|s| s.split(']').next()?.parse::<i64>().ok())
        .filter(|id| clip_ids.contains(id))
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    Ok(AiChatResponse {
        content,
        referenced_clip_ids: referenced,
    })
}

// ── Ollama Detection ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct OllamaStatus {
    pub running: bool,
    pub models: Vec<String>,
}

/// Check if Ollama is running locally and list available models.
#[tauri::command]
pub fn detect_ollama() -> Result<OllamaStatus, String> {
    let resp = ureq::get("http://localhost:11434/api/tags")
        .timeout(std::time::Duration::from_secs(2))
        .call();

    match resp {
        Ok(r) if r.status() == 200 => {
            let body: serde_json::Value = r.into_json().unwrap_or_default();
            let models = body["models"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            Ok(OllamaStatus {
                running: true,
                models,
            })
        }
        _ => Ok(OllamaStatus {
            running: false,
            models: vec![],
        }),
    }
}

/// Auto-configure Ollama as the AI provider.
#[tauri::command]
pub fn auto_configure_ollama(model: String) -> Result<(), String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let pairs = [
        ("provider", "ollama"),
        ("api_base", "http://localhost:11434"),
        ("api_key", "ollama"),
    ];
    for (k, v) in pairs {
        tx.execute(
            "INSERT INTO app_kv(key, val) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET val=excluded.val",
            rusqlite::params![k, v],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT INTO app_kv(key, val) VALUES('model', ?1)
         ON CONFLICT(key) DO UPDATE SET val=excluded.val",
        rusqlite::params![model],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Proactive Suggestions ────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AiSuggestion {
    pub suggestion_type: String,
    pub title: String,
    pub description: String,
}

/// Rule-based suggestions (no AI call needed).
#[tauri::command]
pub fn ai_suggest_actions() -> Result<Vec<AiSuggestion>, String> {
    let conn = open_db()?;
    let mut suggestions = Vec::new();

    // Check unread pile-up
    let unread_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM web_clips WHERE is_read = 0 AND deleted_at IS NULL", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if unread_count >= 10 {
        suggestions.push(AiSuggestion {
            suggestion_type: "review_clips".to_string(),
            title: format!("你有 {} 条未读收藏", unread_count),
            description: "找时间回顾一下最近收藏的内容".to_string(),
        });
    }

    // Check tag clusters that could become collections
    let mut stmt = conn
        .prepare("SELECT tags FROM web_clips WHERE tags != '[]' AND deleted_at IS NULL")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    let mut tag_counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for r in rows {
        let json_str = r.map_err(|e| e.to_string())?;
        if let Ok(tags) = serde_json::from_str::<Vec<String>>(&json_str) {
            for t in tags {
                *tag_counts.entry(t).or_insert(0) += 1;
            }
        }
    }
    for (tag, count) in &tag_counts {
        if *count >= 5 {
            suggestions.push(AiSuggestion {
                suggestion_type: "create_collection".to_string(),
                title: format!("关于「{}」的收藏已有 {} 条", tag, count),
                description: "是否要创建一个专题集合？".to_string(),
            });
        }
    }

    // Limit to 3 suggestions
    suggestions.truncate(3);
    Ok(suggestions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_json_plain_object() {
        let input = r#"{"name":"test","delta":5}"#;
        let result = extract_json(input);
        assert_eq!(result, Some(r#"{"name":"test","delta":5}"#.to_string()));
    }

    #[test]
    fn extract_json_plain_array() {
        let input = r#"[{"name":"a"},{"name":"b"}]"#;
        let result = extract_json(input);
        assert_eq!(result, Some(input.to_string()));
    }

    #[test]
    fn extract_json_with_whitespace() {
        let input = "  { \"key\": \"val\" }  ";
        let result = extract_json(input);
        assert_eq!(result, Some("{ \"key\": \"val\" }".to_string()));
    }

    #[test]
    fn extract_json_code_fence() {
        let input = "```json\n{\"name\":\"test\"}\n```";
        let result = extract_json(input);
        assert_eq!(result, Some("{\"name\":\"test\"}".to_string()));
    }

    #[test]
    fn extract_json_code_fence_with_extra_whitespace() {
        let input = "```json\n  [1, 2, 3]  \n```";
        let result = extract_json(input);
        assert_eq!(result, Some("[1, 2, 3]".to_string()));
    }

    #[test]
    fn extract_json_plain_text_returns_none() {
        let input = "This is just plain text with no JSON.";
        let result = extract_json(input);
        assert_eq!(result, None);
    }

    #[test]
    fn extract_json_empty_string_returns_none() {
        let result = extract_json("");
        assert_eq!(result, None);
    }
}
