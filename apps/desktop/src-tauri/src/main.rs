#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde::Serialize;

fn open_db() -> Result<Connection, String> {
    let conn = Connection::open("notes.db").map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

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
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
fn add_note(title: String, content: String) -> Result<i64, String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO notes (title, content) VALUES (?1, ?2)",
        params![title, content],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}









#[derive(Serialize)]
struct Hit {
    id: i64,
    title: String,
    snippet: String,
}

fn has_cjk(s: &str) -> bool {
    s.chars().any(|c|
        ('\u{4E00}'..='\u{9FFF}').contains(&c)  // CJK Unified
        || ('\u{3400}'..='\u{4DBF}').contains(&c) // Ext-A
        || ('\u{20000}'..='\u{2A6DF}').contains(&c) // Ext-B
        || ('\u{2A700}'..='\u{2B73F}').contains(&c) // Ext-C
        || ('\u{2B740}'..='\u{2B81F}').contains(&c) // Ext-D
        || ('\u{2B820}'..='\u{2CEAF}').contains(&c) // Ext-E
        || ('\u{F900}'..='\u{FAFF}').contains(&c) // CJK Compatibility Ideographs
    )
}

/// 生成一个非常简单的 snippet：命中位置左右各取一些字节（UTF-8 安全：基于 char 处理）
fn make_snippet(text: &str, needle: &str, context: usize) -> String {
    if let Some(pos) = text.find(needle) {
        let start = text[..pos].chars().rev().take(context).collect::<Vec<_>>();
        let end = text[pos + needle.len()..].chars().take(context).collect::<Vec<_>>();
        let mut left = start.into_iter().rev().collect::<String>();
        let mid = format!("[mark]{}[/mark]", needle);
        let mut right = end.into_iter().collect::<String>();
        // 省略号
        if left.chars().count() == context { left = format!("…{}", left); }
        if right.chars().count() == context { right = format!("{}…", right); }
        format!("{left}{mid}{right}")
    } else {
        // 找不到就截取开头
        text.chars().take(context * 2).collect::<String>()
    }
}

#[tauri::command]
fn search_notes(query: String) -> Result<Vec<Hit>, String> {
    let conn = open_db()?;

    if has_cjk(&query) {
        // 中文：LIKE 回退（标题/正文都搜）
        let like = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT id, title, content
               FROM notes
              WHERE title LIKE ?1 OR content LIKE ?1
              ORDER BY datetime(created_at) DESC
              LIMIT 50",
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([like], |row| {
            let id: i64 = row.get(0)?;
            let title: String = row.get(1)?;
            let content: String = row.get(2)?;
            let snippet = make_snippet(&content, &query, 24);
            Ok(Hit { id, title, snippet })
        }).map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(|e| e.to_string())?); }
        Ok(out)
    } else {
        // 英文/带空格：继续用 FTS5（bm25 + snippet）
        let mut stmt = conn.prepare(
            "SELECT n.id, n.title,
                    snippet(notes_fts, 'content', '[mark]', '[/mark]', ' … ', 12) AS snip
               FROM notes_fts
               JOIN notes n ON n.id = notes_fts.rowid
              WHERE notes_fts MATCH ?1
              ORDER BY bm25(notes_fts) ASC
              LIMIT 50",
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([query], |row| {
            Ok(Hit { id: row.get(0)?, title: row.get(1)?, snippet: row.get(2)? })
        }).map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(|e| e.to_string())?); }
        Ok(out)
    }
}









#[derive(Serialize)]
struct Note { id: i64, title: String, content: String, created_at: String }

/// 分页列表：page 从 1 开始，page_size 默认 10
#[tauri::command]
fn list_notes(page: Option<u32>, page_size: Option<u32>) -> Result<Vec<Note>, String> {
    let page = page.unwrap_or(1).max(1);
    let size = page_size.unwrap_or(10).clamp(1, 100);
    let offset = (page - 1) as i64 * size as i64;

    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, title, content, created_at
           FROM notes
          ORDER BY datetime(created_at) DESC
          LIMIT ?1 OFFSET ?2",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![size as i64, offset], |row| {
        Ok(Note {
            id: row.get(0)?, title: row.get(1)?, content: row.get(2)?, created_at: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
fn update_note(id: i64, title: String, content: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE notes SET title=?1, content=?2 WHERE id=?3",
        params![title, content, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_note(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM notes WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            add_note, search_notes, list_notes, update_note, delete_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
