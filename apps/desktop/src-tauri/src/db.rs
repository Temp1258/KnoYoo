use directories::ProjectDirs;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Tracks whether migrations have been run for the current process.
static MIGRATIONS_DONE: OnceLock<bool> = OnceLock::new();

/// 获取应用数据目录的路径（不同操作系统位置各异）
/// 如果目录不存在则会自动创建。
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

/// 打开 SQLite 数据库并执行必要的初始化。
/// Schema creation runs every time (IF NOT EXISTS is idempotent).
/// Migrations only run once per process lifetime (tracked by OnceLock).
pub fn open_db() -> Result<Connection, String> {
    let db_path = app_db_path()?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
    PRAGMA foreign_keys = ON;

    -- 笔记主表 + FTS5 + 触发器
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
      USING fts5(title, content, content='notes', content_rowid='id');

    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, content)
        VALUES (new.id, new.title, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content)
        VALUES('delete', old.id, old.title, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content)
        VALUES('delete', old.id, old.title, old.content);
      INSERT INTO notes_fts(rowid, title, content)
        VALUES (new.id, new.title, new.content);
    END;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_dedupe
      ON notes(title, content, created_at);

    -- === Sprint4 计划引擎最小数据面（唯一保留版本） ===
    CREATE TABLE IF NOT EXISTS industry_skill (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES industry_skill(id) ON DELETE SET NULL,
      name TEXT NOT NULL UNIQUE,
      required_level INTEGER NOT NULL DEFAULT 3, -- L1~L5 -> 1~5
      importance INTEGER NOT NULL DEFAULT 3      -- 1~5
    );

    CREATE TABLE IF NOT EXISTS plan_task (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      horizon TEXT NOT NULL CHECK (horizon IN ('WEEK','QTR')),
      skill_id INTEGER REFERENCES industry_skill(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      minutes INTEGER,                            -- 周任务才用；季度里程碑可为 NULL
      due TEXT,                                   -- ISO8601，可为空
      status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO','DONE'))
    );

    -- 笔记与技能映射（保留）
    CREATE TABLE IF NOT EXISTS note_skill_map (
      note_id INTEGER NOT NULL,
      skill_id INTEGER NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(note_id, skill_id),
      FOREIGN KEY(note_id) REFERENCES notes(id),
      FOREIGN KEY(skill_id) REFERENCES industry_skill(id)
    );

    -- 约束与索引
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_open_unique
      ON plan_task(horizon, skill_id)
      WHERE status <> 'DONE';
    CREATE INDEX IF NOT EXISTS idx_plan_hsd ON plan_task(horizon, status, due);
    CREATE INDEX IF NOT EXISTS idx_note_skill_note ON note_skill_map(note_id);
    CREATE INDEX IF NOT EXISTS idx_note_skill_skill ON note_skill_map(skill_id);

    -- ==== 行业树快照表 ===
    CREATE TABLE IF NOT EXISTS saved_industry_tree (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      data TEXT NOT NULL
    );

    -- 计划分组
    CREATE TABLE IF NOT EXISTS plan_group (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    -- 应用配置（AI 等）
    CREATE TABLE IF NOT EXISTS app_kv (
      key TEXT PRIMARY KEY,
      val TEXT NOT NULL
    );

    -- 网页收藏库
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

    // Run migrations only once per process lifetime
    MIGRATIONS_DONE.get_or_init(|| {
        tracing::info!("Running database migrations (first connection)...");
        if let Err(e) = migrate_dedupe_notes(&conn) {
            tracing::error!("migrate_dedupe_notes failed: {e}");
        }
        if let Err(e) = migrate_plan_minutes_nullable(&conn) {
            tracing::error!("migrate_plan_minutes_nullable failed: {e}");
        }
        if let Err(e) = migrate_plan_task_hierarchy(&conn) {
            tracing::error!("migrate_plan_task_hierarchy failed: {e}");
        }
        if let Err(e) = migrate_notes_favorite(&conn) {
            tracing::error!("migrate_notes_favorite failed: {e}");
        }
        if let Err(e) = migrate_activity_log(&conn) {
            tracing::error!("migrate_activity_log failed: {e}");
        }
        true
    });

    Ok(conn)
}

/// One-time migration: remove historical duplicate notes (before unique index was added).
fn migrate_dedupe_notes(conn: &rusqlite::Connection) -> Result<(), String> {
    let dupes: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE id NOT IN (
                SELECT MIN(id) FROM notes GROUP BY title, content, created_at
            )",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if dupes > 0 {
        conn.execute_batch(
            "DELETE FROM notes WHERE id NOT IN (
                SELECT MIN(id) FROM notes GROUP BY title, content, created_at
            );",
        )
        .map_err(|e| e.to_string())?;
        tracing::info!("Deduplicated {} duplicate notes", dupes);
    }
    Ok(())
}

/// 数据库迁移：将 plan_task.minutes 字段改为可为空。
/// 检查表结构，如果 minutes 已经可空则跳过；否则重建表并迁移数据。
fn migrate_plan_minutes_nullable(conn: &rusqlite::Connection) -> Result<(), String> {
    let mut notnull = false;
    {
        let mut stmt = conn
            .prepare("PRAGMA table_info(plan_task)")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, i64>(3)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (name, nn) = row.map_err(|e| e.to_string())?;
            if name == "minutes" && nn != 0 {
                notnull = true;
                break;
            }
        }
    }

    if !notnull {
        return Ok(());
    }

    conn.execute_batch(
        r#"
    BEGIN;
      CREATE TABLE IF NOT EXISTS _plan_task_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        horizon TEXT NOT NULL CHECK (horizon IN ('WEEK','QTR')),
        skill_id INTEGER REFERENCES industry_skill(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        minutes INTEGER,              -- 允许为 NULL（里程碑/总目标）
        due TEXT,
        status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO','DONE'))
      );
      INSERT INTO _plan_task_new(id,horizon,skill_id,title,minutes,due,status)
        SELECT id,horizon,skill_id,title,minutes,due,status FROM plan_task;
      DROP TABLE plan_task;
      ALTER TABLE _plan_task_new RENAME TO plan_task;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_open_unique
        ON plan_task(horizon, skill_id)
        WHERE status <> 'DONE';
      CREATE INDEX IF NOT EXISTS idx_plan_hsd ON plan_task(horizon, status, due);
    COMMIT;
    "#,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 迁移：给 plan_task 添加 group_id, parent_id, sort_order, description 字段
fn migrate_plan_task_hierarchy(conn: &rusqlite::Connection) -> Result<(), String> {
    // Check if group_id column already exists
    let mut has_group_id = false;
    {
        let mut stmt = conn
            .prepare("PRAGMA table_info(plan_task)")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let name = row.map_err(|e| e.to_string())?;
            if name == "group_id" {
                has_group_id = true;
                break;
            }
        }
    }
    if has_group_id {
        return Ok(());
    }
    conn.execute_batch(
        r#"
        ALTER TABLE plan_task ADD COLUMN group_id INTEGER REFERENCES plan_group(id) ON DELETE SET NULL;
        ALTER TABLE plan_task ADD COLUMN parent_id INTEGER REFERENCES plan_task(id) ON DELETE CASCADE;
        ALTER TABLE plan_task ADD COLUMN sort_order INTEGER DEFAULT 0;
        ALTER TABLE plan_task ADD COLUMN description TEXT;
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 迁移：给 notes 添加 is_favorite 字段
fn migrate_notes_favorite(conn: &rusqlite::Connection) -> Result<(), String> {
    let mut has_col = false;
    {
        let mut stmt = conn
            .prepare("PRAGMA table_info(notes)")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let name = row.map_err(|e| e.to_string())?;
            if name == "is_favorite" {
                has_col = true;
                break;
            }
        }
    }
    if has_col {
        return Ok(());
    }
    conn.execute_batch("ALTER TABLE notes ADD COLUMN is_favorite INTEGER DEFAULT 0;")
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 迁移：创建 activity_log 学习打卡表
fn migrate_activity_log(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS activity_log (
            date TEXT PRIMARY KEY
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取 KV
pub fn kv_get(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    conn.query_row("SELECT val FROM app_kv WHERE key=?1", [key], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())
}

/// Read AI configuration from app_kv table
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

/// Collect all descendant node IDs (including the root) using a recursive CTE.
/// This replaces the previous iterative DFS approach that issued N separate queries.
pub fn collect_subtree_ids(conn: &rusqlite::Connection, root_id: i64) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE sub AS (
                SELECT id FROM industry_skill WHERE id = ?1
                UNION ALL
                SELECT s.id FROM industry_skill s JOIN sub ON s.parent_id = sub.id
            )
            SELECT id FROM sub",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![root_id], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;

    let mut all_ids = Vec::new();
    for r in rows {
        all_ids.push(r.map_err(|e| e.to_string())?);
    }
    Ok(all_ids)
}

/// Delete subtree: remove note_skill_map and industry_skill for all given IDs
pub fn delete_subtree_by_ids(
    tx: &rusqlite::Transaction,
    all_ids: &mut Vec<i64>,
) -> Result<(), String> {
    // Delete mappings first
    for sid in all_ids.iter() {
        tx.execute(
            "DELETE FROM note_skill_map WHERE skill_id=?1",
            rusqlite::params![sid],
        )
        .map_err(|e| e.to_string())?;
    }
    // Delete skills from child to parent
    all_ids.sort_unstable();
    all_ids.reverse();
    for sid in all_ids.iter() {
        tx.execute(
            "DELETE FROM industry_skill WHERE id=?1",
            rusqlite::params![sid],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Run database integrity check on startup
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

    /// Create an in-memory database with the same schema used by open_db().
    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS notes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_dedupe
              ON notes(title, content, created_at);

            CREATE TABLE IF NOT EXISTS industry_skill (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              parent_id INTEGER REFERENCES industry_skill(id) ON DELETE SET NULL,
              name TEXT NOT NULL UNIQUE,
              required_level INTEGER NOT NULL DEFAULT 3,
              importance INTEGER NOT NULL DEFAULT 3
            );

            CREATE TABLE IF NOT EXISTS note_skill_map (
              note_id INTEGER NOT NULL,
              skill_id INTEGER NOT NULL,
              weight INTEGER NOT NULL DEFAULT 1,
              PRIMARY KEY(note_id, skill_id),
              FOREIGN KEY(note_id) REFERENCES notes(id),
              FOREIGN KEY(skill_id) REFERENCES industry_skill(id)
            );

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

    #[test]
    fn collect_subtree_ids_finds_all_descendants() {
        let conn = test_db();
        // Build a tree: root(1) -> child(2) -> grandchild(3), root(1) -> child(4)
        conn.execute(
            "INSERT INTO industry_skill(id, name, parent_id) VALUES(1, 'Root', NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO industry_skill(id, name, parent_id) VALUES(2, 'Child1', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO industry_skill(id, name, parent_id) VALUES(3, 'Grandchild', 2)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO industry_skill(id, name, parent_id) VALUES(4, 'Child2', 1)",
            [],
        )
        .unwrap();

        let mut ids = super::collect_subtree_ids(&conn, 1).unwrap();
        ids.sort();
        assert_eq!(ids, vec![1, 2, 3, 4]);
    }

    #[test]
    fn collect_subtree_ids_leaf_returns_single() {
        let conn = test_db();
        conn.execute(
            "INSERT INTO industry_skill(id, name, parent_id) VALUES(1, 'Root', NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO industry_skill(id, name, parent_id) VALUES(2, 'Leaf', 1)",
            [],
        )
        .unwrap();

        let ids = super::collect_subtree_ids(&conn, 2).unwrap();
        assert_eq!(ids, vec![2]);
    }

    #[test]
    fn delete_subtree_by_ids_removes_all_related() {
        let conn = test_db();
        // Create skill tree
        conn.execute(
            "INSERT INTO industry_skill(id, name, parent_id) VALUES(1, 'Root', NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO industry_skill(id, name, parent_id) VALUES(2, 'Child', 1)",
            [],
        )
        .unwrap();
        // Add a note and mapping
        conn.execute(
            "INSERT INTO notes(id, title, content) VALUES(1, 'n', 'c')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO note_skill_map(note_id, skill_id, weight) VALUES(1, 2, 1)",
            [],
        )
        .unwrap();

        let mut ids = vec![1, 2];
        {
            let tx = conn.unchecked_transaction().unwrap();
            super::delete_subtree_by_ids(&tx, &mut ids).unwrap();
            tx.commit().unwrap();
        }

        let skill_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM industry_skill", [], |r| r.get(0))
            .unwrap();
        let map_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_skill_map", [], |r| r.get(0))
            .unwrap();

        assert_eq!(skill_count, 0);
        assert_eq!(map_count, 0);
        // The note itself should still exist
        let note_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(note_count, 1);
    }
}
