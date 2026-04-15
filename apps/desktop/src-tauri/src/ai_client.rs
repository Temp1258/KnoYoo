use std::collections::HashMap;
use std::io::Read as _;
use std::time::Duration;

use crate::error::AppError;
use crate::models::{ChatCompletionResponse, DEFAULT_MODEL};

/// Configuration for the AI client, read from `app_kv`.
pub struct AiClientConfig {
    pub api_base: String,
    pub api_key: String,
    pub model: String,
}

impl AiClientConfig {
    /// Build from a `HashMap` (as returned by `read_ai_config`).
    pub fn from_map(cfg: &HashMap<String, String>) -> Result<Self, AppError> {
        let api_base = cfg
            .get("api_base")
            .cloned()
            .unwrap_or_default()
            .trim()
            .to_string();
        let api_key = cfg
            .get("api_key")
            .cloned()
            .unwrap_or_default()
            .trim()
            .to_string();
        let model = cfg
            .get("model")
            .cloned()
            .unwrap_or_else(|| DEFAULT_MODEL.to_string());

        if api_base.is_empty() {
            return Err(AppError::validation("AI 配置缺失: api_base 为空"));
        }
        if api_key.is_empty() {
            return Err(AppError::validation("AI 配置缺失: api_key 为空"));
        }

        Ok(Self {
            api_base,
            api_key,
            model,
        })
    }
}

/// Default timeout for AI HTTP requests.
const AI_TIMEOUT: Duration = Duration::from_secs(60);

/// Maximum response body size (2 MB) to prevent OOM from malicious/misconfigured servers.
const MAX_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;

/// Optional overrides for the chat request body.
#[derive(Default)]
struct ChatOptions {
    response_format_json: bool,
    max_tokens: Option<u32>,
}

/// Internal: send a chat completion request with configurable options.
fn send_chat(
    config: &AiClientConfig,
    messages: Vec<serde_json::Value>,
    temperature: f64,
    opts: ChatOptions,
) -> Result<String, AppError> {
    let url = format!(
        "{}/v1/chat/completions",
        config.api_base.trim_end_matches('/')
    );

    let mut body = serde_json::json!({
        "model": config.model,
        "temperature": temperature,
        "messages": messages,
    });

    if opts.response_format_json {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    if let Some(mt) = opts.max_tokens {
        body["max_tokens"] = serde_json::json!(mt);
    }

    // ureq 2.x returns Err for 4xx/5xx, so `?` propagates HTTP errors
    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", config.api_key))
        .set("Content-Type", "application/json")
        .timeout(AI_TIMEOUT)
        .send_json(body)?;

    // Read response with size limit to prevent OOM
    let reader = resp.into_reader().take(MAX_RESPONSE_BYTES);
    let resp_body: ChatCompletionResponse = serde_json::from_reader(reader)
        .map_err(|e| AppError::ai(format!("解析 AI 响应失败: {e}")))?;

    resp_body
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| AppError::ai("AI 未返回有效内容"))
}

/// Send a chat completion request and return the raw text content.
pub fn chat(
    config: &AiClientConfig,
    messages: Vec<serde_json::Value>,
    temperature: f64,
) -> Result<String, AppError> {
    send_chat(config, messages, temperature, ChatOptions::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_from_map_validates_required_fields() {
        let empty: HashMap<String, String> = HashMap::new();
        assert!(AiClientConfig::from_map(&empty).is_err());

        let only_base: HashMap<String, String> =
            [("api_base".into(), "http://localhost".into())].into();
        assert!(AiClientConfig::from_map(&only_base).is_err());

        let valid: HashMap<String, String> = [
            ("api_base".into(), "http://localhost".into()),
            ("api_key".into(), "sk-test".into()),
        ]
        .into();
        let config = AiClientConfig::from_map(&valid).unwrap();
        assert_eq!(config.model, DEFAULT_MODEL);
    }

    #[test]
    fn config_uses_custom_model() {
        let cfg: HashMap<String, String> = [
            ("api_base".into(), "http://localhost".into()),
            ("api_key".into(), "sk-test".into()),
            ("model".into(), "gpt-4o".into()),
        ]
        .into();
        let config = AiClientConfig::from_map(&cfg).unwrap();
        assert_eq!(config.model, "gpt-4o");
    }

    #[test]
    fn chat_options_default_is_plain() {
        let opts = ChatOptions::default();
        assert!(!opts.response_format_json);
        assert!(opts.max_tokens.is_none());
    }
}
