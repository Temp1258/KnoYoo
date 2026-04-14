use serde::Serialize;

/// Unified error type for all Tauri commands.
#[derive(Debug, Serialize)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    Database,
    Ai,
    Io,
    Validation,
    NotFound,
}

impl AppError {
    pub fn database(msg: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Database,
            message: msg.into(),
        }
    }

    pub fn ai(msg: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Ai,
            message: msg.into(),
        }
    }

    pub fn io(msg: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Io,
            message: msg.into(),
        }
    }

    pub fn validation(msg: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Validation,
            message: msg.into(),
        }
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::NotFound,
            message: msg.into(),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::database(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::validation(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::io(e.to_string())
    }
}

impl From<ureq::Error> for AppError {
    fn from(e: ureq::Error) -> Self {
        match &e {
            ureq::Error::Status(401, _) => Self::ai("API Key 无效或已过期"),
            ureq::Error::Status(402, _) => Self::ai("API 额度不足，请检查账户余额"),
            ureq::Error::Status(429, _) => Self::ai("请求频率过高，请稍后再试"),
            ureq::Error::Status(code, _) => Self::ai(format!("API 请求失败 (HTTP {})", code)),
            ureq::Error::Transport(t) => {
                let msg = match t.kind() {
                    ureq::ErrorKind::Dns => "DNS 解析失败，请检查网络连接",
                    ureq::ErrorKind::ConnectionFailed => "连接失败，请检查网络或 API 地址",
                    ureq::ErrorKind::Io => {
                        // Check if it's a timeout via the error message
                        let s = t.to_string();
                        if s.contains("timed out") || s.contains("Timeout") {
                            "AI 响应超时，请稍后再试"
                        } else {
                            return Self::ai(format!("网络错误: {}", e));
                        }
                    }
                    _ => return Self::ai(format!("网络错误: {}", e)),
                };
                Self::ai(msg)
            }
        }
    }
}

/// Backward-compatible: convert AppError to String for existing commands.
impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.message
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display_includes_kind() {
        let err = AppError::database("connection failed");
        assert!(err.to_string().contains("Database"));
        assert!(err.to_string().contains("connection failed"));
    }

    #[test]
    fn from_rusqlite_error() {
        let err = rusqlite::Error::QueryReturnedNoRows;
        let app_err: AppError = err.into();
        assert!(matches!(app_err.kind, ErrorKind::Database));
    }

    #[test]
    fn from_io_error() {
        let err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let app_err: AppError = err.into();
        assert!(matches!(app_err.kind, ErrorKind::Io));
        assert!(app_err.message.contains("file missing"));
    }

    #[test]
    fn serializes_to_json() {
        let err = AppError::ai("timeout");
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"kind\":\"ai\""));
        assert!(json.contains("\"message\":\"timeout\""));
    }
}
