//! Local HTTP server for browser extension communication.
//!
//! Listens on 127.0.0.1:19836 and accepts POST /api/clip to add web clips.
//! Uses a simple token stored in app_kv for authentication.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;

use crate::clips::NewClip;
use crate::db::open_db;
use crate::html_extract;

const BIND_ADDR: &str = "127.0.0.1:19836";
const MAX_BODY_SIZE: usize = 2 * 1024 * 1024; // 2 MB
const HANDSHAKE_COOLDOWN_SECS: u64 = 3;

/// Thread-safe rate limiter for handshake endpoint.
static LAST_HANDSHAKE: Mutex<u64> = Mutex::new(0);

/// Generate a cryptographically secure random token via OS entropy (cross-platform).
fn generate_secure_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("随机数生成失败: {e}"))?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let token: String = bytes
        .iter()
        .flat_map(|b| [HEX[(b >> 4) as usize] as char, HEX[(b & 0xf) as usize] as char])
        .collect();
    Ok(token)
}

/// Constant-time string comparison to prevent timing attacks.
/// Always iterates through the full max length; uses u32 accumulator
/// to avoid truncation for strings longer than 255 bytes.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let max_len = a.len().max(b.len());
    let mut diff: u32 = if a.len() != b.len() { 1 } else { 0 };
    for i in 0..max_len {
        let x = a.as_bytes().get(i).copied().unwrap_or(0);
        let y = b.as_bytes().get(i).copied().unwrap_or(0);
        diff |= (x ^ y) as u32;
    }
    diff == 0
}

/// Get or generate the local auth token.
pub fn get_or_create_token() -> Result<String, String> {
    let conn = open_db()?;
    if let Some(token) = crate::db::kv_get(&conn, "clip_server_token")? {
        return Ok(token);
    }

    let token = generate_secure_token()?;

    conn.execute(
        "INSERT INTO app_kv(key, val) VALUES('clip_server_token', ?1)
         ON CONFLICT(key) DO UPDATE SET val=excluded.val",
        [&token],
    )
    .map_err(|e| e.to_string())?;

    tracing::info!("Generated new clip server token");
    Ok(token)
}

/// Tauri command: get the local server token (for extension config).
#[tauri::command]
pub fn get_clip_server_token() -> Result<String, String> {
    get_or_create_token()
}

/// Tauri command: get local server port.
#[tauri::command]
pub fn get_clip_server_port() -> u16 {
    19836
}

/// Start the HTTP server in a background thread.
pub fn start_server() {
    std::thread::spawn(|| {
        let listener = match TcpListener::bind(BIND_ADDR) {
            Ok(l) => l,
            Err(e) => {
                tracing::error!("Clip server failed to bind {}: {}", BIND_ADDR, e);
                return;
            }
        };
        tracing::info!("Clip server listening on {}", BIND_ADDR);

        for stream in listener.incoming() {
            match stream {
                Ok(s) => {
                    std::thread::spawn(move || {
                        if let Err(e) = handle_connection(s) {
                            tracing::warn!("Clip server request error: {}", e);
                        }
                    });
                }
                Err(e) => tracing::warn!("Clip server accept error: {}", e),
            }
        }
    });
}

fn handle_connection(mut stream: std::net::TcpStream) -> Result<(), String> {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(10)))
        .ok();

    let mut reader = BufReader::new(&stream);

    // Parse request line
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;

    // Parse headers
    let mut headers = std::collections::HashMap::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((key, val)) = trimmed.split_once(':') {
            headers.insert(key.trim().to_lowercase(), val.trim().to_string());
        }
    }

    // CORS preflight
    if request_line.starts_with("OPTIONS ") {
        let response = "HTTP/1.1 204 No Content\r\n\
            Access-Control-Allow-Origin: *\r\n\
            Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n\
            Access-Control-Allow-Headers: Content-Type, Authorization\r\n\
            Access-Control-Max-Age: 86400\r\n\
            Content-Length: 0\r\n\r\n";
        stream
            .write_all(response.as_bytes())
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Route: GET /api/ping — extension uses this to check if desktop is running
    if request_line.starts_with("GET /api/ping") {
        let body = r#"{"status":"ok","app":"knoyoo"}"#;
        send_json_response(&mut stream, 200, body)?;
        return Ok(());
    }

    // Route: POST /api/handshake — auto-connect browser extension (no auth required)
    // Rate-limited with Mutex to prevent brute-force from malicious local processes.
    if request_line.starts_with("POST /api/handshake") {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        {
            let mut last = LAST_HANDSHAKE.lock().unwrap_or_else(|e| e.into_inner());
            if now.saturating_sub(*last) < HANDSHAKE_COOLDOWN_SECS {
                send_json_response(&mut stream, 429, r#"{"error":"too many requests"}"#)?;
                return Ok(());
            }
            *last = now;
        }

        let content_length: usize = headers
            .get("content-length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        if content_length > 0 && content_length <= 1024 {
            let mut body = vec![0u8; content_length];
            reader.read_exact(&mut body).ok();
        }

        let token = get_or_create_token()?;
        let resp = serde_json::json!({
            "status": "ok",
            "token": token,
            "port": 19836
        })
        .to_string();
        send_json_response(&mut stream, 200, &resp)?;
        tracing::info!("Browser extension handshake completed");
        return Ok(());
    }

    // Route: POST /api/clip (exact — must not match /api/clip-url)
    if request_line.starts_with("POST /api/clip ")
        || request_line.starts_with("POST /api/clip?")
    {
        // Auth check
        let token = get_or_create_token()?;
        let auth = headers.get("authorization").cloned().unwrap_or_default();
        let provided_token = auth.strip_prefix("Bearer ").unwrap_or(&auth);
        if !constant_time_eq(provided_token, &token) {
            send_json_response(&mut stream, 401, r#"{"error":"unauthorized"}"#)?;
            return Ok(());
        }

        // Read body
        let content_length: usize = headers
            .get("content-length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        if content_length == 0 {
            send_json_response(&mut stream, 400, r#"{"error":"empty body"}"#)?;
            return Ok(());
        }
        if content_length > MAX_BODY_SIZE {
            send_json_response(&mut stream, 413, r#"{"error":"body too large"}"#)?;
            return Ok(());
        }

        let mut body = vec![0u8; content_length];
        reader.read_exact(&mut body).map_err(|e| e.to_string())?;

        let clip: NewClip = match serde_json::from_slice(&body) {
            Ok(c) => c,
            Err(_) => {
                send_json_response(&mut stream, 400, r#"{"error":"invalid JSON"}"#)?;
                return Ok(());
            }
        };

        match crate::clips::add_web_clip(clip) {
            Ok(saved) => {
                let resp =
                    serde_json::to_string(&saved).unwrap_or_else(|_| r#"{"ok":true}"#.to_string());
                send_json_response(&mut stream, 200, &resp)?;
            }
            Err(e) => {
                tracing::error!("Clip save failed: {}", e);
                send_json_response(&mut stream, 500, r#"{"error":"save failed"}"#)?;
            }
        }
        return Ok(());
    }

    // Route: POST /api/clip-url — fetch URL server-side, extract content, and save
    if request_line.starts_with("POST /api/clip-url") {
        // Auth check
        let token = get_or_create_token()?;
        let auth = headers.get("authorization").cloned().unwrap_or_default();
        let provided_token = auth.strip_prefix("Bearer ").unwrap_or(&auth);
        if !constant_time_eq(provided_token, &token) {
            send_json_response(&mut stream, 401, r#"{"error":"unauthorized"}"#)?;
            return Ok(());
        }

        // Read body
        let content_length: usize = headers
            .get("content-length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        if content_length == 0 {
            send_json_response(&mut stream, 400, r#"{"error":"empty body"}"#)?;
            return Ok(());
        }
        if content_length > MAX_BODY_SIZE {
            send_json_response(&mut stream, 413, r#"{"error":"body too large"}"#)?;
            return Ok(());
        }

        let mut body = vec![0u8; content_length];
        reader.read_exact(&mut body).map_err(|e| e.to_string())?;

        #[derive(serde::Deserialize)]
        struct ClipUrlRequest {
            url: String,
            #[serde(default = "default_source_hint")]
            source_hint: String,
        }
        fn default_source_hint() -> String {
            "article".to_string()
        }

        let req: ClipUrlRequest = match serde_json::from_slice(&body) {
            Ok(r) => r,
            Err(_) => {
                send_json_response(&mut stream, 400, r#"{"error":"invalid JSON"}"#)?;
                return Ok(());
            }
        };

        // Fetch and extract content from the URL
        match html_extract::fetch_and_extract(&req.url) {
            Ok(page) => {
                let clip = NewClip {
                    url: req.url,
                    title: page.title,
                    content: page.content,
                    source_type: Some(req.source_hint),
                    favicon: Some(page.favicon),
                    og_image: Some(page.og_image),
                };
                match crate::clips::add_web_clip(clip) {
                    Ok(saved) => {
                        let resp = serde_json::to_string(&saved)
                            .unwrap_or_else(|_| r#"{"ok":true}"#.to_string());
                        send_json_response(&mut stream, 200, &resp)?;
                    }
                    Err(e) => {
                        tracing::error!("Clip-url save failed: {}", e);
                        send_json_response(&mut stream, 500, r#"{"error":"save failed"}"#)?;
                    }
                }
            }
            Err(e) => {
                tracing::error!("Clip-url fetch failed: {}", e);
                send_json_response(&mut stream, 422, r#"{"error":"fetch failed"}"#)?;
            }
        }
        return Ok(());
    }

    // 404
    send_json_response(&mut stream, 404, r#"{"error":"not found"}"#)?;
    Ok(())
}

fn send_json_response(
    stream: &mut std::net::TcpStream,
    status: u16,
    body: &str,
) -> Result<(), String> {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        413 => "Payload Too Large",
        422 => "Unprocessable Entity",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Headers: Content-Type, Authorization\r\n\
         Content-Length: {}\r\n\r\n{}",
        status,
        status_text,
        body.len(),
        body,
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|e| e.to_string())
}
