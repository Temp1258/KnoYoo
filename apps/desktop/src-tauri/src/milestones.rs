//! Milestone engine — pillar 3 of the product blueprint ("知识生长可视化").
//!
//! Evaluates four kinds of achievements off the current database snapshot
//! and records a row per threshold crossed. A UNIQUE(kind, value, `meta_json`)
//! index + INSERT OR IGNORE means each milestone fires exactly once, even
//! under concurrent writes from the AI background pool.
//!
//! Evaluation runs in a detached background thread so it never blocks the
//! clip/book insert path (`add_web_clip`, `add_book`, `update_book`).
//!
//! Anti-flood: on first run (`milestones_backfilled` `app_kv` flag), every
//! already-met threshold is inserted with `acknowledged = 1`. Otherwise a
//! user upgrading with 1200 clips would get blasted with 100/500/1000 cards
//! all at once.

use serde::{Deserialize, Serialize};

use crate::db::{kv_get, open_db, set_kv};

/// Fibonacci-style thresholds starting at 1 so the very first clip / book /
/// day of activity already earns a ceremony — critical for the pillar-3
/// "积累被看见" feedback loop on day one. Intervals widen naturally so heavy
/// users keep getting a tail of recognition without inflation.
const CLIP_COUNT_THRESHOLDS: &[i64] = &[
    1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10_946,
];

/// Consecutive-day streaks. A 1-day "first day of using `KnoYoo`" note feels
/// like the right companion to the first-clip ceremony.
const CONSECUTIVE_DAY_THRESHOLDS: &[i64] =
    &[1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377];

/// Single-tag depth. Starts at 3 — lower would fire a "focus area" ceremony
/// on every fresh tag, which is noise. By 3 clips under one tag the user
/// has implicitly signalled interest.
const TAG_DEPTH_THRESHOLDS: &[i64] = &[3, 5, 8, 13, 21, 34, 55, 89, 144, 233];

/// Books finished (status = 'read'). Starts at 1 because finishing the first
/// book is a genuine milestone worth marking.
const BOOKS_READ_THRESHOLDS: &[i64] = &[1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];

/// Kind of milestone. Kept as a string on the wire so adding new kinds is
/// additive — no enum migration needed.
pub const KIND_CLIP_COUNT: &str = "clip_count";
pub const KIND_CONSECUTIVE_DAYS: &str = "consecutive_days";
pub const KIND_TAG_DEPTH: &str = "tag_depth";
pub const KIND_BOOKS_READ: &str = "books_read";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Milestone {
    pub id: i64,
    pub kind: String,
    pub value: i64,
    /// Structured JSON payload. For `tag_depth` carries `{"tag": "rust"}`.
    /// Others use `{}`. Always valid JSON so the UI can parse blindly.
    pub meta_json: String,
    pub achieved_at: String,
    pub acknowledged: bool,
}

fn row_to_milestone(row: &rusqlite::Row) -> rusqlite::Result<Milestone> {
    Ok(Milestone {
        id: row.get("id")?,
        kind: row.get("kind")?,
        value: row.get("value")?,
        meta_json: row.get("meta_json")?,
        achieved_at: row.get("achieved_at")?,
        acknowledged: row.get::<_, i64>("acknowledged")? != 0,
    })
}

/// Insert a milestone if it hasn't already been recorded for this
/// (kind, value, `meta_json`) triple. Returns true when a new row was written.
fn record(
    conn: &rusqlite::Connection,
    kind: &str,
    value: i64,
    meta_json: &str,
    pre_acknowledged: bool,
) -> Result<bool, String> {
    let ack = i64::from(pre_acknowledged);
    let changes = conn
        .execute(
            "INSERT OR IGNORE INTO milestones(kind, value, meta_json, acknowledged)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![kind, value, meta_json, ack],
        )
        .map_err(|e| e.to_string())?;
    Ok(changes > 0)
}

fn clip_count_total(conn: &rusqlite::Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM web_clips WHERE deleted_at IS NULL",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

fn books_read_total(conn: &rusqlite::Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM books WHERE deleted_at IS NULL AND status = 'read'",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Current consecutive-day streak ending at today or yesterday. Uses a
/// window-function SQL query to group contiguous dates (`jd - row_num` is
/// constant within a run) and picks the longest run whose tail reaches the
/// 1-day grace window. Cost: O(days-in-last-year), one round trip.
fn consecutive_days(conn: &rusqlite::Connection) -> Result<i64, String> {
    conn.query_row(
        "WITH days AS (
             SELECT DISTINCT julianday(date(created_at)) AS jd
             FROM web_clips
             WHERE deleted_at IS NULL
               AND date(created_at) >= date('now', '-365 days')
         ),
         ranked AS (
             SELECT jd, ROW_NUMBER() OVER (ORDER BY jd) AS rn FROM days
         ),
         grouped AS (
             SELECT jd, (jd - rn) AS grp FROM ranked
         ),
         runs AS (
             SELECT grp, COUNT(*) AS len, MAX(jd) AS last_day
             FROM grouped
             GROUP BY grp
         )
         SELECT COALESCE(MAX(len), 0) FROM runs
         WHERE last_day >= julianday(date('now', '-1 day'))",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// (tag, count) for every tag currently attached to a non-deleted clip.
/// Uses the same `json_each` expansion as `clips::get_weekly_stats`.
fn tag_counts(conn: &rusqlite::Connection) -> Result<Vec<(String, i64)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT je.value AS tag, COUNT(*) AS c
             FROM web_clips w, json_each(w.tags) je
             WHERE w.deleted_at IS NULL
             GROUP BY tag",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, i64)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Evaluate every rule against the current snapshot. `pre_acknowledged`
/// marks newly-inserted rows as already-acknowledged, used by the first-run
/// backfill so upgrading users don't see retroactive notifications.
fn evaluate_all(
    conn: &rusqlite::Connection,
    pre_acknowledged: bool,
) -> Result<(), String> {
    let clips = clip_count_total(conn)?;
    for &threshold in CLIP_COUNT_THRESHOLDS {
        if clips >= threshold
            && record(conn, KIND_CLIP_COUNT, threshold, "{}", pre_acknowledged)?
        {
            tracing::info!("milestone: clip_count {threshold}");
        }
    }

    let days = consecutive_days(conn)?;
    for &threshold in CONSECUTIVE_DAY_THRESHOLDS {
        if days >= threshold
            && record(
                conn,
                KIND_CONSECUTIVE_DAYS,
                threshold,
                "{}",
                pre_acknowledged,
            )?
        {
            tracing::info!("milestone: consecutive_days {threshold}");
        }
    }

    for (tag, count) in tag_counts(conn)? {
        if tag.trim().is_empty() {
            continue;
        }
        // JSON-encode so the stored payload is always valid JSON regardless
        // of what punctuation the tag contains.
        let meta = serde_json::to_string(&serde_json::json!({ "tag": tag }))
            .unwrap_or_else(|_| "{}".to_string());
        for &threshold in TAG_DEPTH_THRESHOLDS {
            if count >= threshold
                && record(conn, KIND_TAG_DEPTH, threshold, &meta, pre_acknowledged)?
            {
                tracing::info!("milestone: tag_depth {tag} ≥ {threshold}");
            }
        }
    }

    let read = books_read_total(conn)?;
    for &threshold in BOOKS_READ_THRESHOLDS {
        if read >= threshold
            && record(conn, KIND_BOOKS_READ, threshold, "{}", pre_acknowledged)?
        {
            tracing::info!("milestone: books_read {threshold}");
        }
    }

    Ok(())
}

/// Trigger evaluation in a detached thread. Called from every clip/book
/// write path. Never blocks, never returns errors to the caller — a failed
/// evaluation is logged and the user's write completes normally.
pub fn evaluate_async() {
    std::thread::spawn(|| match open_db() {
        Ok(conn) => {
            if let Err(e) = evaluate_all(&conn, false) {
                tracing::warn!("milestone evaluation failed: {e}");
            }
        }
        Err(e) => tracing::warn!("milestone evaluation could not open db: {e}"),
    });
}

/// First-run backfill. Idempotent — uses the `milestones_backfilled` `app_kv`
/// flag so a subsequent startup doesn't rewrite acknowledged rows.
pub fn first_run_backfill() -> Result<(), String> {
    let conn = open_db()?;
    if kv_get(&conn, "milestones_backfilled")?.as_deref() == Some("1") {
        return Ok(());
    }
    evaluate_all(&conn, true)?;
    set_kv(&conn, "milestones_backfilled", "1")?;
    tracing::info!("milestones backfilled and marked acknowledged");
    Ok(())
}

// ── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
#[allow(non_snake_case)]
pub fn list_milestones(unacknowledgedOnly: Option<bool>) -> Result<Vec<Milestone>, String> {
    let conn = open_db()?;
    let sql = if unacknowledgedOnly.unwrap_or(false) {
        "SELECT * FROM milestones WHERE acknowledged = 0 ORDER BY achieved_at DESC"
    } else {
        "SELECT * FROM milestones ORDER BY achieved_at DESC"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_milestone)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn acknowledge_milestone(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE milestones SET acknowledged = 1 WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn acknowledge_all_milestones() -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE milestones SET acknowledged = 1 WHERE acknowledged = 0",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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

            CREATE TABLE IF NOT EXISTS web_clips (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              url TEXT NOT NULL,
              tags TEXT NOT NULL DEFAULT '[]',
              created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS books (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              status TEXT NOT NULL DEFAULT 'want',
              deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS milestones (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              kind         TEXT NOT NULL,
              value        INTEGER NOT NULL,
              meta_json    TEXT NOT NULL DEFAULT '{}',
              achieved_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              acknowledged INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX idx_milestones_kind_value_meta
              ON milestones(kind, value, meta_json);
            ",
        )
        .expect("init schema");
        conn
    }

    fn insert_clips(conn: &Connection, n: usize, tags: &str) {
        for i in 0..n {
            conn.execute(
                "INSERT INTO web_clips(url, tags) VALUES (?1, ?2)",
                rusqlite::params![format!("https://x.test/{i}"), tags],
            )
            .unwrap();
        }
    }

    /// Count how many thresholds `count` satisfies, for use as test expectations.
    /// Mirrors the `evaluate_all` logic so tests track the constant lists exactly.
    fn thresholds_hit(thresholds: &[i64], count: i64) -> i64 {
        i64::try_from(thresholds.iter().filter(|&&t| count >= t).count())
            .expect("threshold count always fits in i64")
    }

    #[test]
    fn clip_count_milestones_fire_at_thresholds() {
        let conn = test_db();
        insert_clips(&conn, 5, "[]");
        evaluate_all(&conn, false).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM milestones WHERE kind = 'clip_count'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // Ladder starts at 1: 5 clips satisfies [1, 2, 3, 5] → 4 milestones.
        assert_eq!(count, thresholds_hit(CLIP_COUNT_THRESHOLDS, 5));
        assert_eq!(count, 4);
    }

    #[test]
    fn threshold_fires_only_once_under_repeated_evaluation() {
        let conn = test_db();
        insert_clips(&conn, 5, "[]");
        evaluate_all(&conn, false).unwrap();
        evaluate_all(&conn, false).unwrap();
        evaluate_all(&conn, false).unwrap();
        // Scope to clip_count only: the test fixture's 5 clips inserted today
        // also trigger a consecutive_days milestone (1-day streak), which is
        // correct behaviour but orthogonal to this test's "no duplicates"
        // invariant.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM milestones WHERE kind = 'clip_count'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, thresholds_hit(CLIP_COUNT_THRESHOLDS, 5));
    }

    #[test]
    fn higher_threshold_fires_additionally() {
        let conn = test_db();
        insert_clips(&conn, 13, "[]");
        evaluate_all(&conn, false).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM milestones WHERE kind = 'clip_count'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // 13 hits [1, 2, 3, 5, 8, 13] → 6 milestones.
        assert_eq!(count, thresholds_hit(CLIP_COUNT_THRESHOLDS, 13));
        assert_eq!(count, 6);
    }

    #[test]
    fn soft_deleted_clips_dont_count() {
        let conn = test_db();
        insert_clips(&conn, 10, "[]");
        // Soft-delete ALL clips so no threshold (including the 1-clip floor) fires.
        conn.execute(
            "UPDATE web_clips SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            [],
        )
        .unwrap();
        evaluate_all(&conn, false).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM milestones WHERE kind = 'clip_count'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "0 active clips must not fire any threshold");
    }

    #[test]
    fn tag_depth_uses_per_tag_counts() {
        let conn = test_db();
        // rust tagged 13× → hits [3, 5, 8, 13].
        insert_clips(&conn, 13, r#"["rust","cli"]"#);
        // python tagged 2× → below tag_depth floor (3).
        insert_clips(&conn, 2, r#"["python"]"#);
        evaluate_all(&conn, false).unwrap();
        let rust: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM milestones WHERE kind = 'tag_depth'
                 AND meta_json LIKE '%rust%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rust, thresholds_hit(TAG_DEPTH_THRESHOLDS, 13));
        assert_eq!(rust, 4);
        let python: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM milestones WHERE kind = 'tag_depth'
                 AND meta_json LIKE '%python%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(python, 0, "python (2 clips) below tag_depth floor of 3");
    }

    #[test]
    fn books_read_fires_when_status_read() {
        let conn = test_db();
        // 5 read + 3 want → 5 read hits [1, 2, 3, 5] = 4 milestones.
        for _ in 0..5 {
            conn.execute("INSERT INTO books(status) VALUES ('read')", [])
                .unwrap();
        }
        for _ in 0..3 {
            conn.execute("INSERT INTO books(status) VALUES ('want')", [])
                .unwrap();
        }
        evaluate_all(&conn, false).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM milestones WHERE kind = 'books_read'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, thresholds_hit(BOOKS_READ_THRESHOLDS, 5));
        assert_eq!(count, 4);
    }

    #[test]
    fn pre_acknowledged_flag_is_respected() {
        let conn = test_db();
        insert_clips(&conn, 100, "[]");
        evaluate_all(&conn, true).unwrap();
        let ack: i64 = conn
            .query_row(
                "SELECT acknowledged FROM milestones WHERE kind = 'clip_count'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ack, 1, "backfill must mark existing milestones acknowledged");
    }

    #[test]
    fn consecutive_days_counts_current_streak_only() {
        let conn = test_db();
        // Insert one clip per day for the last 7 days
        for i in 0..7 {
            conn.execute(
                "INSERT INTO web_clips(url, created_at)
                 VALUES (?1, datetime('now', ?2))",
                rusqlite::params![format!("https://x.test/{i}"), format!("-{i} days")],
            )
            .unwrap();
        }
        let streak = consecutive_days(&conn).unwrap();
        assert_eq!(streak, 7);
    }

    #[test]
    fn consecutive_days_zero_when_last_activity_old() {
        let conn = test_db();
        conn.execute(
            "INSERT INTO web_clips(url, created_at)
             VALUES ('https://x.test/old', datetime('now', '-10 days'))",
            [],
        )
        .unwrap();
        let streak = consecutive_days(&conn).unwrap();
        assert_eq!(streak, 0, "activity >1 day ago shouldn't count");
    }
}
