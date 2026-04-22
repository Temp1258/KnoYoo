use directories::ProjectDirs;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// Tracks whether schema has been successfully initialized for this process.
/// Using Mutex<bool> instead of `OnceLock` so failed initialization can be retried.
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

/// Scratch directory for in-flight video → ASR artifacts (downloaded audio,
/// ffmpeg splits). Safe to purge on startup — nothing in here is durable.
pub fn app_temp_media_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("temp_media");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Directory for user-uploaded local documents (pdf / docx / md / txt).
/// Mirrors `app_books_dir()` — each imported file is copied here and the
/// row's `file_path` points into this directory.
#[allow(dead_code)] // consumed by documents.rs (Phase C, not yet landed)
pub fn app_documents_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("documents");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Run schema creation and migrations (only once per process).
fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r"
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

    -- User notes attached to clips (1:1 relationship)
    CREATE TABLE IF NOT EXISTS clip_notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      clip_id     INTEGER NOT NULL UNIQUE,
      content     TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (clip_id) REFERENCES web_clips(id) ON DELETE CASCADE
    );
    ",
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

    // Migration: store raw HTML-stripped dump alongside the cleaned content.
    // Stage 1 of the 3-stage web-clip pipeline fills this with the full text
    // of the page (before AI cleanup); stage 2 reads it to produce the
    // readable version that overwrites `content`. Keeping the raw side lets
    // the UI offer a "查看原始" toggle and survives bad AI outputs.
    conn.execute(
        "ALTER TABLE web_clips ADD COLUMN raw_content TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_web_clips_deleted_at ON web_clips(deleted_at)",
        [],
    )
    .ok();

    // Migration: video → ASR transcription pipeline.
    //
    // transcription_status drives the same state machine books.ai_status uses:
    //   '' (non-video clip) | pending | downloading | transcribing | cleaning
    //   | completed | failed
    //
    // transcription_source records provenance so the UI can show "字幕" vs
    // "ASR · Deepgram" and so we can rerun only the failed path on retry:
    //   '' | subtitle | asr:openai | asr:deepgram | asr:siliconflow
    conn.execute(
        "ALTER TABLE web_clips ADD COLUMN transcription_status TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE web_clips ADD COLUMN transcription_error TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE web_clips ADD COLUMN transcription_source TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE web_clips ADD COLUMN audio_duration_sec INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .ok();

    // Migration: bilingual subtitles. For clips whose source language isn't
    // the user's (zh), we run an extra AI pass after auto-tag to produce a
    // Chinese translation of the cleaned Markdown content.
    //
    // - source_language: ISO 639-1 the AI detected from `content` (e.g. "en",
    //   "ja"). Empty when the translate stage hasn't run or AI isn't configured.
    // - translated_content: Chinese Markdown. Empty when source_language is
    //   already "zh" (AI returns empty translation to avoid wasted tokens).
    //
    // Not added to the FTS trigger — searching both the English original and
    // the Chinese translation would produce duplicated hits for the same
    // clip. The `content` field alone stays the canonical searchable text.
    conn.execute(
        "ALTER TABLE web_clips ADD COLUMN source_language TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE web_clips ADD COLUMN translated_content TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();

    // Partial index: only rows actively in the pipeline. Keeps the index tiny
    // (completed/empty rows dominate the table) while making startup self-heal
    // (`resume_pending_transcription`) an O(log n) lookup.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_web_clips_transcription_pending
           ON web_clips(transcription_status)
           WHERE transcription_status IN ('pending','downloading','transcribing','cleaning')",
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

    // Migration: drop the Collections feature. Removed in the UI reshuffle
    // (集合 → 影音). Dropping in child→parent order avoids FK constraint
    // complaints when `PRAGMA foreign_keys = ON`.
    conn.execute("DROP TABLE IF EXISTS collection_clips", []).ok();
    conn.execute("DROP TABLE IF EXISTS collections", []).ok();

    // Migration: books library ("书籍")
    // NOTE: file_hash uses a PARTIAL unique index (below) rather than an inline UNIQUE,
    // so soft-deleted rows never block re-upload of the same file.
    conn.execute_batch(
        r"
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
        ",
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
            r"
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
            ",
        );
        if let Err(e) = migration {
            tracing::error!("books table migration failed (rolling back): {}", e);
            let _ = conn.execute_batch("ROLLBACK;");
        } else {
            tracing::info!("books table migration complete");
        }
    }

    // Migration: clear legacy bad book metadata so the AI extractor can refill.
    // Books imported by an older build surfaced PDF /Title fields like
    // "Microsoft Word - richdad.doc" as their title, with matching garbage
    // authors and hallucinated AI tags keyed off those fake titles. Clearing
    // the affected fields makes the "only fill empty" rule in
    // ai_extract_book_metadata re-analyze them cleanly on the next run.
    conn.execute(
        "UPDATE books
           SET title = '', author = '', publisher = '', description = '', tags = '[]',
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE title LIKE 'Microsoft Word -%'
            OR title LIKE '%.doc'
            OR title LIKE '%.docx'
            OR lower(title) LIKE '%.pdf'",
        [],
    )
    .ok();

    // Migration: track AI analysis status so the UI can distinguish
    // "still processing" (pending) from "AI failed, click to retry" (failed)
    // instead of showing a forever-spinner. Also records the error message
    // so the failure surface isn't just a silent log line.
    conn.execute(
        "ALTER TABLE books ADD COLUMN ai_status TEXT NOT NULL DEFAULT 'pending'",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE books ADD COLUMN ai_error TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();
    // Backfill: books that already have a title were either user-edited or
    // analyzed by a previous build — mark them 'ok' so we don't re-spinner
    // them. Rows with empty title stay 'pending' and will be picked up by
    // the background extractor (or the drawer's 让 AI 分析 button).
    conn.execute(
        "UPDATE books SET ai_status = 'ok' WHERE ai_status = 'pending' AND title <> ''",
        [],
    )
    .ok();

    // Migration: full-text indexes for unified cross-content search.
    //
    // Uses FTS5's `trigram` tokenizer (SQLite >= 3.34) which generates 3-char
    // substrings as tokens. Critical for CJK: the default `unicode61`
    // tokenizer treats contiguous CJK as a single token, so searching
    // "爸爸" wouldn't match a clip titled "富爸爸穷爸爸" (prefix match must
    // start at a token boundary). Trigram's substring-matching behaviour
    // makes any 2+ char fragment discoverable.
    //
    // Tokenizer switch is one-time + guarded by `fts_tokenizer_version` kv.
    // Earlier installs created these tables with unicode61; we rebuild them
    // exactly once per upgrade. Subsequent starts short-circuit.
    let tokenizer_version = kv_get(conn, "fts_tokenizer_version")?.unwrap_or_default();
    let needs_rebuild = tokenizer_version != "trigram-v1";

    if needs_rebuild {
        tracing::info!("Rebuilding FTS indexes with trigram tokenizer");
        // web_clips_fts — drop old, recreate with trigram, re-seed.
        conn.execute_batch(
            r"
            DROP TRIGGER IF EXISTS web_clips_ai;
            DROP TRIGGER IF EXISTS web_clips_ad;
            DROP TRIGGER IF EXISTS web_clips_au;
            DROP TABLE IF EXISTS web_clips_fts;
            CREATE VIRTUAL TABLE web_clips_fts USING fts5(
                title, content, summary, tags,
                content='web_clips', content_rowid='id',
                tokenize='trigram'
            );
            CREATE TRIGGER web_clips_ai AFTER INSERT ON web_clips BEGIN
              INSERT INTO web_clips_fts(rowid, title, content, summary, tags)
                VALUES (new.id, new.title, new.content, new.summary, new.tags);
            END;
            CREATE TRIGGER web_clips_au AFTER UPDATE ON web_clips BEGIN
              INSERT INTO web_clips_fts(web_clips_fts, rowid, title, content, summary, tags)
                VALUES('delete', old.id, old.title, old.content, old.summary, old.tags);
              INSERT INTO web_clips_fts(rowid, title, content, summary, tags)
                VALUES (new.id, new.title, new.content, new.summary, new.tags);
            END;
            INSERT INTO web_clips_fts(web_clips_fts) VALUES('rebuild');
            ",
        )
        .map_err(|e| format!("web_clips_fts trigram rebuild failed: {e}"))?;

        // books_fts — same treatment.
        conn.execute_batch(
            r"
            DROP TRIGGER IF EXISTS books_ai;
            DROP TRIGGER IF EXISTS books_ad;
            DROP TRIGGER IF EXISTS books_au;
            DROP TABLE IF EXISTS books_fts;
            CREATE VIRTUAL TABLE books_fts USING fts5(
                title, author, publisher, description,
                content='books', content_rowid='id',
                tokenize='trigram'
            );
            CREATE TRIGGER books_ai AFTER INSERT ON books BEGIN
              INSERT INTO books_fts(rowid, title, author, publisher, description)
                VALUES (new.id, new.title, new.author, new.publisher, new.description);
            END;
            CREATE TRIGGER books_ad AFTER DELETE ON books BEGIN
              INSERT INTO books_fts(books_fts, rowid, title, author, publisher, description)
                VALUES('delete', old.id, old.title, old.author, old.publisher, old.description);
            END;
            CREATE TRIGGER books_au AFTER UPDATE ON books BEGIN
              INSERT INTO books_fts(books_fts, rowid, title, author, publisher, description)
                VALUES('delete', old.id, old.title, old.author, old.publisher, old.description);
              INSERT INTO books_fts(rowid, title, author, publisher, description)
                VALUES (new.id, new.title, new.author, new.publisher, new.description);
            END;
            INSERT INTO books_fts(books_fts) VALUES('rebuild');
            ",
        )
        .map_err(|e| format!("books_fts trigram rebuild failed: {e}"))?;

        set_kv(conn, "fts_tokenizer_version", "trigram-v1")?;
        tracing::info!("FTS trigram rebuild complete");
    }

    // Migration: milestones ("里程碑与仪式感")
    //
    // Tracks ceremonial achievements ("收藏突破 100 条", "连续 30 天有新输入",
    // "完成第 10 本书") so the Discover page can surface a celebration card and
    // the user feels their knowledge base growing.
    //
    // UNIQUE(kind, value, meta_json) + INSERT OR IGNORE guarantees each
    // threshold fires exactly once. meta_json is structured JSON so future
    // milestone types (goal completion, streaks, etc.) can carry payloads
    // without another migration.
    //
    // `acknowledged` is 0/1. First-run backfill marks all currently-met
    // thresholds as acknowledged so upgrading users don't get blasted with a
    // queue of retroactive achievements.
    conn.execute_batch(
        r"
        CREATE TABLE IF NOT EXISTS milestones (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          kind           TEXT NOT NULL,
          value          INTEGER NOT NULL,
          meta_json      TEXT NOT NULL DEFAULT '{}',
          achieved_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          acknowledged   INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_milestones_kind_value_meta
          ON milestones(kind, value, meta_json);
        CREATE INDEX IF NOT EXISTS idx_milestones_unacked
          ON milestones(acknowledged, achieved_at DESC);
        ",
    )
    .ok();

    // ══════════════════════════════════════════════════════════════════════
    // Migration: media_items ("影音") — dedicated table for user-uploaded
    // local audio / video files. Split from web_clips, which historically
    // mixed article + online-video (both web-sourced) with audio +
    // local_video (both local uploads). Transcription / source_language /
    // translated_content / local file_path fields are NULL-forever on
    // article rows — field needs diverged long ago.
    //
    // One-time data migration from web_clips → media_items lives in
    // `migrate_media_items_from_web_clips` (guarded by the
    // `media_migration_v1` app_kv flag). See PLAN_DOCUMENTS.md Phase B.
    //
    // FTS triggers mirror the books pattern (ai/ad/au all present) so hard
    // deletes (trash purge) keep FTS consistent. `file_hash` uses a partial
    // unique index over active non-empty hashes so soft-deleted rows and
    // legacy migrated rows (which had no hash stored) never block reimport.
    // ══════════════════════════════════════════════════════════════════════
    conn.execute_batch(
        r"
        CREATE TABLE IF NOT EXISTS media_items (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          media_type           TEXT NOT NULL,
          title                TEXT NOT NULL DEFAULT '',
          file_path            TEXT NOT NULL DEFAULT '',
          file_hash            TEXT NOT NULL DEFAULT '',
          file_size            INTEGER NOT NULL DEFAULT 0,
          audio_duration_sec   INTEGER NOT NULL DEFAULT 0,
          content              TEXT NOT NULL DEFAULT '',
          raw_content          TEXT NOT NULL DEFAULT '',
          summary              TEXT NOT NULL DEFAULT '',
          tags                 TEXT NOT NULL DEFAULT '[]',
          notes                TEXT NOT NULL DEFAULT '',
          transcription_status TEXT NOT NULL DEFAULT '',
          transcription_error  TEXT NOT NULL DEFAULT '',
          transcription_source TEXT NOT NULL DEFAULT '',
          source_language      TEXT NOT NULL DEFAULT '',
          translated_content   TEXT NOT NULL DEFAULT '',
          ai_status            TEXT NOT NULL DEFAULT 'pending',
          ai_error             TEXT NOT NULL DEFAULT '',
          is_starred           INTEGER NOT NULL DEFAULT 0,
          is_read              INTEGER NOT NULL DEFAULT 0,
          created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          deleted_at           TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_file_hash_active
          ON media_items(file_hash) WHERE deleted_at IS NULL AND file_hash <> '';
        CREATE INDEX IF NOT EXISTS idx_media_items_type    ON media_items(media_type);
        CREATE INDEX IF NOT EXISTS idx_media_items_deleted ON media_items(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_media_items_created ON media_items(created_at DESC);

        CREATE VIRTUAL TABLE IF NOT EXISTS media_items_fts USING fts5(
            title, content, summary, tags,
            content='media_items', content_rowid='id',
            tokenize='trigram'
        );
        CREATE TRIGGER IF NOT EXISTS media_items_ai AFTER INSERT ON media_items BEGIN
          INSERT INTO media_items_fts(rowid, title, content, summary, tags)
            VALUES (new.id, new.title, new.content, new.summary, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS media_items_ad AFTER DELETE ON media_items BEGIN
          INSERT INTO media_items_fts(media_items_fts, rowid, title, content, summary, tags)
            VALUES('delete', old.id, old.title, old.content, old.summary, old.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS media_items_au AFTER UPDATE ON media_items BEGIN
          INSERT INTO media_items_fts(media_items_fts, rowid, title, content, summary, tags)
            VALUES('delete', old.id, old.title, old.content, old.summary, old.tags);
          INSERT INTO media_items_fts(rowid, title, content, summary, tags)
            VALUES (new.id, new.title, new.content, new.summary, new.tags);
        END;
        ",
    )
    .map_err(|e| format!("media_items schema init failed: {e}"))?;

    // Additive migration: the `notes` column was added after the initial
    // B.1 schema shipped. `CREATE TABLE IF NOT EXISTS` is a no-op on an
    // existing table, so tables created by earlier dev builds lack the
    // column — ALTER TABLE ADD COLUMN (wrapped in .ok()) brings them up
    // to parity without touching fresh installs. Same pattern the
    // web_clips migrations above use.
    conn.execute(
        "ALTER TABLE media_items ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();

    // ══════════════════════════════════════════════════════════════════════
    // Migration: documents ("文档") — user-uploaded local text files
    // (pdf / docx / md / txt). Independent table because its field needs
    // (file_format, word_count, toc_json, local file_path) are unrelated
    // to web-sourced clips. See BLUEPRINT P1 / PLAN_DOCUMENTS.md Phase C.
    //
    // FTS follows the same ai/ad/au pattern as media_items and books.
    // toc_json is stored as a JSON string (possibly empty) describing
    // [{title, level, anchor}, …] for the document's chapter structure,
    // consumed by the TocSidebar component in the detail drawer.
    // ══════════════════════════════════════════════════════════════════════
    conn.execute_batch(
        r"
        CREATE TABLE IF NOT EXISTS documents (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          title          TEXT NOT NULL DEFAULT '',
          file_path      TEXT NOT NULL,
          file_hash      TEXT NOT NULL,
          file_format    TEXT NOT NULL,
          file_size      INTEGER NOT NULL DEFAULT 0,
          word_count     INTEGER NOT NULL DEFAULT 0,
          toc_json       TEXT NOT NULL DEFAULT '',
          content        TEXT NOT NULL DEFAULT '',
          raw_content    TEXT NOT NULL DEFAULT '',
          summary        TEXT NOT NULL DEFAULT '',
          tags           TEXT NOT NULL DEFAULT '[]',
          notes          TEXT NOT NULL DEFAULT '',
          ai_status      TEXT NOT NULL DEFAULT 'pending',
          ai_error       TEXT NOT NULL DEFAULT '',
          is_starred     INTEGER NOT NULL DEFAULT 0,
          is_read        INTEGER NOT NULL DEFAULT 0,
          last_opened_at TEXT,
          added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          deleted_at     TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_file_hash_active
          ON documents(file_hash) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_documents_format  ON documents(file_format);
        CREATE INDEX IF NOT EXISTS idx_documents_deleted ON documents(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_documents_added   ON documents(added_at DESC);

        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
            title, content, summary, tags,
            content='documents', content_rowid='id',
            tokenize='trigram'
        );
        CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
          INSERT INTO documents_fts(rowid, title, content, summary, tags)
            VALUES (new.id, new.title, new.content, new.summary, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
          INSERT INTO documents_fts(documents_fts, rowid, title, content, summary, tags)
            VALUES('delete', old.id, old.title, old.content, old.summary, old.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
          INSERT INTO documents_fts(documents_fts, rowid, title, content, summary, tags)
            VALUES('delete', old.id, old.title, old.content, old.summary, old.tags);
          INSERT INTO documents_fts(rowid, title, content, summary, tags)
            VALUES (new.id, new.title, new.content, new.summary, new.tags);
        END;
        ",
    )
    .map_err(|e| format!("documents schema init failed: {e}"))?;

    // Additive migration: `notes` column added after the initial documents
    // schema shipped. Idempotent — fails silently on tables that already
    // include it, which is the fresh-install path.
    conn.execute(
        "ALTER TABLE documents ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();

    // Purge trash clips older than 30 days on startup.
    // NOTE: only web_clips gets auto-purged here because its "files" are
    // just rows (no on-disk companions). media_items and documents hold
    // real files on disk; their trash purge (with proper file cleanup)
    // belongs to audio.rs / documents.rs respectively, not schema init.
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

    // One-time data migration: move legacy audio/local_video rows from
    // web_clips into media_items. Guarded by `media_migration_v1` in
    // app_kv. Must run AFTER the media_items / documents schema exists
    // (above) and AFTER audio.rs was rewritten to write to media_items
    // (Phase B.4) — otherwise new imports would be stranded in web_clips
    // between migration-set and pipeline-switch.
    migrate_media_items_from_web_clips(conn)?;

    tracing::info!("Database schema initialized");
    Ok(())
}

/// One-time migration: move audio / `local_video` rows from `web_clips` into
/// the dedicated `media_items` table, preserving ids, fields, and inline
/// notes copied from `clip_notes` (whose FK cascade would otherwise wipe
/// those notes when we DELETE the source rows). Runs inside a transaction;
/// aborts with ROLLBACK + error if any validation check fails.
///
/// Idempotent via `app_kv['media_migration_v1']` — skips silently once done.
///
/// Legacy-row field reconstruction:
/// - `media_type` ← `source_type` (always `'audio'` or `'local_video'`)
/// - `file_hash` ← parsed out of the synthetic URL
///   (`audio-local://<hash>` or `local-video://<hash>`)
/// - `file_path` ← `''` (never persisted for audio; see `audio.rs`)
/// - `file_size` ← `0` (likewise never persisted)
/// - `ai_status` ← `'ok'` if transcription completed, else `'pending'`
/// - `notes` ← `clip_notes.content` via `LEFT JOIN`
pub fn migrate_media_items_from_web_clips(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    if kv_get(conn, "media_migration_v1")?.as_deref() == Some("done") {
        return Ok(());
    }

    // Expected row count — used to verify the INSERT landed every row.
    let expected: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM web_clips WHERE source_type IN ('audio','local_video')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("count legacy rows: {e}"))?;

    if expected == 0 {
        // Nothing to migrate — set flag so we don't keep probing on startup.
        set_kv(conn, "media_migration_v1", "done")?;
        return Ok(());
    }

    tracing::info!(
        target = "db",
        "migrating {} audio/local_video rows from web_clips → media_items",
        expected
    );

    // All-or-nothing transaction. Any failure short-circuits to ROLLBACK
    // and returns Err — callers surface this through ensure_schema so the
    // app refuses to start on a failed migration, protecting user data.
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("begin tx: {e}"))?;

    let insert_sql = r"
        INSERT INTO media_items (
            id, media_type, title, file_path, file_hash, file_size,
            audio_duration_sec, content, raw_content, summary, tags, notes,
            transcription_status, transcription_error, transcription_source,
            source_language, translated_content,
            ai_status, ai_error,
            is_starred, is_read,
            created_at, updated_at, deleted_at
        )
        SELECT
            w.id,
            w.source_type,
            w.title,
            '',
            CASE
                WHEN w.url LIKE 'audio-local://%'
                    THEN substr(w.url, length('audio-local://') + 1)
                WHEN w.url LIKE 'local-video://%'
                    THEN substr(w.url, length('local-video://') + 1)
                ELSE ''
            END,
            0,
            w.audio_duration_sec,
            w.content,
            w.raw_content,
            w.summary,
            w.tags,
            COALESCE(n.content, ''),
            w.transcription_status,
            w.transcription_error,
            w.transcription_source,
            w.source_language,
            w.translated_content,
            CASE WHEN w.transcription_status = 'completed' THEN 'ok' ELSE 'pending' END,
            '',
            w.is_starred,
            w.is_read,
            w.created_at,
            w.updated_at,
            w.deleted_at
        FROM web_clips w
        LEFT JOIN clip_notes n ON n.clip_id = w.id
        WHERE w.source_type IN ('audio','local_video')
    ";
    let inserted = match conn.execute(insert_sql, []) {
        Ok(n) => i64::try_from(n).map_err(|e| format!("insert count overflow: {e}"))?,
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(format!("INSERT INTO media_items failed: {e}"));
        }
    };

    // Validate A: every legacy row landed in media_items.
    if inserted != expected {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(format!(
            "media_items insert row-count mismatch: expected {expected}, got {inserted}"
        ));
    }

    // DELETE legacy rows (cascade removes matching clip_notes naturally —
    // they've already been copied into media_items.notes above).
    if let Err(e) = conn.execute(
        "DELETE FROM web_clips WHERE source_type IN ('audio','local_video')",
        [],
    ) {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(format!("DELETE legacy web_clips rows failed: {e}"));
    }

    // Validate B: zero audio/local_video rows remain in web_clips.
    let residue: i64 = match conn.query_row(
        "SELECT COUNT(*) FROM web_clips WHERE source_type IN ('audio','local_video')",
        [],
        |r| r.get(0),
    ) {
        Ok(n) => n,
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(format!("post-delete residue query: {e}"));
        }
    };
    if residue != 0 {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(format!(
            "web_clips still has {residue} audio/local_video rows after DELETE"
        ));
    }

    set_kv(conn, "media_migration_v1", "done")?;
    conn.execute_batch("COMMIT")
        .map_err(|e| format!("commit tx: {e}"))?;

    tracing::info!(
        target = "db",
        "media_items migration complete: {} rows moved, {} legacy rows removed",
        inserted,
        expected
    );
    Ok(())
}

/// Open `SQLite` database. Schema is created only on the first successful call per process.
/// If schema initialization fails, it will be retried on the next call.
pub fn open_db() -> Result<Connection, String> {
    let db_path = app_db_path()?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    // Always enable foreign keys (per-connection setting in SQLite)
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;

    // Schema creation: only once on success, retried on failure
    let mut initialized = SCHEMA_INITIALIZED.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
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

/// Helper: INSERT-or-UPDATE a single `app_kv` entry.
pub(crate) fn set_kv(
    conn: &rusqlite::Connection,
    key: &str,
    val: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_kv(key, val) VALUES(?1, ?2)
           ON CONFLICT(key) DO UPDATE SET val = excluded.val",
        rusqlite::params![key, val],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Keychain account name for a given AI provider. Stable external contract:
/// Keychain Access shows users entries by this name, so changing the format
/// would strand existing secrets.
pub fn ai_keychain_account_for(provider: &str) -> String {
    format!("ai_{provider}")
}

/// Idempotent migration: earlier builds stored a single flat `api_key` in
/// `app_kv` keyed by `provider` (and `api_base` / `model` likewise flat).
/// Move each into its per-provider slot, push the raw key into the OS
/// keychain, and wipe every legacy row. Running on a fresh install is a
/// no-op (the SELECTs just return None).
pub fn migrate_ai_keys_to_keychain(conn: &rusqlite::Connection) -> Result<(), String> {
    // Step 1: promote any flat (pre-Round-6) layout into per-provider rows.
    let legacy_provider = kv_get(conn, "provider")?.unwrap_or_default();
    if legacy_provider.is_empty() {
        // No legacy selected provider but possibly an orphan api_key row —
        // remove it defensively so it never lingers in backups.
        conn.execute("DELETE FROM app_kv WHERE key = 'api_key'", [])
            .map_err(|e| e.to_string())?;
    } else {
        if kv_get(conn, "ai_selected_provider")?
            .unwrap_or_default()
            .is_empty()
        {
            set_kv(conn, "ai_selected_provider", &legacy_provider)?;
        }
        // api_base / model move to their per-provider slot. The `api_key`
        // is handled separately in step 2 — it goes to keychain, not DB.
        for (legacy, per_provider) in [
            ("api_base", format!("ai_api_base__{legacy_provider}")),
            ("model", format!("ai_model__{legacy_provider}")),
        ] {
            let dest = kv_get(conn, &per_provider)?.unwrap_or_default();
            if dest.is_empty() {
                if let Some(val) = kv_get(conn, legacy)? {
                    if !val.is_empty() {
                        set_kv(conn, &per_provider, &val)?;
                    }
                }
            }
        }
        // Legacy api_key → keychain under `ai_<legacy_provider>`, plus
        // the non-secret flag + 尾号 so the settings UI never has to
        // probe the keychain to show "已配置".
        if let Some(key) = kv_get(conn, "api_key")? {
            if !key.is_empty() {
                let account = ai_keychain_account_for(&legacy_provider);
                let existing = crate::secrets::get(&account).map_err(|e| e.to_string())?;
                if existing.is_none() {
                    crate::secrets::set(&account, &key).map_err(|e| e.to_string())?;
                }
                set_kv(conn, &format!("ai_configured__{legacy_provider}"), "true")?;
                set_kv(
                    conn,
                    &format!("ai_key_hint__{legacy_provider}"),
                    &crate::secrets::key_last_four(&key),
                )?;
            }
        }
        // Wipe legacy rows.
        conn.execute(
            "DELETE FROM app_kv WHERE key IN ('provider','api_base','api_key','model')",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    // Step 2: drain any per-provider `api_key__*` rows (a previous build
    // stored them in DB). Move survivors into the keychain and drop the
    // DB rows. No intermediate builds shipped with this shape, but leaving
    // the sweep in place costs us nothing and future-proofs.
    let mut stmt = conn
        .prepare("SELECT key, val FROM app_kv WHERE key LIKE 'ai_api_key__%'")
        .map_err(|e| e.to_string())?;
    let pairs: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    drop(stmt);
    for (db_key, value) in pairs {
        let provider = db_key
            .strip_prefix("ai_api_key__")
            .expect("LIKE filter guarantees prefix");
        if !value.is_empty() {
            let account = ai_keychain_account_for(provider);
            let existing = crate::secrets::get(&account).map_err(|e| e.to_string())?;
            if existing.is_none() {
                crate::secrets::set(&account, &value).map_err(|e| e.to_string())?;
            }
            set_kv(conn, &format!("ai_configured__{provider}"), "true")?;
            set_kv(
                conn,
                &format!("ai_key_hint__{provider}"),
                &crate::secrets::key_last_four(&value),
            )?;
        }
        conn.execute("DELETE FROM app_kv WHERE key = ?1", [&db_key])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Read AI configuration for the currently selected provider.
///
/// Returns a flat `HashMap<String, String>` with `provider` / `api_base` /
/// `api_key` / `model` keys — the shape `AiClientConfig::from_map` expects.
/// The `api_key` value is pulled live from the OS keychain, not from any
/// `SQLite` row.
pub fn read_ai_config(
    conn: &rusqlite::Connection,
) -> Result<std::collections::HashMap<String, String>, String> {
    migrate_ai_keys_to_keychain(conn)?;

    let mut out = std::collections::HashMap::new();
    let provider = kv_get(conn, "ai_selected_provider")?.unwrap_or_default();
    if provider.is_empty() {
        return Ok(out);
    }

    out.insert("provider".into(), provider.clone());
    if let Some(base) = kv_get(conn, &format!("ai_api_base__{provider}"))? {
        if !base.is_empty() {
            out.insert("api_base".into(), base);
        }
    }
    if let Some(model) = kv_get(conn, &format!("ai_model__{provider}"))? {
        if !model.is_empty() {
            out.insert("model".into(), model);
        }
    }
    if let Some(key) = crate::secrets::get(&ai_keychain_account_for(&provider))
        .map_err(|e| e.to_string())?
    {
        if !key.is_empty() {
            out.insert("api_key".into(), key);
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
    if result == "ok" {
        tracing::info!("Database integrity check: ok");
    } else {
        tracing::error!("Database integrity check failed: {}", result);
    }
    Ok(result)
}

/// Get database file path and size for display in settings.
#[tauri::command]
pub fn get_database_info() -> Result<(String, u64), String> {
    let path = app_db_path()?;
    let size = std::fs::metadata(&path)
        .map_or(0, |m| m.len());
    Ok((path.to_string_lossy().to_string(), size))
}

/// Relaunch the app. Used after `import_full_database` so the user doesn't
/// see stale in-memory state (milestones, clip counts, etc.) derived from
/// the old DB. Called from Settings → Data → "导入备份" → success dialog.
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            r"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS app_kv (
              key TEXT PRIMARY KEY,
              val TEXT NOT NULL
            );
            ",
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

    // ── AI key migration: legacy app_kv → keychain ─────────────────────

    fn seed(conn: &Connection, key: &str, val: &str) {
        super::set_kv(conn, key, val).expect("kv insert");
    }

    #[test]
    fn ai_migration_populates_configured_flag_and_hint() {
        // After migration the settings panel must render "已配置 · 尾号 real"
        // without probing the keychain — that's the whole point of the
        // Round 8 flag/hint mirror. Confirm the flag + hint land in app_kv.
        crate::secrets::reset();
        let conn = test_db();
        seed(&conn, "provider", "openai");
        seed(&conn, "api_key", "sk-abcdefgh1234wxyz");
        super::migrate_ai_keys_to_keychain(&conn).expect("migrate");
        assert_eq!(
            super::kv_get(&conn, "ai_configured__openai").unwrap().as_deref(),
            Some("true")
        );
        assert_eq!(
            super::kv_get(&conn, "ai_key_hint__openai").unwrap().as_deref(),
            Some("wxyz")
        );
    }

    #[test]
    fn ai_migration_moves_flat_key_into_keychain() {
        crate::secrets::reset();
        let conn = test_db();
        // Shape 1: the original flat layout.
        seed(&conn, "provider", "deepseek");
        seed(&conn, "api_key", "sk-deepseek-real");
        seed(&conn, "api_base", "https://api.deepseek.com");
        seed(&conn, "model", "deepseek-chat");

        super::migrate_ai_keys_to_keychain(&conn).expect("migrate");

        // Secret lands in keychain, legacy DB rows are gone.
        assert_eq!(
            crate::secrets::get("ai_deepseek").unwrap().as_deref(),
            Some("sk-deepseek-real")
        );
        assert!(super::kv_get(&conn, "api_key").unwrap().is_none());
        assert!(super::kv_get(&conn, "provider").unwrap().is_none());
        assert!(super::kv_get(&conn, "api_base").unwrap().is_none());

        // Non-secret settings relocate to per-provider slots.
        assert_eq!(
            super::kv_get(&conn, "ai_selected_provider").unwrap().as_deref(),
            Some("deepseek")
        );
        assert_eq!(
            super::kv_get(&conn, "ai_api_base__deepseek").unwrap().as_deref(),
            Some("https://api.deepseek.com")
        );
        assert_eq!(
            super::kv_get(&conn, "ai_model__deepseek").unwrap().as_deref(),
            Some("deepseek-chat")
        );
    }

    #[test]
    fn ai_migration_is_idempotent() {
        crate::secrets::reset();
        let conn = test_db();
        seed(&conn, "provider", "openai");
        seed(&conn, "api_key", "sk-openai");
        super::migrate_ai_keys_to_keychain(&conn).expect("1st");
        super::migrate_ai_keys_to_keychain(&conn).expect("2nd");
        assert_eq!(
            crate::secrets::get("ai_openai").unwrap().as_deref(),
            Some("sk-openai")
        );
    }

    #[test]
    fn ai_migration_preserves_existing_keychain_entry() {
        crate::secrets::reset();
        let conn = test_db();
        // User already saved a newer key via post-migration UI.
        crate::secrets::set("ai_openai", "sk-new-from-ui").unwrap();
        seed(&conn, "provider", "openai");
        seed(&conn, "api_key", "sk-stale-legacy");

        super::migrate_ai_keys_to_keychain(&conn).expect("migrate");

        assert_eq!(
            crate::secrets::get("ai_openai").unwrap().as_deref(),
            Some("sk-new-from-ui"),
            "never clobber a newer keychain value"
        );
        assert!(super::kv_get(&conn, "api_key").unwrap().is_none());
    }

    #[test]
    fn ai_migration_no_op_on_fresh_install() {
        crate::secrets::reset();
        let conn = test_db();
        super::migrate_ai_keys_to_keychain(&conn).expect("migrate");
        assert!(crate::secrets::get("ai_openai").unwrap().is_none());
    }

    #[test]
    fn ai_migration_cleans_orphan_api_key_without_provider() {
        // Defense in depth: if some prior bug left an `api_key` row but no
        // `provider`, we still must not leave it sitting in backups.
        crate::secrets::reset();
        let conn = test_db();
        seed(&conn, "api_key", "sk-orphan");
        super::migrate_ai_keys_to_keychain(&conn).expect("migrate");
        assert!(super::kv_get(&conn, "api_key").unwrap().is_none());
    }

    #[test]
    fn read_ai_config_pulls_key_from_keychain() {
        crate::secrets::reset();
        let conn = test_db();
        seed(&conn, "ai_selected_provider", "openai");
        seed(&conn, "ai_api_base__openai", "https://api.openai.com");
        seed(&conn, "ai_model__openai", "gpt-4o-mini");
        crate::secrets::set("ai_openai", "sk-runtime-key").unwrap();

        let cfg = super::read_ai_config(&conn).unwrap();
        assert_eq!(cfg.get("provider").map(String::as_str), Some("openai"));
        assert_eq!(cfg.get("api_key").map(String::as_str), Some("sk-runtime-key"));
        assert_eq!(
            cfg.get("api_base").map(String::as_str),
            Some("https://api.openai.com")
        );
        assert_eq!(cfg.get("model").map(String::as_str), Some("gpt-4o-mini"));
    }

    #[test]
    fn keychain_account_name_is_stable() {
        // External contract: keychain entries show up under this name.
        assert_eq!(super::ai_keychain_account_for("openai"), "ai_openai");
        assert_eq!(super::ai_keychain_account_for("deepseek"), "ai_deepseek");
    }

    // ── media_items / documents schema + FTS wiring ───────────────────
    //
    // The full ensure_schema path is exercised here (not just a subset)
    // because the FTS trigram rebuild has order-sensitive interactions
    // with trigger setup; running the real migration guarantees tests
    // catch breakage from reordering or dropped DROPs.

    fn full_schema_db() -> Connection {
        crate::secrets::reset();
        let conn = test_db();
        super::ensure_schema(&conn).expect("ensure_schema should succeed on empty in-memory db");
        conn
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).expect("count query")
    }

    #[test]
    fn ensure_schema_creates_media_items_table_and_fts() {
        let conn = full_schema_db();
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'media_items'",
            ),
            1,
            "media_items table should exist"
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'media_items_fts'",
            ),
            1,
            "media_items_fts virtual table should exist"
        );
    }

    #[test]
    fn media_items_fts_insert_and_delete_trigger_work() {
        let conn = full_schema_db();
        conn.execute(
            "INSERT INTO media_items (media_type, title, file_path, content)
             VALUES ('audio', '跑步播客第一集', '/tmp/fake.mp3', '今天讲了马拉松训练方法')",
            [],
        )
        .unwrap();

        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM media_items_fts WHERE media_items_fts MATCH '马拉松'",
            ),
            1,
            "AFTER INSERT trigger should index the row"
        );

        conn.execute("DELETE FROM media_items WHERE id = 1", []).unwrap();
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM media_items_fts WHERE media_items_fts MATCH '马拉松'",
            ),
            0,
            "AFTER DELETE trigger should remove the row from FTS"
        );
    }

    #[test]
    fn ensure_schema_creates_documents_table_and_fts() {
        let conn = full_schema_db();
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'documents'",
            ),
            1
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'documents_fts'",
            ),
            1
        );
    }

    #[test]
    fn documents_fts_update_trigger_swaps_old_for_new() {
        let conn = full_schema_db();
        conn.execute(
            "INSERT INTO documents (title, file_path, file_hash, file_format, content)
             VALUES ('产品白皮书', '/tmp/a.docx', 'hash1', 'docx', '分布式系统的一致性原理')",
            [],
        )
        .unwrap();
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM documents_fts WHERE documents_fts MATCH '分布式'",
            ),
            1
        );

        conn.execute(
            "UPDATE documents SET content = '微服务架构精要' WHERE id = 1",
            [],
        )
        .unwrap();
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM documents_fts WHERE documents_fts MATCH '分布式'",
            ),
            0,
            "AFTER UPDATE trigger must evict old content from FTS"
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM documents_fts WHERE documents_fts MATCH '微服务'",
            ),
            1,
            "AFTER UPDATE trigger must insert new content into FTS"
        );
    }

    #[test]
    fn documents_file_hash_partial_unique_allows_reimport_after_soft_delete() {
        // Mirrors the books table's learned lesson: soft-deleted rows must
        // never block re-uploading the same file under a new row.
        let conn = full_schema_db();
        conn.execute(
            "INSERT INTO documents (title, file_path, file_hash, file_format)
             VALUES ('v1', '/tmp/a.pdf', 'samehash', 'pdf')",
            [],
        )
        .unwrap();

        // Active duplicate must be rejected.
        let dup = conn.execute(
            "INSERT INTO documents (title, file_path, file_hash, file_format)
             VALUES ('dup', '/tmp/a.pdf', 'samehash', 'pdf')",
            [],
        );
        assert!(dup.is_err(), "active file_hash collision should fail");

        // Soft delete — then reimport must succeed.
        conn.execute(
            "UPDATE documents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = 1",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO documents (title, file_path, file_hash, file_format)
             VALUES ('v2', '/tmp/a.pdf', 'samehash', 'pdf')",
            [],
        )
        .expect("soft-deleted row must not block reimport");
    }

    #[test]
    fn media_items_file_hash_empty_does_not_conflict() {
        // Migrated legacy audio rows enter media_items with file_hash = ''
        // (web_clips never stored an audio hash). The partial unique index
        // excludes empty hashes, so multiple legacy rows must coexist.
        let conn = full_schema_db();
        conn.execute(
            "INSERT INTO media_items (media_type, title, file_path, file_hash)
             VALUES ('audio', 'legacy-a', '/tmp/a.mp3', '')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO media_items (media_type, title, file_path, file_hash)
             VALUES ('audio', 'legacy-b', '/tmp/b.mp3', '')",
            [],
        )
        .expect("empty file_hash must never trigger unique collision");
    }

    // ── migrate_media_items_from_web_clips ────────────────────────────

    /// Seed a `web_clips` row as it would appear for a completed audio import
    /// under the pre-refactor pipeline.
    fn seed_legacy_audio(
        conn: &Connection,
        hash: &str,
        title: &str,
        content: &str,
        status: &str,
    ) {
        conn.execute(
            "INSERT INTO web_clips (url, title, content, summary, tags,
                source_type, raw_content, transcription_status, audio_duration_sec,
                source_language, translated_content, is_read, is_starred)
             VALUES (?1, ?2, ?3, 'auto-summary', '[\"播客\"]',
                'audio', 'raw transcript', ?4, 1800,
                'zh', '', 0, 1)",
            rusqlite::params![
                format!("audio-local://{hash}"),
                title,
                content,
                status
            ],
        )
        .expect("seed audio row");
    }

    fn seed_legacy_local_video(conn: &Connection, hash: &str, title: &str) {
        conn.execute(
            "INSERT INTO web_clips (url, title, content, source_type, transcription_status)
             VALUES (?1, ?2, 'transcript text', 'local_video', 'completed')",
            rusqlite::params![format!("local-video://{hash}"), title],
        )
        .expect("seed local_video row");
    }

    fn seed_legacy_article(conn: &Connection, url: &str, title: &str) {
        conn.execute(
            "INSERT INTO web_clips (url, title, source_type)
             VALUES (?1, ?2, 'article')",
            rusqlite::params![url, title],
        )
        .expect("seed article row");
    }

    #[test]
    fn media_migration_moves_audio_and_local_video_preserving_fields() {
        let conn = full_schema_db();
        // Wipe the flag so we can re-trigger the migration (ensure_schema ran it
        // once on an empty web_clips, which set the flag and short-circuited).
        conn.execute("DELETE FROM app_kv WHERE key = 'media_migration_v1'", [])
            .unwrap();

        seed_legacy_audio(&conn, "aaa1", "跑步播客", "今天聊马拉松训练", "completed");
        seed_legacy_local_video(&conn, "bbb2", "周末家庭录像");
        seed_legacy_article(&conn, "https://example.com/post", "一篇文章");

        super::migrate_media_items_from_web_clips(&conn).expect("migrate");

        // media_items now has exactly the 2 rows (1 audio + 1 local_video).
        let media_count = count(&conn, "SELECT COUNT(*) FROM media_items");
        assert_eq!(media_count, 2);

        // web_clips keeps only the article (audio + local_video gone).
        let wc_audio = count(
            &conn,
            "SELECT COUNT(*) FROM web_clips WHERE source_type IN ('audio','local_video')",
        );
        assert_eq!(wc_audio, 0, "no audio/local_video should remain");
        let wc_article = count(
            &conn,
            "SELECT COUNT(*) FROM web_clips WHERE source_type = 'article'",
        );
        assert_eq!(wc_article, 1, "articles must not be disturbed");

        // Inspect the audio row's migrated values.
        let (media_type, title, file_hash, audio_dur, ai_status, transc_status): (
            String,
            String,
            String,
            i64,
            String,
            String,
        ) = conn
            .query_row(
                "SELECT media_type, title, file_hash, audio_duration_sec, ai_status,
                        transcription_status
                 FROM media_items WHERE title = '跑步播客'",
                [],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(media_type, "audio");
        assert_eq!(title, "跑步播客");
        assert_eq!(file_hash, "aaa1", "hash must be parsed out of synthetic url");
        assert_eq!(audio_dur, 1800);
        assert_eq!(transc_status, "completed");
        assert_eq!(
            ai_status, "ok",
            "completed transcription → ai_status = 'ok'"
        );
    }

    #[test]
    fn media_migration_preserves_notes_via_left_join() {
        let conn = full_schema_db();
        conn.execute("DELETE FROM app_kv WHERE key = 'media_migration_v1'", [])
            .unwrap();

        seed_legacy_audio(&conn, "ccc3", "有笔记的播客", "content", "completed");
        let audio_id: i64 = conn
            .query_row(
                "SELECT id FROM web_clips WHERE url = 'audio-local://ccc3'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO clip_notes (clip_id, content) VALUES (?1, ?2)",
            rusqlite::params![audio_id, "这集很启发我，需要复习"],
        )
        .unwrap();

        seed_legacy_audio(&conn, "ddd4", "无笔记的播客", "content", "completed");

        super::migrate_media_items_from_web_clips(&conn).expect("migrate");

        let with_notes: String = conn
            .query_row(
                "SELECT notes FROM media_items WHERE title = '有笔记的播客'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(with_notes, "这集很启发我，需要复习");

        let without_notes: String = conn
            .query_row(
                "SELECT notes FROM media_items WHERE title = '无笔记的播客'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(without_notes, "", "no-note row must get empty string, not NULL");

        // clip_notes for migrated rows are gone (CASCADE from web_clips DELETE).
        let orphan_notes = count(&conn, "SELECT COUNT(*) FROM clip_notes");
        assert_eq!(
            orphan_notes, 0,
            "clip_notes for migrated clips should cascade-delete once copied"
        );
    }

    #[test]
    fn media_migration_preserves_soft_deleted_rows() {
        let conn = full_schema_db();
        conn.execute("DELETE FROM app_kv WHERE key = 'media_migration_v1'", [])
            .unwrap();

        seed_legacy_audio(&conn, "eee5", "已删除的", "content", "completed");
        conn.execute(
            "UPDATE web_clips SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE url = 'audio-local://eee5'",
            [],
        )
        .unwrap();

        super::migrate_media_items_from_web_clips(&conn).expect("migrate");

        let soft_deleted: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM media_items WHERE title = '已删除的'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            soft_deleted.is_some(),
            "soft-deleted audio rows must preserve deleted_at"
        );
    }

    #[test]
    fn media_migration_ai_status_reflects_transcription_status() {
        let conn = full_schema_db();
        conn.execute("DELETE FROM app_kv WHERE key = 'media_migration_v1'", [])
            .unwrap();

        seed_legacy_audio(&conn, "f1", "完成", "c", "completed");
        seed_legacy_audio(&conn, "f2", "失败", "c", "failed");
        seed_legacy_audio(&conn, "f3", "进行中", "c", "transcribing");

        super::migrate_media_items_from_web_clips(&conn).expect("migrate");

        let get_ai = |title: &str| -> String {
            conn.query_row(
                "SELECT ai_status FROM media_items WHERE title = ?1",
                [title],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(get_ai("完成"), "ok");
        assert_eq!(get_ai("失败"), "pending");
        assert_eq!(get_ai("进行中"), "pending");
    }

    #[test]
    fn media_migration_is_idempotent() {
        let conn = full_schema_db();
        conn.execute("DELETE FROM app_kv WHERE key = 'media_migration_v1'", [])
            .unwrap();
        seed_legacy_audio(&conn, "idem1", "first run", "c", "completed");

        super::migrate_media_items_from_web_clips(&conn).expect("1st");
        super::migrate_media_items_from_web_clips(&conn).expect("2nd");
        super::migrate_media_items_from_web_clips(&conn).expect("3rd");

        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_items"), 1);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM web_clips WHERE source_type IN ('audio','local_video')"
            ),
            0
        );
    }

    #[test]
    fn media_migration_no_op_when_nothing_to_move() {
        // First-run path on a DB that has zero audio/local_video rows —
        // flag is set to 'done' and nothing is inserted. Importantly the
        // function must not panic or touch the flag twice.
        let conn = full_schema_db();
        conn.execute("DELETE FROM app_kv WHERE key = 'media_migration_v1'", [])
            .unwrap();
        seed_legacy_article(&conn, "https://ex.com/a", "article only");

        super::migrate_media_items_from_web_clips(&conn).expect("migrate");

        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_items"), 0);
        assert_eq!(
            super::kv_get(&conn, "media_migration_v1")
                .unwrap()
                .as_deref(),
            Some("done")
        );
    }

    #[test]
    fn media_migration_fts_index_is_populated_for_moved_rows() {
        // End-to-end: after migration, searching FTS must find the moved
        // content. Confirms the AFTER INSERT trigger fired during migration.
        let conn = full_schema_db();
        conn.execute("DELETE FROM app_kv WHERE key = 'media_migration_v1'", [])
            .unwrap();
        seed_legacy_audio(&conn, "fts1", "分布式系统讲座", "一致性与共识", "completed");

        super::migrate_media_items_from_web_clips(&conn).expect("migrate");

        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM media_items_fts WHERE media_items_fts MATCH '一致性'"
            ),
            1,
            "migrated row must be searchable via FTS"
        );
    }
}
