//! Local HTTP server for browser extension communication.
//!
//! Listens on 127.0.0.1:19836 and accepts POST /api/clip to add web clips.
//! Uses a simple token stored in app_kv for authentication.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;

use crate::clips::NewClip;
use crate::db::open_db;
use crate::html_extract;

const BIND_ADDR: &str = "127.0.0.1:19836";
const MAX_BODY_SIZE: usize = 2 * 1024 * 1024; // 2 MB

/// Get or generate the local auth token.
pub fn get_or_create_token() -> Result<String, String> {
    let conn = open_db()?;
    if let Some(token) = crate::db::kv_get(&conn, "clip_server_token")? {
        return Ok(token);
    }
    // Generate a cryptographically random token
    let token: String = {
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hasher};
        const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
        (0..32)
            .map(|_| {
                let idx = RandomState::new().build_hasher().finish() as usize % CHARSET.len();
                CHARSET[idx] as char
            })
            .collect()
    };

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

    // Route: POST /api/clip (exact — must not match /api/clip-url)
    if request_line.starts_with("POST /api/clip ")
        || request_line.starts_with("POST /api/clip?")
    {
        // Auth check
        let token = get_or_create_token()?;
        let auth = headers.get("authorization").cloned().unwrap_or_default();
        let provided_token = auth.strip_prefix("Bearer ").unwrap_or(&auth);
        if provided_token != token {
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

        let clip: NewClip =
            serde_json::from_slice(&body).map_err(|e| format!("invalid JSON: {e}"))?;

        match crate::clips::add_web_clip(clip) {
            Ok(saved) => {
                let resp =
                    serde_json::to_string(&saved).unwrap_or_else(|_| r#"{"ok":true}"#.to_string());
                send_json_response(&mut stream, 200, &resp)?;
            }
            Err(e) => {
                let err_body = serde_json::json!({"error": e}).to_string();
                send_json_response(&mut stream, 500, &err_body)?;
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
        if provided_token != token {
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

        let req: ClipUrlRequest =
            serde_json::from_slice(&body).map_err(|e| format!("invalid JSON: {e}"))?;

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
                        let err_body = serde_json::json!({"error": e}).to_string();
                        send_json_response(&mut stream, 500, &err_body)?;
                    }
                }
            }
            Err(e) => {
                let err_body = serde_json::json!({"error": e}).to_string();
                send_json_response(&mut stream, 422, &err_body)?;
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
