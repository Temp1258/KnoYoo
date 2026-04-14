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

/// Directory for stored book files (EPUB/PDF).
pub fn app_books_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("books");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Directory for extracted book cover images.
pub fn app_book_covers_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("book_covers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
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

    // Migration: soft delete support
    conn.execute(
        "ALTER TABLE web_clips ADD COLUMN deleted_at TEXT",
        [],
    )
    .ok();
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_web_clips_deleted_at ON web_clips(deleted_at)",
        [],
    )
    .ok();

    // Migration: keep FTS index in PERFECT sync with web_clips, regardless of
    // deleted_at. Earlier attempts filtered soft-deleted rows out of FTS, but
    // that breaks hard-delete paths (empty trash / purge) because the AFTER
    // DELETE trigger then tries to remove a rowid that isn't in FTS — SQLite
    // reports an inconsistency error and rolls back the entire DELETE.
    //
    // Search queries filter soft-deleted rows via `WHERE deleted_at IS NULL`
    // at query time, so leaving them in the FTS table is harmless (tiny index
    // bloat, auto-purged with the 30-day trash cleanup).
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS web_clips_ai;
         CREATE TRIGGER web_clips_ai AFTER INSERT ON web_clips BEGIN
           INSERT INTO web_clips_fts(rowid, title, content, summary, tags)
             VALUES (new.id, new.title, new.content, new.summary, new.tags);
         END;

         DROP TRIGGER IF EXISTS web_clips_au;
         CREATE TRIGGER web_clips_au AFTER UPDATE ON web_clips BEGIN
           INSERT INTO web_clips_fts(web_clips_fts, rowid, title, content, summary, tags)
             VALUES('delete', old.id, old.title, old.content, old.summary, old.tags);
           INSERT INTO web_clips_fts(rowid, title, content, summary, tags)
             VALUES (new.id, new.title, new.content, new.summary, new.tags);
         END;",
    )
    .ok();

    // Migration: chat sessions for AI assistant persistence
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chat_sessions (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          title       TEXT NOT NULL DEFAULT '',
          messages    TEXT NOT NULL DEFAULT '[]',
          created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );",
    )
    .ok();

    // Migration: smart collection filter rules
    conn.execute(
        "ALTER TABLE collections ADD COLUMN filter_rule TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();

    // Migration: books library ("图书角")
    // NOTE: file_hash uses a PARTIAL unique index (below) rather than an inline UNIQUE,
    // so soft-deleted rows never block re-upload of the same file.
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS books (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          file_hash        TEXT NOT NULL,
          title            TEXT NOT NULL,
          author           TEXT NOT NULL DEFAULT '',
          publisher        TEXT NOT NULL DEFAULT '',
          published_year   INTEGER,
          description      TEXT NOT NULL DEFAULT '',
          cover_path       TEXT NOT NULL DEFAULT '',
          file_path        TEXT NOT NULL,
          file_format      TEXT NOT NULL,
          file_size        INTEGER NOT NULL,
          page_count       INTEGER,
          status           TEXT NOT NULL DEFAULT 'want',
          progress_percent REAL NOT NULL DEFAULT 0,
          rating           INTEGER,
          notes            TEXT NOT NULL DEFAULT '',
          tags             TEXT NOT NULL DEFAULT '[]',
          added_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          started_at       TEXT,
          finished_at      TEXT,
          last_opened_at   TEXT,
          updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          deleted_at       TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_books_file_hash_active
          ON books(file_hash) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
        CREATE INDEX IF NOT EXISTS idx_books_deleted_at ON books(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_books_updated_at ON books(updated_at DESC);
        "#,
    )
    .ok();

    // Migration: if the books table was created by a prior version with an
    // inline `UNIQUE` on file_hash, SQLite created `sqlite_autoindex_books_*`.
    // That constraint blocks re-uploading a soft-deleted book, so rebuild the
    // table without it. No-op on fresh installs.
    let has_legacy_unique: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master
             WHERE type='index' AND tbl_name='books' AND name LIKE 'sqlite_autoindex_%'
             LIMIT 1",
            [],
            |_| Ok(()),
        )
        .is_ok();
    if has_legacy_unique {
        tracing::info!("Migrating books table: removing legacy UNIQUE on file_hash");
        let migration = conn.execute_batch(
            r#"
            BEGIN;
            CREATE TABLE books_new (
              id               INTEGER PRIMARY KEY AUTOINCREMENT,
              file_hash        TEXT NOT NULL,
              title            TEXT NOT NULL,
              author           TEXT NOT NULL DEFAULT '',
              publisher        TEXT NOT NULL DEFAULT '',
              published_year   INTEGER,
              description      TEXT NOT NULL DEFAULT '',
              cover_path       TEXT NOT NULL DEFAULT '',
              file_path        TEXT NOT NULL,
              file_format      TEXT NOT NULL,
              file_size        INTEGER NOT NULL,
              page_count       INTEGER,
              status           TEXT NOT NULL DEFAULT 'want',
              progress_percent REAL NOT NULL DEFAULT 0,
              rating           INTEGER,
              notes            TEXT NOT NULL DEFAULT '',
              tags             TEXT NOT NULL DEFAULT '[]',
              added_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              started_at       TEXT,
              finished_at      TEXT,
              last_opened_at   TEXT,
              updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              deleted_at       TEXT
            );
            INSERT INTO books_new SELECT * FROM books;
            DROP TABLE books;
            ALTER TABLE books_new RENAME TO books;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_books_file_hash_active
              ON books(file_hash) WHERE deleted_at IS NULL;
            CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
            CREATE INDEX IF NOT EXISTS idx_books_deleted_at ON books(deleted_at);
            CREATE INDEX IF NOT EXISTS idx_books_updated_at ON books(updated_at DESC);
            COMMIT;
            "#,
        );
        if let Err(e) = migration {
            tracing::error!("books table migration failed (rolling back): {}", e);
            let _ = conn.execute_batch("ROLLBACK;");
        } else {
            tracing::info!("books table migration complete");
        }
    }

    // Purge trash clips older than 30 days on startup
    conn.execute(
        "DELETE FROM web_clips WHERE deleted_at IS NOT NULL
         AND deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')",
        [],
    )
    .ok();

    // Rebuild FTS index once at startup to heal any historic inconsistencies
    // (e.g. soft-deleted rows that were indexed before the triggers learned to
    // skip them, duplicate rowids from older versions). This is idempotent and
    // runs quickly — the contentless FTS table just replays from web_clips.
    if let Err(e) =
        conn.execute("INSERT INTO web_clips_fts(web_clips_fts) VALUES('rebuild')", [])
    {
        tracing::warn!("FTS rebuild skipped: {}", e);
    } else {
        tracing::info!("FTS index rebuilt");
    }

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

/// Get database file path and size for display in settings.
#[tauri::command]
pub fn get_database_info() -> Result<(String, u64), String> {
    let path = app_db_path()?;
    let size = std::fs::metadata(&path)
        .map(|m| m.len())
        .unwrap_or(0);
    Ok((path.to_string_lossy().to_string(), size))
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
