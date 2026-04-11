use directories::ProjectDirs;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Tracks whether migrations have been run for the current process.
static MIGRATIONS_DONE: OnceLock<bool> = OnceLock::new();

pub fn app_data_dir() -> Result<PathBuf, String> {
    let proj = ProjectDirs::from("", "KnoYoo", "Desktop")
        .ok_or_else(|| "cannot resolve app data dir".to_string())?;
    let base = proj.data_dir();
    let dir = base.join("data");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn app_db_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("notes.db"))
}

/// Open SQLite database and run schema creation (idempotent).
pub fn open_db() -> Result<Connection, String> {
    let db_path = app_db_path()?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
    PRAGMA foreign_keys = ON;

    -- Application key-value config (AI settings, tokens, etc.)
    CREATE TABLE IF NOT EXISTS app_kv (
      key TEXT PRIMARY KEY,
      val TEXT NOT NULL
    );

    -- Web clips store
    CREATE TABLE IF NOT EXISTS web_clips (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      url         TEXT NOT NULL,
      title       TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      summary     TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '[]',
      source_type TEXT NOT NULL DEFAULT 'article',
      favicon     TEXT NOT NULL DEFAULT '',
      is_read     INTEGER NOT NULL DEFAULT 0,
      is_starred  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_web_clips_url ON web_clips(url);

    CREATE VIRTUAL TABLE IF NOT EXISTS web_clips_fts
      USING fts5(title, content, summary, tags, content='web_clips', content_rowid='id');

    CREATE TRIGGER IF NOT EXISTS web_clips_ai AFTER INSERT ON web_clips BEGIN
      INSERT INTO web_clips_fts(rowid, title, content, summary, tags)
        VALUES (new.id, new.title, new.content, new.summary, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS web_clips_ad AFTER DELETE ON web_clips BEGIN
      INSERT INTO web_clips_fts(web_clips_fts, rowid, title, content, summary, tags)
        VALUES('delete', old.id, old.title, old.content, old.summary, old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS web_clips_au AFTER UPDATE ON web_clips BEGIN
      INSERT INTO web_clips_fts(web_clips_fts, rowid, title, content, summary, tags)
        VALUES('delete', old.id, old.title, old.content, old.summary, old.tags);
      INSERT INTO web_clips_fts(rowid, title, content, summary, tags)
        VALUES (new.id, new.title, new.content, new.summary, new.tags);
    END;
    "#,
    )
    .map_err(|e| e.to_string())?;

    MIGRATIONS_DONE.get_or_init(|| {
        tracing::info!("Running database migrations (first connection)...");
        true
    });

    Ok(conn)
}

/// Read a KV entry.
pub fn kv_get(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    conn.query_row("SELECT val FROM app_kv WHERE key=?1", [key], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())
}

/// Read AI configuration from app_kv table.
pub fn read_ai_config(
    conn: &rusqlite::Connection,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut out = std::collections::HashMap::new();
    let keys = ["provider", "api_base", "api_key", "model"];
    for k in keys {
        if let Some(v) = kv_get(conn, k)? {
            out.insert(k.to_string(), v);
        }
    }
    Ok(out)
}

/// Run database integrity check.
#[tauri::command]
pub fn check_db_health() -> Result<String, String> {
    let conn = open_db()?;
    let result: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if result != "ok" {
        tracing::error!("Database integrity check failed: {}", result);
    } else {
        tracing::info!("Database integrity check: ok");
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS app_kv (
              key TEXT PRIMARY KEY,
              val TEXT NOT NULL
            );
            "#,
        )
        .expect("init schema");
        conn
    }

    #[test]
    fn kv_get_missing_key_returns_none() {
        let conn = test_db();
        let result = super::kv_get(&conn, "nonexistent").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn kv_get_existing_key_returns_some() {
        let conn = test_db();
        conn.execute(
            "INSERT INTO app_kv(key, val) VALUES(?1, ?2)",
            rusqlite::params!["provider", "openai"],
        )
        .unwrap();
        let result = super::kv_get(&conn, "provider").unwrap();
        assert_eq!(result, Some("openai".to_string()));
    }
}
