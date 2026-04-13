use directories::ProjectDirs;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// Tracks whether schema has been successfully initialized for this process.
/// Using Mutex<bool> instead of OnceLock so failed initialization can be retried.
static SCHEMA_INITIALIZED: Mutex<bool> = Mutex::new(false);

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

/// Run schema creation and migrations (only once per process).
fn ensure_schema(conn: &Connection) -> Result<(), String> {
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

    -- Collections for organizing clips
    CREATE TABLE IF NOT EXISTS collections (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon        TEXT NOT NULL DEFAULT 'folder',
      color       TEXT NOT NULL DEFAULT '#6b7280',
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS collection_clips (
      collection_id INTEGER NOT NULL,
      clip_id       INTEGER NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (collection_id, clip_id),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (clip_id) REFERENCES web_clips(id) ON DELETE CASCADE
    );

    -- Weekly reports
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start  TEXT NOT NULL UNIQUE,
      week_end    TEXT NOT NULL,
      clip_count  INTEGER NOT NULL DEFAULT 0,
      top_tags    TEXT NOT NULL DEFAULT '[]',
      top_domains TEXT NOT NULL DEFAULT '[]',
      ai_summary  TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    -- User notes attached to clips (1:1 relationship)
    CREATE TABLE IF NOT EXISTS clip_notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      clip_id     INTEGER NOT NULL UNIQUE,
      content     TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (clip_id) REFERENCES web_clips(id) ON DELETE CASCADE
    );
    "#,
    )
    .map_err(|e| e.to_string())?;

    // Additive migrations (idempotent — errors silently ignored if column already exists)
    conn.execute(
        "ALTER TABLE web_clips ADD COLUMN og_image TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();

    tracing::info!("Database schema initialized");
    Ok(())
}

/// Open SQLite database. Schema is created only on the first successful call per process.
/// If schema initialization fails, it will be retried on the next call.
pub fn open_db() -> Result<Connection, String> {
    let db_path = app_db_path()?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    // Always enable foreign keys (per-connection setting in SQLite)
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;

    // Schema creation: only once on success, retried on failure
    let mut initialized = SCHEMA_INITIALIZED.lock().unwrap_or_else(|e| e.into_inner());
    if !*initialized {
        ensure_schema(&conn)?;
        *initialized = true;
    }

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
