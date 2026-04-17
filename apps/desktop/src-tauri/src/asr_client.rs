//! Speech-to-text (ASR) clients.
//!
//! Three cloud providers behind a common trait:
//! - `OpenAI` Whisper (`/v1/audio/transcriptions`, multipart, 25MB hard cap)
//! - Deepgram (`/v1/listen`, raw audio body, `Token` auth header)
//! - `SiliconFlow` (OpenAI-compatible multipart, cheaper `SenseVoice` model)
//!
//! Callers upload a single audio file ≤ `max_file_bytes()`. Splitting for
//! longer videos is the caller's job — see `media::split_audio` and the
//! transcribe pipeline for chunk orchestration.
//!
//! Privacy note: audio is sent to the selected provider. `KnoYoo`'s promise is
//! that *results* stay local; cloud ASR is an explicit trade-off the user
//! opts into via settings. The UI must surface which provider is in use.

use std::collections::HashMap;
use std::fs;
use std::io::Read as _;
use std::path::Path;
use std::time::Duration;

use crate::error::AppError;

/// Shared HTTP timeout for ASR providers. ASR latency scales with audio
/// length, so 5 minutes is a sane upper bound for a ~25MB chunk. We split
/// longer audio into multiple requests upstream, so this doesn't need to
/// cover "1 hour video in one shot".
const ASR_TIMEOUT: Duration = Duration::from_mins(5);

/// Response-body ceiling for ASR endpoints. Transcripts are text — even a
/// maximum-size chunk produces well under 2 MB of JSON.
const MAX_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;

/// A single audio chunk ready for upload.
pub struct AudioInput<'a> {
    pub path: &'a Path,
    /// MIME type, e.g. `"audio/m4a"` / `"audio/mpeg"` / `"audio/wav"`.
    pub mime: &'a str,
}

/// Transcription backend. Implementations MUST be `Send + Sync` so the
/// pipeline can pass them across `std::thread::spawn` boundaries.
pub trait AsrProvider: Send + Sync {
    /// Stable identifier stored in `web_clips.transcription_source`
    /// (e.g. `"asr:openai"`).
    fn provider_id(&self) -> &'static str;

    /// Hard upload cap. Chunks larger than this MUST be split upstream.
    fn max_file_bytes(&self) -> usize;

    /// Upload a single chunk and return the raw transcript text.
    /// `lang` is an ISO-639-1 hint (e.g. `"zh"`, `"en"`) or `None` for auto.
    fn transcribe(&self, audio: &AudioInput<'_>, lang: Option<&str>) -> Result<String, AppError>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Raw ASR config read from `app_kv`. Kept as a flat struct so the settings
/// UI can round-trip it without knowing provider internals.
#[derive(Debug)]
pub struct AsrConfig {
    pub provider: String,
    pub api_base: String,
    pub api_key: String,
    pub model: String,
    pub language: Option<String>,
}

impl AsrConfig {
    /// Parse from the `HashMap<String,String>` returned by `read_asr_config`.
    /// Fills in provider-specific defaults for `api_base` and `model` so the
    /// user only has to enter an API key to get going.
    pub fn from_map(cfg: &HashMap<String, String>) -> Result<Self, AppError> {
        let provider = cfg
            .get("asr_provider")
            .cloned()
            .unwrap_or_default()
            .trim()
            .to_lowercase();
        let api_key = cfg
            .get("asr_api_key")
            .cloned()
            .unwrap_or_default()
            .trim()
            .to_string();

        if provider.is_empty() {
            return Err(AppError::validation("ASR 配置缺失: 未选择转录供应商"));
        }
        if api_key.is_empty() {
            return Err(AppError::validation("ASR 配置缺失: api_key 为空"));
        }

        let (default_base, default_model) = match provider.as_str() {
            "openai" => ("https://api.openai.com", "whisper-1"),
            "deepgram" => ("https://api.deepgram.com", "nova-2"),
            "siliconflow" => (
                "https://api.siliconflow.cn",
                "FunAudioLLM/SenseVoiceSmall",
            ),
            other => {
                return Err(AppError::validation(format!(
                    "未知的 ASR 供应商: {other}"
                )))
            }
        };

        let api_base = cfg
            .get("asr_api_base")
            .cloned()
            .unwrap_or_default()
            .trim()
            .trim_end_matches('/')
            .to_string();
        let api_base = if api_base.is_empty() {
            default_base.to_string()
        } else {
            api_base
        };

        let model = cfg
            .get("asr_model")
            .cloned()
            .unwrap_or_default()
            .trim()
            .to_string();
        let model = if model.is_empty() {
            default_model.to_string()
        } else {
            model
        };

        let language = cfg
            .get("asr_language")
            .cloned()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        Ok(Self {
            provider,
            api_base,
            api_key,
            model,
            language,
        })
    }
}

/// Factory: build a concrete provider from a parsed config.
pub fn build_provider(cfg: &AsrConfig) -> Result<Box<dyn AsrProvider>, AppError> {
    match cfg.provider.as_str() {
        "openai" => Ok(Box::new(OpenAiWhisper {
            api_base: cfg.api_base.clone(),
            api_key: cfg.api_key.clone(),
            model: cfg.model.clone(),
        })),
        "deepgram" => Ok(Box::new(Deepgram {
            api_base: cfg.api_base.clone(),
            api_key: cfg.api_key.clone(),
            model: cfg.model.clone(),
        })),
        "siliconflow" => Ok(Box::new(SiliconFlow {
            api_base: cfg.api_base.clone(),
            api_key: cfg.api_key.clone(),
            model: cfg.model.clone(),
        })),
        other => Err(AppError::validation(format!(
            "未知的 ASR 供应商: {other}"
        ))),
    }
}

// ---------------------------------------------------------------------------
// OpenAI Whisper — /v1/audio/transcriptions (multipart)
// ---------------------------------------------------------------------------

pub struct OpenAiWhisper {
    pub api_base: String,
    pub api_key: String,
    pub model: String,
}

impl AsrProvider for OpenAiWhisper {
    fn provider_id(&self) -> &'static str {
        "asr:openai"
    }

    fn max_file_bytes(&self) -> usize {
        // OpenAI Whisper hard limit is 25 MB. Leave 256 KB margin for
        // multipart framing overhead.
        25 * 1024 * 1024 - 256 * 1024
    }

    fn transcribe(&self, audio: &AudioInput<'_>, lang: Option<&str>) -> Result<String, AppError> {
        let url = format!(
            "{}/v1/audio/transcriptions",
            self.api_base.trim_end_matches('/')
        );
        let mut fields: Vec<(&str, String)> = vec![
            ("model", self.model.clone()),
            ("response_format", "json".to_string()),
        ];
        if let Some(l) = lang {
            fields.push(("language", l.to_string()));
        }
        let (ct, body) = build_multipart(&fields, audio)?;

        let resp = ureq::post(&url)
            .set("Authorization", &format!("Bearer {}", self.api_key))
            .set("Content-Type", &ct)
            .timeout(ASR_TIMEOUT)
            .send_bytes(&body)?;

        parse_openai_shape(resp)
    }
}

// ---------------------------------------------------------------------------
// Deepgram — /v1/listen (raw body, "Token" auth scheme)
// ---------------------------------------------------------------------------

pub struct Deepgram {
    pub api_base: String,
    pub api_key: String,
    pub model: String,
}

impl AsrProvider for Deepgram {
    fn provider_id(&self) -> &'static str {
        "asr:deepgram"
    }

    fn max_file_bytes(&self) -> usize {
        // Deepgram accepts up to 2 GB per sync call. We cap at 100 MB to keep
        // per-request latency and memory usage bounded — large videos still
        // get chunked upstream for better progress granularity.
        100 * 1024 * 1024
    }

    fn transcribe(&self, audio: &AudioInput<'_>, lang: Option<&str>) -> Result<String, AppError> {
        let base = self.api_base.trim_end_matches('/');
        let mut url = format!(
            "{base}/v1/listen?model={}&smart_format=true&punctuate=true",
            urlencode(&self.model)
        );
        if let Some(l) = lang {
            url.push_str("&language=");
            url.push_str(&urlencode(l));
        } else {
            // Nova-2 multilingual detection opt-in.
            url.push_str("&detect_language=true");
        }

        let bytes = read_audio_capped(audio.path, self.max_file_bytes())?;
        let resp = ureq::post(&url)
            // Deepgram uses `Token`, not `Bearer`.
            .set("Authorization", &format!("Token {}", self.api_key))
            .set("Content-Type", audio.mime)
            .timeout(ASR_TIMEOUT)
            .send_bytes(&bytes)?;

        let body: serde_json::Value = serde_json::from_reader(
            resp.into_reader().take(MAX_RESPONSE_BYTES),
        )
        .map_err(|e| AppError::ai(format!("解析 Deepgram 响应失败: {e}")))?;

        // Response shape: results.channels[0].alternatives[0].transcript
        body.pointer("/results/channels/0/alternatives/0/transcript")
            .and_then(|v| v.as_str())
            .map(std::string::ToString::to_string)
            .ok_or_else(|| AppError::ai("Deepgram 未返回有效 transcript"))
    }
}

// ---------------------------------------------------------------------------
// SiliconFlow — OpenAI-compatible multipart at /v1/audio/transcriptions
// ---------------------------------------------------------------------------

pub struct SiliconFlow {
    pub api_base: String,
    pub api_key: String,
    pub model: String,
}

impl AsrProvider for SiliconFlow {
    fn provider_id(&self) -> &'static str {
        "asr:siliconflow"
    }

    fn max_file_bytes(&self) -> usize {
        // SiliconFlow's audio endpoint advertises up to ~30 MB depending on
        // the model. 20 MB is a conservative default that works for all
        // current STT models they ship.
        20 * 1024 * 1024
    }

    fn transcribe(&self, audio: &AudioInput<'_>, lang: Option<&str>) -> Result<String, AppError> {
        let url = format!(
            "{}/v1/audio/transcriptions",
            self.api_base.trim_end_matches('/')
        );
        let mut fields: Vec<(&str, String)> = vec![("model", self.model.clone())];
        if let Some(l) = lang {
            fields.push(("language", l.to_string()));
        }
        let (ct, body) = build_multipart(&fields, audio)?;

        let resp = ureq::post(&url)
            .set("Authorization", &format!("Bearer {}", self.api_key))
            .set("Content-Type", &ct)
            .timeout(ASR_TIMEOUT)
            .send_bytes(&body)?;

        parse_openai_shape(resp)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Read `{"text": "..."}` from an OpenAI-compatible transcription response.
fn parse_openai_shape(resp: ureq::Response) -> Result<String, AppError> {
    let body: serde_json::Value =
        serde_json::from_reader(resp.into_reader().take(MAX_RESPONSE_BYTES))
            .map_err(|e| AppError::ai(format!("解析 ASR 响应失败: {e}")))?;
    body.get("text")
        .and_then(|v| v.as_str())
        .map(std::string::ToString::to_string)
        .ok_or_else(|| AppError::ai("ASR 未返回有效文本"))
}

/// Slurp an audio file into memory, refusing to exceed the provider cap.
fn read_audio_capped(path: &Path, cap: usize) -> Result<Vec<u8>, AppError> {
    let meta = fs::metadata(path)
        .map_err(|e| AppError::io(format!("读取音频文件失败: {e}")))?;
    let size = usize::try_from(meta.len()).unwrap_or(usize::MAX);
    if size > cap {
        return Err(AppError::validation(format!(
            "音频块超过供应商上限 ({size} > {cap} bytes)"
        )));
    }
    let mut buf = Vec::with_capacity(size);
    fs::File::open(path)
        .map_err(|e| AppError::io(format!("打开音频文件失败: {e}")))?
        .read_to_end(&mut buf)
        .map_err(|e| AppError::io(format!("读取音频文件失败: {e}")))?;
    Ok(buf)
}

/// Build a `multipart/form-data` body with the given text fields plus one
/// file field named `file`. Returns `(Content-Type, body_bytes)`.
///
/// Hand-rolled because ureq 2.x has no multipart helper and pulling in a
/// dedicated crate for ~40 lines of framing is not worth the dependency.
fn build_multipart(
    fields: &[(&str, String)],
    audio: &AudioInput<'_>,
) -> Result<(String, Vec<u8>), AppError> {
    let boundary = format!("----knoyoo-{}", random_boundary_token());
    let mut body: Vec<u8> = Vec::new();

    for (name, value) in fields {
        body.extend_from_slice(b"--");
        body.extend_from_slice(boundary.as_bytes());
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(value.as_bytes());
        body.extend_from_slice(b"\r\n");
    }

    // File part
    let filename = audio
        .path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("audio.m4a");
    let audio_bytes = fs::read(audio.path)
        .map_err(|e| AppError::io(format!("读取音频文件失败: {e}")))?;
    body.extend_from_slice(b"--");
    body.extend_from_slice(boundary.as_bytes());
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", audio.mime).as_bytes());
    body.extend_from_slice(&audio_bytes);
    body.extend_from_slice(b"\r\n");

    body.extend_from_slice(b"--");
    body.extend_from_slice(boundary.as_bytes());
    body.extend_from_slice(b"--\r\n");

    Ok((format!("multipart/form-data; boundary={boundary}"), body))
}

/// 16 bytes of OS entropy rendered as hex. Not a security boundary — just
/// has to be unique per request to be a valid multipart boundary.
fn random_boundary_token() -> String {
    let mut buf = [0u8; 16];
    if getrandom::getrandom(&mut buf).is_err() {
        // Extremely unlikely: fall back to a timestamp-based token.
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        return format!("fallback-{ts:032x}");
    }
    let mut out = String::with_capacity(32);
    for byte in buf {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Minimal URL-component encoder. Only percent-encodes what a query-string
/// value can't contain safely; we only ever pass model IDs and BCP-47 tags
/// through here.
fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn cfg(entries: &[(&str, &str)]) -> HashMap<String, String> {
        entries
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn config_requires_provider_and_key() {
        assert!(AsrConfig::from_map(&cfg(&[])).is_err());
        assert!(
            AsrConfig::from_map(&cfg(&[("asr_provider", "openai")])).is_err(),
            "missing api_key should fail"
        );
    }

    #[test]
    fn config_fills_openai_defaults() {
        let parsed =
            AsrConfig::from_map(&cfg(&[("asr_provider", "openai"), ("asr_api_key", "sk-x")]))
                .unwrap();
        assert_eq!(parsed.provider, "openai");
        assert_eq!(parsed.api_base, "https://api.openai.com");
        assert_eq!(parsed.model, "whisper-1");
        assert_eq!(parsed.language, None);
    }

    #[test]
    fn config_fills_deepgram_defaults() {
        let parsed = AsrConfig::from_map(&cfg(&[
            ("asr_provider", "deepgram"),
            ("asr_api_key", "dg-x"),
        ]))
        .unwrap();
        assert_eq!(parsed.api_base, "https://api.deepgram.com");
        assert_eq!(parsed.model, "nova-2");
    }

    #[test]
    fn config_fills_siliconflow_defaults() {
        let parsed = AsrConfig::from_map(&cfg(&[
            ("asr_provider", "siliconflow"),
            ("asr_api_key", "sf-x"),
        ]))
        .unwrap();
        assert_eq!(parsed.api_base, "https://api.siliconflow.cn");
        assert_eq!(parsed.model, "FunAudioLLM/SenseVoiceSmall");
    }

    #[test]
    fn config_honours_language_override() {
        let parsed = AsrConfig::from_map(&cfg(&[
            ("asr_provider", "openai"),
            ("asr_api_key", "sk-x"),
            ("asr_language", "zh"),
        ]))
        .unwrap();
        assert_eq!(parsed.language.as_deref(), Some("zh"));
    }

    #[test]
    fn config_rejects_unknown_provider() {
        let err = AsrConfig::from_map(&cfg(&[
            ("asr_provider", "mystery-inc"),
            ("asr_api_key", "x"),
        ]))
        .unwrap_err();
        assert!(err.message.contains("未知"));
    }

    #[test]
    fn build_provider_returns_right_id() {
        for (id, expected) in [
            ("openai", "asr:openai"),
            ("deepgram", "asr:deepgram"),
            ("siliconflow", "asr:siliconflow"),
        ] {
            let parsed = AsrConfig::from_map(&cfg(&[
                ("asr_provider", id),
                ("asr_api_key", "x"),
            ]))
            .unwrap();
            let provider = build_provider(&parsed).unwrap();
            assert_eq!(provider.provider_id(), expected);
        }
    }

    #[test]
    fn max_file_bytes_within_vendor_limits() {
        // OpenAI: 25 MB hard cap, we must be strictly below.
        let openai = OpenAiWhisper {
            api_base: "x".into(),
            api_key: "x".into(),
            model: "whisper-1".into(),
        };
        assert!(openai.max_file_bytes() < 25 * 1024 * 1024);
        // Deepgram: we cap at 100 MB (far under their 2 GB).
        let dg = Deepgram {
            api_base: "x".into(),
            api_key: "x".into(),
            model: "nova-2".into(),
        };
        assert_eq!(dg.max_file_bytes(), 100 * 1024 * 1024);
    }

    #[test]
    fn multipart_body_includes_all_fields() {
        let tmp = tempfile_with(b"ID3fake-audio-bytes");
        let audio = AudioInput {
            path: tmp.path(),
            mime: "audio/m4a",
        };
        let (ct, body) = build_multipart(
            &[("model", "whisper-1".into()), ("language", "zh".into())],
            &audio,
        )
        .unwrap();
        let s = String::from_utf8_lossy(&body);
        assert!(ct.starts_with("multipart/form-data; boundary=----knoyoo-"));
        assert!(s.contains("name=\"model\""));
        assert!(s.contains("whisper-1"));
        assert!(s.contains("name=\"language\""));
        assert!(s.contains("zh"));
        assert!(s.contains("name=\"file\""));
        assert!(s.contains("Content-Type: audio/m4a"));
        assert!(s.contains("ID3fake-audio-bytes"));
        // Terminating boundary.
        assert!(s.ends_with("--\r\n"));
    }

    #[test]
    fn read_audio_capped_rejects_oversize() {
        let tmp = tempfile_with(&vec![0u8; 1024]);
        assert!(read_audio_capped(tmp.path(), 1024).is_ok());
        assert!(read_audio_capped(tmp.path(), 512).is_err());
    }

    #[test]
    fn random_boundary_is_hex_and_unique() {
        let a = random_boundary_token();
        let b = random_boundary_token();
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn urlencode_preserves_unreserved() {
        assert_eq!(urlencode("nova-2"), "nova-2");
        assert_eq!(urlencode("zh"), "zh");
        assert_eq!(
            urlencode("FunAudioLLM/SenseVoiceSmall"),
            "FunAudioLLM%2FSenseVoiceSmall"
        );
    }

    // --- test helpers ------------------------------------------------------

    /// Tiny throwaway file that deletes itself on drop. Avoids pulling in the
    /// `tempfile` crate just for these tests.
    struct TempFile(std::path::PathBuf);
    impl TempFile {
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn tempfile_with(contents: &[u8]) -> TempFile {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "knoyoo-asr-test-{}-{}.bin",
            std::process::id(),
            random_boundary_token()
        ));
        let mut f = std::fs::File::create(&dir).expect("create tmp");
        f.write_all(contents).expect("write tmp");
        TempFile(dir)
    }
}
