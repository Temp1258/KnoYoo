use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::ai_client::{self, AiClientConfig};
use crate::db::{
    ai_keychain_account_for, kv_get, migrate_ai_keys_to_keychain, open_db, set_kv,
};
use crate::models::ChatMessage;
use crate::secrets;

/// Providers the settings UI knows how to preset. We read/write keychain
/// entries only for these — the list doubles as an allowlist to prevent a
/// malformed `provider` field from polluting the keychain namespace.
const SUPPORTED_AI_PROVIDERS: &[&str] = &[
    "deepseek",
    "silicon",
    "dashscope",
    "zhipu",
    "moonshot",
    "ollama",
    "openai",
    "anthropic",
];

/// Per-provider state surfaced to the frontend. API keys live in the OS
/// keychain and never reach the UI — the only signal is `configured`.
#[derive(Serialize, Debug, Default, Clone)]
pub struct AiProviderState {
    pub configured: bool,
    pub api_base: String,
    pub model: String,
    /// Last four chars of the stored key (the "尾号"). Empty when
    /// `configured` is false. Computed live from the keychain entry on
    /// every `get_ai_config` — never persisted to `SQLite`, so backups stay
    /// truly key-free.
    pub key_hint: String,
}

#[derive(Serialize, Debug, Default)]
pub struct AiFullConfig {
    /// Currently active provider id (`""` if none picked yet).
    pub provider: String,
    /// Mirrors `providers[provider].api_base` for the active edit form.
    pub api_base: String,
    /// Mirrors `providers[provider].model` for the active edit form.
    pub model: String,
    pub providers: BTreeMap<String, AiProviderState>,
}

#[derive(Deserialize, Debug, Default)]
pub struct AiSetCfg {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub api_base: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    /// Three-state semantics, same as ASR:
    ///   - `None`         → leave stored key alone
    ///   - `Some("")`     → explicit keychain delete
    ///   - `Some("sk-…")` → write to keychain under `ai_<provider>`
    #[serde(default)]
    pub api_key: Option<String>,
}

/// Read AI config for the settings panel.
///
/// Crucially: this path never probes the OS keychain. The "is configured"
/// signal + 尾号 hint are mirrored into `app_kv` by `set_ai_config` / the
/// migration, so rendering the settings screen never triggers a keychain
/// authorization prompt — previously 8 providers × 1 probe = 8 prompts on
/// every settings open, which was unusable on dev builds with unstable
/// code signatures. Raw keys still ONLY live in the keychain.
#[tauri::command]
pub fn get_ai_config() -> Result<AiFullConfig, String> {
    let conn = open_db()?;
    migrate_ai_keys_to_keychain(&conn)?;

    let active = kv_get(&conn, "ai_selected_provider")?.unwrap_or_default();
    let mut providers: BTreeMap<String, AiProviderState> = BTreeMap::new();
    for p in SUPPORTED_AI_PROVIDERS {
        let configured = kv_get(&conn, &format!("ai_configured__{p}"))?
            .is_some_and(|v| v == "true");
        let key_hint = kv_get(&conn, &format!("ai_key_hint__{p}"))?.unwrap_or_default();
        let api_base = kv_get(&conn, &format!("ai_api_base__{p}"))?.unwrap_or_default();
        let model = kv_get(&conn, &format!("ai_model__{p}"))?.unwrap_or_default();
        providers.insert(
            (*p).to_string(),
            AiProviderState {
                configured,
                api_base,
                model,
                key_hint,
            },
        );
    }

    let active_state = providers.get(&active).cloned().unwrap_or_default();
    Ok(AiFullConfig {
        provider: active,
        api_base: active_state.api_base,
        model: active_state.model,
        providers,
    })
}

/// Persist partial AI config updates. See `AiSetCfg` for field semantics.
#[tauri::command]
pub fn set_ai_config(cfg: AiSetCfg) -> Result<(), String> {
    let conn = open_db()?;
    migrate_ai_keys_to_keychain(&conn)?;

    // 1. Active selection
    if let Some(p) = cfg.provider.as_deref() {
        let trimmed = p.trim();
        if !trimmed.is_empty() && !SUPPORTED_AI_PROVIDERS.contains(&trimmed) {
            return Err(format!("不允许的 AI 提供商: {trimmed}"));
        }
        set_kv(&conn, "ai_selected_provider", trimmed)?;
    }

    // 2. Per-provider writes need a target. Prefer the just-set value;
    //    fall back to the stored selection.
    let target = match cfg.provider.as_deref() {
        Some(p) if !p.trim().is_empty() => p.trim().to_string(),
        _ => kv_get(&conn, "ai_selected_provider")?.unwrap_or_default(),
    };
    if target.is_empty() {
        return Ok(());
    }

    if let Some(key) = cfg.api_key.as_ref() {
        let account = ai_keychain_account_for(&target);
        let trimmed = key.trim();
        if trimmed.is_empty() {
            // Explicit delete. Wipe the flag + hint too so the UI flips
            // to "未配置" on the next read.
            secrets::delete(&account).map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM app_kv WHERE key = ?1",
                [format!("ai_configured__{target}")],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM app_kv WHERE key = ?1",
                [format!("ai_key_hint__{target}")],
            )
            .map_err(|e| e.to_string())?;
        } else {
            secrets::set(&account, trimmed).map_err(|e| e.to_string())?;
            // Mirror the non-secret "is configured" + 尾号 into app_kv so
            // the settings screen can render without a keychain probe.
            set_kv(&conn, &format!("ai_configured__{target}"), "true")?;
            set_kv(
                &conn,
                &format!("ai_key_hint__{target}"),
                &secrets::key_last_four(trimmed),
            )?;
        }
    }
    if let Some(b) = cfg.api_base.as_ref() {
        set_kv(&conn, &format!("ai_api_base__{target}"), b.trim())?;
    }
    if let Some(m) = cfg.model.as_ref() {
        set_kv(&conn, &format!("ai_model__{target}"), m.trim())?;
    }
    Ok(())
}

/// Read raw (unmasked) AI config. Used by every in-process caller that
/// needs to actually talk to the AI provider — they see real values.
fn read_raw_config() -> Result<std::collections::HashMap<String, String>, String> {
    let conn = open_db()?;
    crate::db::read_ai_config(&conn)
}

/// Copy an already-stored API key from one role slot to the other for
/// a dual-role logical provider (e.g. `SiliconFlow` or `OpenAI`, where the
/// same account-level key works for both chat and audio endpoints).
///
/// Callers pass the AI provider id (`silicon` / `openai`) and the ASR
/// provider id (`siliconflow` / `openai`) that make up the logical pair.
/// The command figures out which side already has a key, reads it, and
/// mirrors it to the empty side — users don't need to re-paste or
/// even know the key exists anymore.
///
/// Returns a short human-readable status for the toast.
#[tauri::command]
#[allow(non_snake_case)]
pub fn sync_dual_role_key(
    aiProvider: String,
    asrProvider: String,
) -> Result<String, String> {
    let ai_acc = ai_keychain_account_for(&aiProvider);
    let asr_acc = format!("asr_{asrProvider}");

    let ai_key = secrets::get(&ai_acc).map_err(|e| e.to_string())?;
    let asr_key = secrets::get(&asr_acc).map_err(|e| e.to_string())?;

    match (ai_key, asr_key) {
        (Some(k), None) if !k.is_empty() => {
            // Copy AI → ASR
            secrets::set(&asr_acc, &k).map_err(|e| e.to_string())?;
            let conn = open_db()?;
            set_kv(&conn, &format!("asr_configured__{asrProvider}"), "true")?;
            set_kv(
                &conn,
                &format!("asr_key_hint__{asrProvider}"),
                &secrets::key_last_four(&k),
            )?;
            Ok("已同步到视频转录".to_string())
        }
        (None, Some(k)) if !k.is_empty() => {
            // Copy ASR → AI
            secrets::set(&ai_acc, &k).map_err(|e| e.to_string())?;
            let conn = open_db()?;
            set_kv(&conn, &format!("ai_configured__{aiProvider}"), "true")?;
            set_kv(
                &conn,
                &format!("ai_key_hint__{aiProvider}"),
                &secrets::key_last_four(&k),
            )?;
            Ok("已同步到 AI 文本".to_string())
        }
        (Some(_), Some(_)) => Ok("两边都已配置，无需同步".to_string()),
        _ => Err("两边都未配置，没有可同步的 Key".to_string()),
    }
}

/// Nuclear option: delete every `KnoYoo` keychain entry (AI + ASR) and clear
/// the `app_kv` `configured` / `key_hint` flags. Useful when the keychain's
/// ACL is in a bad state (common in dev builds where the binary's code
/// signature shifts across rebuilds and macOS insists on reprompting).
/// After this the settings panel shows "all 未配置"; user re-enters keys
/// which re-establishes clean ACL ownership for the current binary.
#[tauri::command]
pub fn reset_api_keys() -> Result<usize, String> {
    let removed = secrets::clear_all_knoyoo_secrets().map_err(|e| e.to_string())?;
    let conn = open_db()?;
    conn.execute(
        "DELETE FROM app_kv WHERE \
            key LIKE 'ai_configured__%' OR key LIKE 'ai_key_hint__%' OR \
            key LIKE 'asr_configured__%' OR key LIKE 'asr_key_hint__%'",
        [],
    )
    .map_err(|e| e.to_string())?;
    tracing::info!("reset_api_keys: cleared {} keychain accounts", removed);
    Ok(removed)
}


/// Test AI connection: makes a real API call with minimal text.
///
/// Takes an optional `cfg` override. When the settings panel passes the
/// live form values in, we use those directly — no keychain write, no
/// keychain read (unless the user is testing a previously-stored key
/// without retyping it, in which case we do one read). This avoids the
/// old "save-then-test" round-trip that cost 2-3 keychain prompts per
/// click in dev builds.
#[tauri::command]
pub fn ai_smoketest(cfg: Option<AiSetCfg>) -> Result<String, String> {
    let cfg_map = build_smoketest_config(cfg)?;

    let provider = cfg_map.get("provider").cloned().unwrap_or_default();
    let api_key = cfg_map.get("api_key").cloned().unwrap_or_default();
    if provider.is_empty() {
        return Ok("未选择 AI 提供商".to_string());
    }
    if api_key.is_empty() {
        return Ok("未填写 API Key".to_string());
    }

    let config = match AiClientConfig::from_map(&cfg_map) {
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

/// Merge a frontend override onto stored config for smoketest purposes.
///
/// Precedence for each field: explicit non-empty override → per-provider
/// stored value in `app_kv` → nothing. The `api_key` is special: only read
/// from keychain as a fallback when the override didn't provide one —
/// this minimises keychain access to at most one op per smoketest.
fn build_smoketest_config(
    override_cfg: Option<AiSetCfg>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let Some(o) = override_cfg else {
        return read_raw_config();
    };

    let mut m = std::collections::HashMap::new();

    // Provider — required for everything else.
    let provider = match o.provider.as_deref().map(str::trim) {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => return read_raw_config(),
    };
    if !SUPPORTED_AI_PROVIDERS.contains(&provider.as_str()) {
        return Err(format!("不允许的 AI 提供商: {provider}"));
    }
    m.insert("provider".into(), provider.clone());

    let conn = open_db()?;

    // api_base / model: override first, fall back to stored per-provider.
    match o.api_base.as_deref().map(str::trim) {
        Some(v) if !v.is_empty() => {
            m.insert("api_base".into(), v.to_string());
        }
        _ => {
            if let Some(v) = kv_get(&conn, &format!("ai_api_base__{provider}"))? {
                if !v.is_empty() {
                    m.insert("api_base".into(), v);
                }
            }
        }
    }
    match o.model.as_deref().map(str::trim) {
        Some(v) if !v.is_empty() => {
            m.insert("model".into(), v.to_string());
        }
        _ => {
            if let Some(v) = kv_get(&conn, &format!("ai_model__{provider}"))? {
                if !v.is_empty() {
                    m.insert("model".into(), v);
                }
            }
        }
    }

    // api_key: explicit override wins. Otherwise fall back to keychain
    // (that's the one necessary read if user is testing an already-stored
    // key without retyping).
    match o.api_key.as_deref().map(str::trim) {
        Some(k) if !k.is_empty() => {
            m.insert("api_key".into(), k.to_string());
        }
        _ => {
            if let Some(stored) = secrets::get(&ai_keychain_account_for(&provider))
                .map_err(|e| e.to_string())?
            {
                if !stored.is_empty() {
                    m.insert("api_key".into(), stored);
                }
            }
        }
    }

    Ok(m)
}

/// Extract JSON from AI response (allows ```json ... ``` wrapping).
pub fn extract_json(s: &str) -> Option<String> {
    let t = s.trim();

    // 1. Code-fenced JSON — the common shape for JSON-instructed models.
    if t.starts_with("```") {
        if let Some(start) = t.find('\n') {
            let body = &t[start + 1..];
            if let Some(end) = body.rfind("```") {
                let inner = body[..end].trim();
                // Even inside a fence the model sometimes adds filler — try
                // to pull out a balanced block if the raw inner doesn't parse.
                if inner.starts_with('{') || inner.starts_with('[') {
                    return Some(inner.to_string());
                }
                if let Some(found) = find_balanced_json(inner) {
                    return Some(found);
                }
            }
        }
    }

    // 2. Raw JSON at the start of the reply.
    if t.starts_with('[') || t.starts_with('{') {
        return Some(t.to_string());
    }

    // 3. Preamble / postscript fallback: models often say
    //    "Sure, here's the JSON: {...}" — find the first balanced {...} or
    //    [...] block anywhere in the reply. This rescues responses that
    //    previously fell through to the raw-reply path and failed parsing.
    find_balanced_json(t)
}

/// Scan `s` for the first complete, top-level JSON object or array (matched
/// braces / brackets, string-aware). Returns the slice if found.
fn find_balanced_json(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'{' || b == b'[' {
            let (open, close) = if b == b'{' { (b'{', b'}') } else { (b'[', b']') };
            let mut depth = 0i32;
            let mut in_str = false;
            let mut escape = false;
            let mut j = i;
            while j < bytes.len() {
                let c = bytes[j];
                if escape {
                    escape = false;
                    j += 1;
                    continue;
                }
                if in_str {
                    if c == b'\\' {
                        escape = true;
                    } else if c == b'"' {
                        in_str = false;
                    }
                } else if c == b'"' {
                    in_str = true;
                } else if c == open {
                    depth += 1;
                } else if c == close {
                    depth -= 1;
                    if depth == 0 {
                        // Ensure the extracted slice lands on char boundaries
                        // so non-ASCII reply bodies don't panic in slicing.
                        if s.is_char_boundary(i) && s.is_char_boundary(j + 1) {
                            return Some(s[i..=j].to_string());
                        }
                        break;
                    }
                }
                j += 1;
            }
        }
        i += 1;
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
                format!("{title}: {summary}")
            };
            buf.push_str(&format!("- [ID:{id}][{domain}] {desc} (标签:{tags})\n"));
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
            format!("\n## 用户的学习笔记\n{buf}")
        }
    };

    let system_prompt = format!(
        "你是 KnoYoo AI 知识助手。用户有一个个人智库，以下是智库中的内容。\n\n\
        **重要规则：回答问题时必须优先基于智库中的内容。**\n\
        - 如果智库中有相关信息，直接引用并回答，使用 [ID:数字] 格式标注来源\n\
        - 如果智库中没有相关信息，再用你自己的知识补充，并说明这不是来自用户的智库\n\n\
        ## 用户智库\n{}{}{}",
        if clips_ctx.is_empty() {
            "（智库暂无内容）\n"
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
/// Always succeeds — connection/parse failures report `running: false`
/// so the UI can show a disabled state instead of an error toast.
#[tauri::command]
pub fn detect_ollama() -> OllamaStatus {
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
                        .filter_map(|m| m["name"].as_str().map(std::string::ToString::to_string))
                        .collect()
                })
                .unwrap_or_default();
            OllamaStatus {
                running: true,
                models,
            }
        }
        _ => OllamaStatus {
            running: false,
            models: vec![],
        },
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
            title: format!("你有 {unread_count} 条未读收藏"),
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
                title: format!("关于「{tag}」的收藏已有 {count} 条"),
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
    fn extract_json_with_preamble() {
        let input = "好的，这是分析结果：{\"title\":\"x\",\"tags\":[\"a\"]}";
        let result = extract_json(input);
        assert_eq!(result, Some(r#"{"title":"x","tags":["a"]}"#.to_string()));
    }

    #[test]
    fn extract_json_with_preamble_and_postscript() {
        let input = "Sure, here is the JSON:\n{\"k\":1}\n希望有帮助。";
        let result = extract_json(input);
        assert_eq!(result, Some(r#"{"k":1}"#.to_string()));
    }

    #[test]
    fn extract_json_respects_braces_inside_strings() {
        let input = r#"Reply: {"a":"hello {world}","b":[1,2]}  done."#;
        let result = extract_json(input);
        assert_eq!(
            result,
            Some(r#"{"a":"hello {world}","b":[1,2]}"#.to_string())
        );
    }

    #[test]
    fn extract_json_empty_string_returns_none() {
        let result = extract_json("");
        assert_eq!(result, None);
    }
}
