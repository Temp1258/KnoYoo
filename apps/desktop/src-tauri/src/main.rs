#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde::Serialize;

fn open_db() -> Result<Connection, String> {
    let conn = Connection::open("notes.db").map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        -- 主表：结构化字段
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        -- FTS5 虚表，指向主表（content_rowid/id）
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
          USING fts5(title, content, content='notes', content_rowid='id');

        -- 触发器：保持主表与 FTS5 同步
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

#[tauri::command]
fn search_notes(query: String) -> Result<Vec<Hit>, String> {
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        // snippet(表, 列索引或名称, 开始标记, 结束标记, 省略号, 片段词数)
        "SELECT n.id, n.title,
                snippet(notes_fts, 'content', '[mark]', '[/mark]', ' … ', 12) AS snip
           FROM notes_fts
           JOIN notes n ON n.id = notes_fts.rowid
          WHERE notes_fts MATCH ?1
          ORDER BY bm25(notes_fts) ASC
          LIMIT 50",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([query], |row| {
        Ok(Hit {
            id: row.get(0)?,
            title: row.get(1)?,
            snippet: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![add_note, search_notes])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
