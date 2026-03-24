use std::collections::HashMap;

use crate::ai_client::{self, AiClientConfig};
use crate::db::open_db;
use crate::models::ChatMessage;

/// 读取 AI 配置：返回 {provider, api_base, api_key, model}
#[tauri::command]
pub fn get_ai_config() -> Result<HashMap<String, String>, String> {
    let conn = open_db()?;
    crate::db::read_ai_config(&conn)
}

/// Allowed keys for AI configuration — prevents overwriting arbitrary app_kv entries.
const ALLOWED_AI_KEYS: &[&str] = &["provider", "api_base", "api_key", "model"];

/// 写入 AI 配置：传 {provider?, api_base?, api_key?, model?}，仅更新提供的键
#[tauri::command]
pub fn set_ai_config(cfg: HashMap<String, String>) -> Result<(), String> {
    for k in cfg.keys() {
        if !ALLOWED_AI_KEYS.contains(&k.as_str()) {
            return Err(format!("不允许的配置键: {k}"));
        }
    }
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (k, v) in cfg {
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

/// 冒烟自检（不联外网）：若配置齐全返回 "ok"，否则返回提示字符串
#[tauri::command]
pub fn ai_smoketest() -> Result<String, String> {
    let cfg = get_ai_config()?;
    let provider = cfg.get("provider").cloned().unwrap_or_default();
    let api_key = cfg.get("api_key").cloned().unwrap_or_default();
    if provider.is_empty() {
        return Ok("provider is empty".to_string());
    }
    if api_key.is_empty() {
        return Ok("api_key is empty".to_string());
    }
    Ok("ok".to_string())
}

/// 从大模型回复里提取 JSON（允许 ```json ... ``` 包裹）
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
    let cfg = get_ai_config()?;
    let config = AiClientConfig::from_map(&cfg).map_err(String::from)?;

    let msg_values: Vec<serde_json::Value> = messages
        .into_iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    ai_client::chat(&config, msg_values, 0.2).map_err(String::from)
}

/// AI chat with automatic context: gathers recent notes, plans, skill tree
#[tauri::command]
#[allow(non_snake_case)]
pub fn ai_chat_with_context(
    messages: Vec<ChatMessage>,
    selectedNoteId: Option<i64>,
) -> Result<String, String> {
    let conn = open_db()?;

    // 1. Gather recent notes (title + first 200 chars of content)
    let notes_ctx: String = {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, SUBSTR(content, 1, 200) FROM notes ORDER BY datetime(created_at) DESC LIMIT 20",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut buf = String::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let id: i64 = row.get(0).map_err(|e| e.to_string())?;
            let title: String = row.get(1).map_err(|e| e.to_string())?;
            let content: String = row.get(2).map_err(|e| e.to_string())?;
            buf.push_str(&format!("- [笔记#{}] {}: {}\n", id, title, content));
        }
        buf
    };

    // 2. Gather TODO plans (limit 20)
    let plans_ctx: String = {
        let mut stmt = conn
            .prepare(
                "SELECT title, due, status FROM plan_task WHERE status='TODO' ORDER BY COALESCE(due,'9999') ASC LIMIT 20",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut buf = String::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let title: String = row.get(0).map_err(|e| e.to_string())?;
            let due: Option<String> = row.get(1).map_err(|e| e.to_string())?;
            let due_str = due.unwrap_or_else(|| "无期限".to_string());
            buf.push_str(&format!("- {} (截止: {})\n", title, due_str));
        }
        buf
    };

    // 3. Gather skill tree root + children names
    let tree_ctx: String = {
        let mut stmt = conn
            .prepare(
                "SELECT s.name, p.name AS parent_name
                 FROM industry_skill s
                 LEFT JOIN industry_skill p ON s.parent_id = p.id
                 ORDER BY COALESCE(s.parent_id, 0), s.id
                 LIMIT 50",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut buf = String::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let name: String = row.get(0).map_err(|e| e.to_string())?;
            let parent: Option<String> = row.get(1).map_err(|e| e.to_string())?;
            match parent {
                Some(p) => buf.push_str(&format!("- {} > {}\n", p, name)),
                None => buf.push_str(&format!("- [根] {}\n", name)),
            }
        }
        buf
    };

    // 4. Gather recent web clips (title + summary + tags)
    let clips_ctx: String = {
        let mut stmt = conn
            .prepare(
                "SELECT title, summary, tags, url FROM web_clips
                 ORDER BY datetime(created_at) DESC LIMIT 15",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut buf = String::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let title: String = row.get(0).map_err(|e| e.to_string())?;
            let summary: String = row.get(1).map_err(|e| e.to_string())?;
            let tags: String = row.get(2).map_err(|e| e.to_string())?;
            let url: String = row.get(3).map_err(|e| e.to_string())?;
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
            buf.push_str(&format!("- [{}] {} (标签:{})\n", domain, desc, tags));
        }
        buf
    };

    // 5. If selected note, get full content
    let selected_ctx: String = if let Some(nid) = selectedNoteId {
        conn.query_row("SELECT title, content FROM notes WHERE id=?1", [nid], |r| {
            let t: String = r.get(0)?;
            let c: String = r.get(1)?;
            Ok(format!("【当前笔记】标题：{}\n内容：{}\n", t, c))
        })
        .unwrap_or_default()
    } else {
        String::new()
    };

    // 5. Build system prompt
    let career_goal = crate::db::kv_get(&conn, "career_goal")?.unwrap_or_default();
    let goal_ctx = if career_goal.is_empty() {
        String::new()
    } else {
        format!("用户的职业目标是：{}\n\n", career_goal)
    };

    let system_prompt = format!(
        "你是 KnoYoo AI 成长教练，一个温暖、专业的职业发展顾问。{}\
以下是用户的学习数据，请结合这些信息提供针对性的学习建议和指导。\
回答时请用教练的口吻，既鼓励又务实。\n\n\
        ## 最近笔记\n{}\n\
        ## 待办计划\n{}\n\
        ## 技能树\n{}\n\
        ## 最近收藏\n{}\n\
        {}",
        goal_ctx,
        if notes_ctx.is_empty() {
            "暂无笔记\n"
        } else {
            &notes_ctx
        },
        if plans_ctx.is_empty() {
            "暂无计划\n"
        } else {
            &plans_ctx
        },
        if tree_ctx.is_empty() {
            "暂无技能\n"
        } else {
            &tree_ctx
        },
        if clips_ctx.is_empty() {
            "暂无收藏\n"
        } else {
            &clips_ctx
        },
        selected_ctx,
    );

    // 6. Build message list
    let mut full_messages: Vec<serde_json::Value> =
        vec![serde_json::json!({"role": "system", "content": system_prompt})];
    for m in &messages {
        full_messages.push(serde_json::json!({"role": m.role, "content": m.content}));
    }

    // 7. Call AI API via ai_client
    let cfg = get_ai_config()?;
    let config = AiClientConfig::from_map(&cfg).map_err(String::from)?;
    ai_client::chat(&config, full_messages, 0.3).map_err(String::from)
}

/// Read a file (TXT/MD), send to AI to extract knowledge points, save as notes
#[tauri::command]
#[allow(non_snake_case)]
pub fn ai_generate_notes_from_file(filePath: String) -> Result<Vec<crate::models::Note>, String> {
    use std::fs;

    let path = std::path::Path::new(&filePath);

    // Security: canonicalize path and validate it exists
    let canonical = path
        .canonicalize()
        .map_err(|_| "文件不存在或路径无效".to_string())?;

    // Reject paths containing suspicious traversal patterns
    let path_str = canonical.to_string_lossy();
    if path_str.contains("..") {
        return Err("不允许的文件路径".into());
    }

    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let text = match ext.as_str() {
        "txt" | "md" | "markdown" | "text" => {
            fs::read_to_string(&canonical).map_err(|e| format!("读取文件失败: {e}"))?
        }
        _ => return Err(format!("不支持的文件格式: .{}，目前支持 .txt 和 .md", ext)),
    };

    if text.trim().is_empty() {
        return Err("文件内容为空".into());
    }

    // Truncate to ~8000 chars to fit in AI context
    let truncated: String = text.chars().take(8000).collect();

    let cfg = get_ai_config()?;
    let config = AiClientConfig::from_map(&cfg).map_err(String::from)?;

    let sys = "你是知识提取助手。请阅读用户提供的文本，从中提取 3~8 个关键知识点，每个知识点作为一条独立笔记。\
输出严格 JSON：{\"notes\":[{\"title\":\"简短标题\",\"content\":\"详细内容（100~300字）\"}, ...]}。\
只输出 JSON，不要其他文字。";

    let usr = format!("请从以下文本中提取知识点：\n\n{}", truncated);

    let messages = vec![
        serde_json::json!({"role": "system", "content": sys}),
        serde_json::json!({"role": "user", "content": usr}),
    ];

    let content = ai_client::chat_json(&config, messages, 0.3).map_err(String::from)?;

    let parsed: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("AI JSON 解析失败: {e}"))?;
    let notes_arr = parsed["notes"].as_array().ok_or("AI 未返回 notes 数组")?;

    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut result: Vec<crate::models::Note> = Vec::new();

    for item in notes_arr {
        let title = item["title"].as_str().unwrap_or("").trim().to_string();
        let content = item["content"].as_str().unwrap_or("").trim().to_string();
        if title.is_empty() || content.is_empty() {
            continue;
        }
        tx.execute(
            "INSERT INTO notes (title, content) VALUES (?1, ?2)",
            rusqlite::params![&title, &content],
        )
        .map_err(|e| e.to_string())?;
        let id = tx.last_insert_rowid();
        let created_at: String = tx
            .query_row("SELECT created_at FROM notes WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        result.push(crate::models::Note {
            id,
            title,
            content,
            created_at,
            is_favorite: false,
        });
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
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
