use std::collections::HashMap;

use crate::db::open_db;
use crate::models::ChatMessage;

/// 读取 AI 配置：返回 {provider, api_base, api_key, model}
#[tauri::command]
pub fn get_ai_config() -> Result<HashMap<String, String>, String> {
    let conn = open_db()?;
    crate::db::read_ai_config(&conn)
}

/// 写入 AI 配置：传 {provider?, api_base?, api_key?, model?}，仅更新提供的键
#[tauri::command]
pub fn set_ai_config(cfg: HashMap<String, String>) -> Result<(), String> {
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

/// 向 OpenAI 兼容接口发起归类请求，返回 (skill_name, delta) 列表
pub fn ai_pick_skills(text: &str, cfg: &HashMap<String, String>) -> Result<Vec<(String, i64)>, String> {
    let api_base = cfg.get("api_base").cloned().unwrap_or_default();
    let api_key = cfg.get("api_key").cloned().unwrap_or_default();
    let model = cfg
        .get("model")
        .cloned()
        .unwrap_or_else(|| crate::models::DEFAULT_MODEL.to_string());

    if api_base.is_empty() {
        return Err("api_base is empty".into());
    }
    if api_key.is_empty() {
        return Err("api_key is empty".into());
    }

    let url = format!("{}/v1/chat/completions", api_base.trim_end_matches('/'));

    let system = r#"你是一个技能归类助手。请从用户文本中提取最相关的"行业技能"，
将输出限制在 8 项内，并严格返回 JSON 数组：
[{"name":"技能名称","delta":整数(1~20)}]
只输出 JSON，不要有其他文字。"#;

    let user = format!("用户文本：\n{}", text);

    let body = serde_json::json!({
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role":"system", "content": system},
            {"role":"user", "content": user}
        ]
    });

    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", "application/json")
        .send_json(body)
        .map_err(|e| format!("http error: {}", e))?;

    let status = resp.status();
    if status < 200 || status >= 300 {
        return Err(format!("api status {}", status));
    }

    let resp_body: crate::models::ChatCompletionResponse = resp.into_json().map_err(|e| format!("解析 AI 响应失败：{e}"))?;
    let content = resp_body.choices.first()
        .and_then(|c| c.message.content.as_deref())
        .ok_or("AI 未返回有效内容")?;

    let json_s = extract_json(content).ok_or("model did not return JSON")?;
    let arr: serde_json::Value =
        serde_json::from_str(&json_s).map_err(|e| format!("bad json: {}", e))?;

    let mut out = Vec::new();
    if let Some(items) = arr.as_array() {
        for it in items {
            let name = it.get("name").and_then(|x| x.as_str()).unwrap_or("").trim();
            if name.is_empty() {
                continue;
            }
            let mut delta = it.get("delta").and_then(|x| x.as_i64()).unwrap_or(10);
            if delta < 1 {
                delta = 1;
            }
            if delta > 20 {
                delta = 20;
            }
            out.push((name.to_string(), delta));
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn ai_chat(messages: Vec<ChatMessage>) -> Result<String, String> {
    tracing::info!("AI chat: {} messages", messages.len());
    let cfg = get_ai_config()?;
    let api_base = cfg.get("api_base").cloned().unwrap_or_default();
    let api_key = cfg.get("api_key").cloned().unwrap_or_default();
    let model = cfg
        .get("model")
        .cloned()
        .unwrap_or_else(|| crate::models::DEFAULT_MODEL.to_string());
    if api_base.trim().is_empty() {
        return Err("api_base is empty".into());
    }
    if api_key.trim().is_empty() {
        return Err("api_key is empty".into());
    }

    let url = format!("{}/v1/chat/completions", api_base.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "temperature": 0.2,
        "messages": messages
            .into_iter()
            .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
            .collect::<Vec<_>>()
    });

    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", "application/json")
        .send_json(body)
        .map_err(|e| format!("http error: {}", e))?;

    if resp.status() < 200 || resp.status() >= 300 {
        return Err(format!("api status {}", resp.status()));
    }
    let resp_body: crate::models::ChatCompletionResponse = resp.into_json().map_err(|e| format!("解析 AI 响应失败：{e}"))?;
    let content = resp_body.choices.first()
        .and_then(|c| c.message.content.as_deref())
        .unwrap_or("")
        .to_string();
    Ok(content)
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

    // 4. If selected note, get full content
    let selected_ctx: String = if let Some(nid) = selectedNoteId {
        conn.query_row(
            "SELECT title, content FROM notes WHERE id=?1",
            [nid],
            |r| {
                let t: String = r.get(0)?;
                let c: String = r.get(1)?;
                Ok(format!("【当前笔记】标题：{}\n内容：{}\n", t, c))
            },
        )
        .unwrap_or_default()
    } else {
        String::new()
    };

    // 5. Build system prompt
    // Get career goal for context
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
        {}",
        goal_ctx,
        if notes_ctx.is_empty() { "暂无笔记\n" } else { &notes_ctx },
        if plans_ctx.is_empty() { "暂无计划\n" } else { &plans_ctx },
        if tree_ctx.is_empty() { "暂无技能\n" } else { &tree_ctx },
        selected_ctx,
    );

    // 6. Prepend system message to user messages
    let mut full_messages: Vec<serde_json::Value> = vec![
        serde_json::json!({"role": "system", "content": system_prompt}),
    ];
    for m in &messages {
        full_messages.push(serde_json::json!({"role": m.role, "content": m.content}));
    }

    // 7. Call AI API
    let cfg = get_ai_config()?;
    let api_base = cfg.get("api_base").cloned().unwrap_or_default();
    let api_key = cfg.get("api_key").cloned().unwrap_or_default();
    let model = cfg
        .get("model")
        .cloned()
        .unwrap_or_else(|| crate::models::DEFAULT_MODEL.to_string());
    if api_base.trim().is_empty() {
        return Err("api_base is empty".into());
    }
    if api_key.trim().is_empty() {
        return Err("api_key is empty".into());
    }

    let url = format!("{}/v1/chat/completions", api_base.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "temperature": 0.3,
        "messages": full_messages
    });

    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", "application/json")
        .send_json(body)
        .map_err(|e| format!("http error: {}", e))?;

    if resp.status() < 200 || resp.status() >= 300 {
        return Err(format!("api status {}", resp.status()));
    }
    let resp_body: crate::models::ChatCompletionResponse = resp.into_json().map_err(|e| format!("解析 AI 响应失败：{e}"))?;
    let content = resp_body.choices.first()
        .and_then(|c| c.message.content.as_deref())
        .unwrap_or("")
        .to_string();
    Ok(content)
}

/// Read a file (TXT/MD), send to AI to extract knowledge points, save as notes
#[tauri::command]
#[allow(non_snake_case)]
pub fn ai_generate_notes_from_file(filePath: String) -> Result<Vec<crate::models::Note>, String> {
    use std::fs;

    let path = std::path::Path::new(&filePath);
    if !path.exists() {
        return Err("文件不存在".into());
    }

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let text = match ext.as_str() {
        "txt" | "md" | "markdown" | "text" => {
            fs::read_to_string(path).map_err(|e| format!("读取文件失败: {e}"))?
        }
        _ => return Err(format!("不支持的文件格式: .{}，目前支持 .txt 和 .md", ext)),
    };

    if text.trim().is_empty() {
        return Err("文件内容为空".into());
    }

    // Truncate to ~8000 chars to fit in AI context
    let truncated: String = text.chars().take(8000).collect();

    let cfg = get_ai_config()?;
    let api_base = cfg.get("api_base").cloned().unwrap_or_default();
    let api_key = cfg.get("api_key").cloned().unwrap_or_default();
    let model = cfg
        .get("model")
        .cloned()
        .unwrap_or_else(|| crate::models::DEFAULT_MODEL.to_string());
    if api_base.trim().is_empty() || api_key.trim().is_empty() {
        return Err("AI 配置缺失，请先配置 api_base 和 api_key".into());
    }

    let url = format!("{}/v1/chat/completions", api_base.trim_end_matches('/'));

    let sys = "你是知识提取助手。请阅读用户提供的文本，从中提取 3~8 个关键知识点，每个知识点作为一条独立笔记。\
输出严格 JSON：{\"notes\":[{\"title\":\"简短标题\",\"content\":\"详细内容（100~300字）\"}, ...]}。\
只输出 JSON，不要其他文字。";

    let usr = format!("请从以下文本中提取知识点：\n\n{}", truncated);

    let payload = serde_json::json!({
        "model": model,
        "temperature": 0.3,
        "response_format": { "type": "json_object" },
        "messages": [
            {"role": "system", "content": sys},
            {"role": "user", "content": usr}
        ]
    });

    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", "application/json")
        .send_json(payload)
        .map_err(|e| format!("AI 调用失败: {e}"))?;

    if resp.status() >= 300 {
        return Err(format!("AI HTTP {}", resp.status()));
    }

    let resp_body: crate::models::ChatCompletionResponse = resp
        .into_json()
        .map_err(|e| format!("解析 AI 响应失败: {e}"))?;
    let content = resp_body
        .choices
        .first()
        .and_then(|c| c.message.content.as_deref())
        .ok_or("AI 未返回有效内容")?;
    let parsed: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("AI JSON 解析失败: {e}"))?;
    let notes_arr = parsed["notes"]
        .as_array()
        .ok_or("AI 未返回 notes 数组")?;

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
            .query_row(
                "SELECT created_at FROM notes WHERE id=?1",
                [id],
                |r| r.get(0),
            )
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
