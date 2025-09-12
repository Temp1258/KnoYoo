#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde::{Serialize, Deserialize};
use directories::ProjectDirs;
use std::path::PathBuf;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};




fn app_data_dir() -> Result<PathBuf, String> {
    let proj = ProjectDirs::from("", "KnoYoo", "Desktop")
        .ok_or_else(|| "cannot resolve app data dir".to_string())?;
    let dir = proj.data_dir(); // %APPDATA%\KnoYoo\Desktop\data
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    Ok(dir.to_path_buf())
}

fn app_db_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("notes.db"))
}





fn open_db() -> Result<Connection, String> {
    let db_path = app_db_path()?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
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

        -- 先删除历史重复：相同(title, content, created_at)仅保留最小id那条
        DELETE FROM notes
        WHERE id NOT IN (
          SELECT MIN(id) FROM notes
          GROUP BY title, content, created_at
        );

        -- 再加唯一索引防止后续再产生重复
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_dedupe
          ON notes(title, content, created_at);
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
        || ('\u{F900}'..='\u{FAFF}').contains(&c) // Compatibility
    )
}

fn has_digit_or_symbol(s: &str) -> bool {
    s.chars().any(|c| c.is_ascii_digit() || (!c.is_alphabetic() && !c.is_whitespace()))
}

/// 简单 snippet：基于 char，不会切乱码
fn make_snippet(text: &str, needle: &str, context: usize) -> String {
    if let Some(pos) = text.find(needle) {
        let start = text[..pos].chars().rev().take(context).collect::<Vec<_>>();
        let end = text[pos + needle.len()..].chars().take(context).collect::<Vec<_>>();
        let mut left = start.into_iter().rev().collect::<String>();
        let mid = format!("[mark]{}[/mark]", needle);
        let mut right = end.into_iter().collect::<String>();
        if left.chars().count() == context { left = format!("…{}", left); }
        if right.chars().count() == context { right = format!("{}…", right); }
        format!("{left}{mid}{right}")
    } else {
        text.chars().take(context * 2).collect::<String>()
    }
}

#[tauri::command]
fn search_notes(query: String) -> Result<Vec<Hit>, String> {
    let conn = open_db()?;

    let need_like = has_cjk(&query) || has_digit_or_symbol(&query) || query.chars().count() <= 2;

    if need_like {
        // 中文/含数字或符号/超短词：回退 LIKE（标题/正文皆搜）
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
        // 英文/可分词：FTS5，优先 content 的 snippet，为空再用 title
        let mut stmt = conn.prepare(
            "SELECT n.id, n.title,
                    /* 优先从 content(1) 抽取 snippet，若空再回退到 title(0) */
                    COALESCE(NULLIF(snippet(notes_fts, 1, '[mark]', '[/mark]', ' … ', 12), ''),
                             snippet(notes_fts, 0, '[mark]', '[/mark]', ' … ', 12)) AS snip
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



#[derive(Serialize)]
struct ExportResult { path: String, count: u32 }

/// 导出为 JSONL（每行一条）到 %APPDATA%\KnoYoo\Desktop\data\notes-export.jsonl
#[tauri::command]
fn export_notes_jsonl() -> Result<ExportResult, String> {
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
        writeln!(file, "{}", obj.to_string()).map_err(|e| e.to_string())?;
        count += 1;
    }

    Ok(ExportResult {
        path: out_path.display().to_string(),
        count,
    })
}

#[derive(Deserialize)]
struct InNote { title: String, content: String, created_at: Option<String> }

#[tauri::command]
fn import_notes_jsonl() -> Result<(u32, u32), String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let in_path = app_data_dir()?.join("notes-export.jsonl");

    let file = File::open(&in_path).map_err(|e| format!("open {}: {}", in_path.display(), e))?;
    let reader = BufReader::new(file);
    let mut inserted = 0u32;
    let mut ignored = 0u32;

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() { continue; }

        let v: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        let (title, content, created_at) = if v.get("title").is_some() && v.get("content").is_some() {
            let t = v["title"].as_str().unwrap_or_default().to_string();
            let c = v["content"].as_str().unwrap_or_default().to_string();
            let ca = v.get("created_at").and_then(|x| x.as_str()).unwrap_or("").to_string();
            (t, c, ca)
        } else {
            let n: InNote = serde_json::from_value(v).map_err(|e| e.to_string())?;
            (n.title, n.content, n.created_at.unwrap_or_default())
        };

        if created_at.is_empty() {
            tx.execute(
              "INSERT OR IGNORE INTO notes (title, content) VALUES (?1, ?2)",
              params![title, content]
            ).map_err(|e| e.to_string())?;
        } else {
            tx.execute(
              "INSERT OR IGNORE INTO notes (title, content, created_at) VALUES (?1, ?2, ?3)",
              params![title, content, created_at]
            ).map_err(|e| e.to_string())?;
        }

        let changed = tx.changes();
        if changed > 0 { inserted += 1; } else { ignored += 1; }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok((inserted, ignored))
}





fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            add_note, search_notes, list_notes, update_note, delete_note,
            export_notes_jsonl, import_notes_jsonl
          ])
          
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
