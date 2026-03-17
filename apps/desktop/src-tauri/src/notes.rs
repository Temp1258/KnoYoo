use rusqlite::{params, Connection};
use std::fs::File;
use std::io::{BufRead, BufReader, Write};

use crate::db::{app_data_dir, open_db};
use crate::models::{DateCount, ExportResult, Hit, InNote, Note};

#[tauri::command]
pub fn add_note(title: String, content: String) -> Result<i64, String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO notes (title, content) VALUES (?1, ?2)",
        params![title, content],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    tx.commit().map_err(|e| e.to_string())?;
    tracing::info!("Note added: id={}", id);
    Ok(id)
}

fn has_cjk(s: &str) -> bool {
    s.chars().any(
        |c| {
            ('\u{4E00}'..='\u{9FFF}').contains(&c)
        || ('\u{3400}'..='\u{4DBF}').contains(&c)
        || ('\u{20000}'..='\u{2A6DF}').contains(&c)
        || ('\u{2A700}'..='\u{2B73F}').contains(&c)
        || ('\u{2B740}'..='\u{2B81F}').contains(&c)
        || ('\u{2B820}'..='\u{2CEAF}').contains(&c)
        || ('\u{F900}'..='\u{FAFF}').contains(&c)
        },
    )
}

fn has_digit_or_symbol(s: &str) -> bool {
    s.chars()
        .any(|c| c.is_ascii_digit() || (!c.is_alphabetic() && !c.is_whitespace()))
}

/// 简单 snippet：基于 char，不会切乱码
fn make_snippet(text: &str, needle: &str, context: usize) -> String {
    if let Some(pos) = text.find(needle) {
        let start = text[..pos].chars().rev().take(context).collect::<Vec<_>>();
        let end = text[pos + needle.len()..]
            .chars()
            .take(context)
            .collect::<Vec<_>>();
        let mut left = start.into_iter().rev().collect::<String>();
        let mid = format!("[mark]{}[/mark]", needle);
        let mut right = end.into_iter().collect::<String>();
        if left.chars().count() == context {
            left = format!("\u{2026}{}", left);
        }
        if right.chars().count() == context {
            right = format!("{}\u{2026}", right);
        }
        format!("{left}{mid}{right}")
    } else {
        text.chars().take(context * 2).collect::<String>()
    }
}

#[tauri::command]
pub fn search_notes(query: String) -> Result<Vec<Hit>, String> {
    let conn = open_db()?;

    let need_like_primary =
        has_cjk(&query) || has_digit_or_symbol(&query) || query.chars().count() <= 2;

    fn is_ascii_alnum_word(s: &str) -> bool {
        !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric())
    }

    let like_search = |conn: &Connection, q: &str| -> Result<Vec<Hit>, String> {
        let like = format!("%{}%", q);
        let mut stmt = conn
            .prepare(
                "SELECT id, title, content
               FROM notes
              WHERE title LIKE ?1 OR content LIKE ?1
              ORDER BY datetime(created_at) DESC
              LIMIT 50",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([like], |row| {
                let id: i64 = row.get(0)?;
                let title: String = row.get(1)?;
                let content: String = row.get(2)?;
                let snippet = make_snippet(&content, q, 24);
                Ok(Hit { id, title, snippet })
            })
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    };

    if need_like_primary {
        return like_search(&conn, &query);
    }

    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.title,
                    COALESCE(NULLIF(snippet(notes_fts, 1, '[mark]', '[/mark]', ' \u{2026} ', 12), ''),
                             snippet(notes_fts, 0, '[mark]', '[/mark]', ' \u{2026} ', 12)) AS snip
               FROM notes_fts
               JOIN notes n ON n.id = notes_fts.rowid
              WHERE notes_fts MATCH ?1
              ORDER BY bm25(notes_fts) ASC
              LIMIT 50",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&query], |row| {
            Ok(Hit {
                id: row.get(0)?,
                title: row.get(1)?,
                snippet: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }

    if out.is_empty() && is_ascii_alnum_word(&query) {
        return like_search(&conn, &query);
    }

    Ok(out)
}

/// 分页列表：page 从 1 开始，page_size 默认 10
#[tauri::command]
pub fn list_notes(page: Option<u32>, page_size: Option<u32>) -> Result<Vec<Note>, String> {
    let page = page.unwrap_or(1).max(1);
    let size = page_size.unwrap_or(crate::models::DEFAULT_PAGE_SIZE).clamp(1, crate::models::MAX_PAGE_SIZE);
    let offset = (page - 1) as i64 * size as i64;

    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, created_at, COALESCE(is_favorite, 0)
           FROM notes
          ORDER BY datetime(created_at) DESC
          LIMIT ?1 OFFSET ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![size as i64, offset], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                is_favorite: row.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn update_note(id: i64, title: String, content: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE notes SET title=?1, content=?2 WHERE id=?3",
        params![title, content, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_note(id: i64) -> Result<(), String> {
    tracing::info!("Note deleted: id={}", id);
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM note_skill_map WHERE note_id=?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM notes WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 导出为 JSONL（每行一条）到 %APPDATA%\KnoYoo\Desktop\data\notes-export.jsonl
#[tauri::command]
pub fn export_notes_jsonl() -> Result<ExportResult, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT id, title, content, created_at FROM notes ORDER BY id ASC")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    let out_path = app_data_dir()?.join("notes-export.jsonl");
    let mut file = File::create(&out_path).map_err(|e| e.to_string())?;
    let mut count = 0u32;

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let title: String = row.get(1).map_err(|e| e.to_string())?;
        let content: String = row.get(2).map_err(|e| e.to_string())?;
        let created_at: String = row.get(3).map_err(|e| e.to_string())?;

        let obj = serde_json::json!({
            "id": id, "title": title, "content": content, "created_at": created_at
        });
        writeln!(file, "{}", obj).map_err(|e| e.to_string())?;
        count += 1;
    }

    Ok(ExportResult {
        path: out_path.display().to_string(),
        count,
    })
}

#[tauri::command]
pub fn import_notes_jsonl() -> Result<(u32, u32), String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let in_path = app_data_dir()?.join("notes-export.jsonl");

    let file = File::open(&in_path).map_err(|e| format!("open {}: {}", in_path.display(), e))?;
    let reader = BufReader::new(file);
    let mut inserted = 0u32;
    let mut ignored = 0u32;

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }

        let v: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        let (title, content, created_at) = if v.get("title").is_some() && v.get("content").is_some()
        {
            let t = v["title"].as_str().unwrap_or_default().to_string();
            let c = v["content"].as_str().unwrap_or_default().to_string();
            let ca = v
                .get("created_at")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            (t, c, ca)
        } else {
            let n: InNote = serde_json::from_value(v).map_err(|e| e.to_string())?;
            (n.title, n.content, n.created_at.unwrap_or_default())
        };

        if created_at.is_empty() {
            tx.execute(
                "INSERT OR IGNORE INTO notes (title, content) VALUES (?1, ?2)",
                params![title, content],
            )
            .map_err(|e| e.to_string())?;
        } else {
            tx.execute(
                "INSERT OR IGNORE INTO notes (title, content, created_at) VALUES (?1, ?2, ?3)",
                params![title, content, created_at],
            )
            .map_err(|e| e.to_string())?;
        }

        let changed = tx.changes();
        if changed > 0 {
            inserted += 1;
        } else {
            ignored += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok((inserted, ignored))
}

#[tauri::command]
pub fn count_notes() -> Result<i64, String> {
    let conn = open_db()?;
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .unwrap_or(0);
    Ok(n)
}

/// 统计最近指定天数内每天的笔记新增数量。
#[tauri::command]
pub fn list_note_contributions(days: u32) -> Result<Vec<DateCount>, String> {
    use rusqlite::params;
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c \
             FROM notes \
             WHERE date(created_at) >= date('now', '-' || ?1 || ' day') \
             GROUP BY d \
             ORDER BY d ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![days], |row| {
            Ok(DateCount {
                date: row.get::<_, String>(0)?,
                count: row.get::<_, i64>(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut res = Vec::new();
    for r in rows {
        res.push(r.map_err(|e| e.to_string())?);
    }
    Ok(res)
}

#[tauri::command]
pub fn toggle_note_favorite(id: i64) -> Result<bool, String> {
    let conn = open_db()?;
    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(is_favorite, 0) FROM notes WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let next = if current == 0 { 1 } else { 0 };
    conn.execute(
        "UPDATE notes SET is_favorite=?1 WHERE id=?2",
        params![next, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(next == 1)
}

#[tauri::command]
pub fn list_favorite_notes() -> Result<Vec<Note>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, created_at, 1 FROM notes WHERE is_favorite=1 ORDER BY datetime(created_at) DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                is_favorite: true,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- has_cjk ---

    #[test]
    fn has_cjk_true_for_chinese() {
        assert!(has_cjk("hello\u{4e16}\u{754c}"));
    }

    #[test]
    fn has_cjk_true_for_pure_chinese() {
        assert!(has_cjk("\u{4f60}\u{597d}"));
    }

    #[test]
    fn has_cjk_false_for_ascii() {
        assert!(!has_cjk("hello world"));
    }

    #[test]
    fn has_cjk_false_for_empty() {
        assert!(!has_cjk(""));
    }

    // --- has_digit_or_symbol ---

    #[test]
    fn has_digit_or_symbol_true_for_digit() {
        assert!(has_digit_or_symbol("abc3"));
    }

    #[test]
    fn has_digit_or_symbol_true_for_symbol() {
        assert!(has_digit_or_symbol("hello!"));
    }

    #[test]
    fn has_digit_or_symbol_false_for_alpha_only() {
        assert!(!has_digit_or_symbol("hello"));
    }

    #[test]
    fn has_digit_or_symbol_false_for_alpha_with_space() {
        assert!(!has_digit_or_symbol("hello world"));
    }

    // --- make_snippet ---

    #[test]
    fn make_snippet_highlights_needle() {
        let result = make_snippet("the quick brown fox jumps", "brown", 5);
        assert!(result.contains("[mark]brown[/mark]"));
    }

    #[test]
    fn make_snippet_includes_context() {
        let result = make_snippet("the quick brown fox jumps", "brown", 10);
        // With context=10 we get enough chars to include "quick" and "fox"
        assert!(result.contains("quick"));
        assert!(result.contains("fox"));
    }

    #[test]
    fn make_snippet_ellipsis_when_truncated() {
        let result = make_snippet("abcdefghij-NEEDLE-klmnopqrst", "NEEDLE", 3);
        // Left context is 3 chars "ij-" from a longer prefix -> ellipsis prepended
        assert!(result.starts_with('\u{2026}'));
        // Right context is 3 chars "-kl" from a longer suffix -> ellipsis appended
        assert!(result.ends_with('\u{2026}'));
    }

    #[test]
    fn make_snippet_no_match_returns_prefix() {
        // When needle not found, returns first context*2 chars
        let result = make_snippet("hello world", "xyz", 5);
        assert_eq!(result, "hello worl");
    }

    // --- is_ascii_alnum_word (re-implemented for testing since it's a local fn) ---

    fn is_ascii_alnum_word(s: &str) -> bool {
        !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric())
    }

    #[test]
    fn is_ascii_alnum_word_true_for_alnum() {
        assert!(is_ascii_alnum_word("hello123"));
    }

    #[test]
    fn is_ascii_alnum_word_false_for_empty() {
        assert!(!is_ascii_alnum_word(""));
    }

    #[test]
    fn is_ascii_alnum_word_false_for_spaces() {
        assert!(!is_ascii_alnum_word("hello world"));
    }

    #[test]
    fn is_ascii_alnum_word_false_for_symbols() {
        assert!(!is_ascii_alnum_word("hello!"));
    }
}
