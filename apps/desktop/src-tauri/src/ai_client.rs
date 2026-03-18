use std::collections::HashMap;
use std::time::Duration;

use crate::error::AppError;
use crate::models::{ChatCompletionResponse, DEFAULT_MODEL};

/// Configuration for the AI client, read from app_kv.
pub struct AiClientConfig {
    pub api_base: String,
    pub api_key: String,
    pub model: String,
}

impl AiClientConfig {
    /// Build from a HashMap (as returned by `read_ai_config`).
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

        Ok(Self { api_base, api_key, model })
    }
}

/// Default timeout for AI HTTP requests.
const AI_TIMEOUT: Duration = Duration::from_secs(60);

/// Send a chat completion request and return the raw text content.
pub fn chat(
    config: &AiClientConfig,
    messages: Vec<serde_json::Value>,
    temperature: f64,
) -> Result<String, AppError> {
    let url = format!("{}/v1/chat/completions", config.api_base.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": config.model,
        "temperature": temperature,
        "messages": messages,
    });

    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", config.api_key))
        .set("Content-Type", "application/json")
        .timeout(AI_TIMEOUT)
        .send_json(body)?;

    if resp.status() >= 300 {
        return Err(AppError::ai(format!("AI API 返回 HTTP {}", resp.status())));
    }

    let resp_body: ChatCompletionResponse = resp
        .into_json()
        .map_err(|e| AppError::ai(format!("解析 AI 响应失败: {e}")))?;

    resp_body
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| AppError::ai("AI 未返回有效内容"))
}

/// Send a chat completion request with `response_format: json_object` and return raw text.
pub fn chat_json(
    config: &AiClientConfig,
    messages: Vec<serde_json::Value>,
    temperature: f64,
) -> Result<String, AppError> {
    let url = format!("{}/v1/chat/completions", config.api_base.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": config.model,
        "temperature": temperature,
        "response_format": { "type": "json_object" },
        "messages": messages,
    });

    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", config.api_key))
        .set("Content-Type", "application/json")
        .timeout(AI_TIMEOUT)
        .send_json(body)?;

    if resp.status() >= 300 {
        return Err(AppError::ai(format!("AI API 返回 HTTP {}", resp.status())));
    }

    let resp_body: ChatCompletionResponse = resp
        .into_json()
        .map_err(|e| AppError::ai(format!("解析 AI 响应失败: {e}")))?;

    resp_body
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| AppError::ai("AI 未返回有效内容"))
}

/// Send a chat request with optional max_tokens.
pub fn chat_with_max_tokens(
    config: &AiClientConfig,
    messages: Vec<serde_json::Value>,
    temperature: f64,
    max_tokens: u32,
) -> Result<String, AppError> {
    let url = format!("{}/v1/chat/completions", config.api_base.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": config.model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    });

    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", config.api_key))
        .set("Content-Type", "application/json")
        .timeout(AI_TIMEOUT)
        .send_json(body)?;

    if resp.status() >= 300 {
        return Err(AppError::ai(format!("AI API 返回 HTTP {}", resp.status())));
    }

    let resp_body: ChatCompletionResponse = resp
        .into_json()
        .map_err(|e| AppError::ai(format!("解析 AI 响应失败: {e}")))?;

    resp_body
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| AppError::ai("AI 未返回有效内容"))
}

/// Try to get AI config; returns Ok(None) if not configured.
pub fn try_config(cfg: &HashMap<String, String>) -> Option<AiClientConfig> {
    AiClientConfig::from_map(cfg).ok()
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
}
