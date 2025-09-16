#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Serialize, Deserialize};
use directories::ProjectDirs;
use std::path::PathBuf;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use chrono::{Local, Duration};




fn app_data_dir() -> Result<PathBuf, String> {
    let proj = ProjectDirs::from("", "KnoYoo", "Desktop")
        .ok_or_else(|| "cannot resolve app data dir".to_string())?;
    // %APPDATA%\KnoYoo\Desktop\data
    let base = proj.data_dir();
    let dir = base.join("data");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
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

        -- 行业能力树
        CREATE TABLE IF NOT EXISTS industry_skill (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          parent_id INTEGER,
          name TEXT NOT NULL,
          level INTEGER NOT NULL, -- 能力层级
          importance INTEGER NOT NULL DEFAULT 3, -- 重要性 1-5
          FOREIGN KEY(parent_id) REFERENCES industry_skill(id)
        );

        -- 个人成长树节点
        CREATE TABLE IF NOT EXISTS growth_node (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          skill_id INTEGER NOT NULL,
          mastery INTEGER NOT NULL DEFAULT 0, -- 掌握度 0-100
          FOREIGN KEY(skill_id) REFERENCES industry_skill(id)
        );

        -- 笔记与技能映射
        CREATE TABLE IF NOT EXISTS note_skill_map (
          note_id INTEGER NOT NULL,
          skill_id INTEGER NOT NULL,
          weight INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY(note_id, skill_id),
          FOREIGN KEY(note_id) REFERENCES notes(id),
          FOREIGN KEY(skill_id) REFERENCES industry_skill(id)
        );

        -- 计划任务
        CREATE TABLE IF NOT EXISTS plan_task (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          horizon TEXT NOT NULL, -- 'WEEK'|'QTR'
          skill_id INTEGER,
          title TEXT NOT NULL,
          minutes INTEGER NOT NULL DEFAULT 0,
          due TEXT, -- 截止时间
          status TEXT NOT NULL DEFAULT 'TODO',
          FOREIGN KEY(skill_id) REFERENCES industry_skill(id)
        );

        -- 能力差距视图（占位，gap=required_level-mastery，importance 参与优先级）
        CREATE VIEW IF NOT EXISTS v_skill_gap AS
        SELECT
          s.id AS skill_id,
          s.name,
          s.level AS required_level,
          s.importance,
          COALESCE(g.mastery, 0) AS mastery,
          (s.level - COALESCE(g.mastery, 0)) AS gap
        FROM industry_skill s
        LEFT JOIN growth_node g ON s.id = g.skill_id;

        -- —— 清理与约束（新增） ——
        -- 1) growth_node：每个 skill 只保留一个节点
        CREATE UNIQUE INDEX IF NOT EXISTS idx_growth_unique ON growth_node(skill_id);
        -- 2) plan_task：只允许每个 (horizon, skill_id) 存在一条“未完成”任务（利用部分唯一索引）
        CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_open_unique
          ON plan_task(horizon, skill_id)
          WHERE status <> 'DONE';
        -- 3) 查询性能小索引
        CREATE INDEX IF NOT EXISTS idx_plan_hsd ON plan_task(horizon, status, due);
        CREATE INDEX IF NOT EXISTS idx_note_skill_note ON note_skill_map(note_id);
        CREATE INDEX IF NOT EXISTS idx_note_skill_skill ON note_skill_map(skill_id);
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

    // 判定：中文 / 含数字或符号 / 超短词 → 直接 LIKE
    let need_like_primary = has_cjk(&query) || has_digit_or_symbol(&query) || query.chars().count() <= 2;

    // 小工具：是否是“纯 ASCII 英数单词”（例如 SVM、NLP、AI，不含空格）
    fn is_ascii_alnum_word(s: &str) -> bool {
        !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric())
    }

    // LIKE 路径（标题/正文都搜），带简单片段
    let like_search = |conn: &Connection, q: &str| -> Result<Vec<Hit>, String> {
        let like = format!("%{}%", q);
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
            let snippet = make_snippet(&content, q, 24);
            Ok(Hit { id, title, snippet })
        }).map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(|e| e.to_string())?); }
        Ok(out)
    };

    if need_like_primary {
        // 直接 LIKE
        return like_search(&conn, &query);
    }

    // 首选 FTS5（英文/可分词）
    let mut stmt = conn.prepare(
        "SELECT n.id, n.title,
                COALESCE(NULLIF(snippet(notes_fts, 1, '[mark]', '[/mark]', ' … ', 12), ''),
                         snippet(notes_fts, 0, '[mark]', '[/mark]', ' … ', 12)) AS snip
           FROM notes_fts
           JOIN notes n ON n.id = notes_fts.rowid
          WHERE notes_fts MATCH ?1
          ORDER BY bm25(notes_fts) ASC
          LIMIT 50",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([&query], |row| {
        Ok(Hit { id: row.get(0)?, title: row.get(1)?, snippet: row.get(2)? })
    }).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }

    // ⭐ 关键补救：若 FTS5 空且查询是纯 ASCII 单词（如 SVM），再回退 LIKE
    if out.is_empty() && is_ascii_alnum_word(&query) {
        return like_search(&conn, &query);
    }

    Ok(out)
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

#[tauri::command]
fn seed_industry_v1() -> Result<u32, String> {
    // 示例种子（可后续扩充/调整）
    let skills: Vec<(Option<i64>, &'static str, i64, i64)> = vec![
        (None, "数据分析",   1, 5),
        (None, "机器学习",   1, 5),
        (None, "深度学习",   1, 4),
        (None, "数据工程",   1, 4),
        (None, "AI 产品",    1, 4),
        (None, "大模型",     1, 4),
        (None, "Prompt 工程",1, 3),
        (None, "数据可视化", 1, 3),
        (None, "数据治理",   1, 3),
        (None, "NLP",       1, 3),
        (None, "CV",        1, 3),
        (None, "推荐系统",   1, 3),
        (None, "知识图谱",   1, 2),
        (None, "AI 安全",    1, 2),
        (None, "AI 法律伦理",1, 2),
    ];
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut count = 0u32;
    for (parent_id, name, level, importance) in skills {
        tx.execute(
            "INSERT OR IGNORE INTO industry_skill (parent_id, name, level, importance) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![parent_id, name, level, importance],
        ).map_err(|e| e.to_string())?;
        count += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(count)
}

#[derive(Serialize)]
struct ClassifyHit {
    skill_id: i64,
    name: String,
    delta: i64,
    new_mastery: i64,
}

#[tauri::command]
fn classify_and_update(note_id: i64) -> Result<Vec<ClassifyHit>, String> {
    let conn = open_db()?;

    // 取笔记内容
    let mut stmt = conn.prepare("SELECT title, content FROM notes WHERE id=?1")
        .map_err(|e| e.to_string())?;
    let (title, content): (String, String) = stmt
        .query_row(rusqlite::params![note_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;
    let text = format!("{} {}", title, content);

    // 遍历技能
    let mut skill_stmt = conn.prepare("SELECT id, name FROM industry_skill")
        .map_err(|e| e.to_string())?;
    let skills = skill_stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    let mut hits: Vec<ClassifyHit> = Vec::new();
    for s in skills {
        let (skill_id, name) = s.map_err(|e| e.to_string())?;
        if text.contains(&name) {
            // 写入映射表
            conn.execute(
                "INSERT OR IGNORE INTO note_skill_map (note_id, skill_id, weight) VALUES (?1, ?2, 1)",
                rusqlite::params![note_id, skill_id],
            ).map_err(|e| e.to_string())?;

            // mastery +10（如无则插入）
            let delta: i64 = 10;
            let updated = conn.execute(
                "UPDATE growth_node SET mastery = MIN(mastery+?2,100) WHERE skill_id=?1",
                rusqlite::params![skill_id, delta],
            ).map_err(|e| e.to_string())?;
            if updated == 0 {
                conn.execute(
                    "INSERT INTO growth_node (skill_id, mastery) VALUES (?1, ?2)",
                    rusqlite::params![skill_id, delta],
                ).map_err(|e| e.to_string())?;
            }

            // 取最新 mastery
            let new_mastery: i64 = conn.query_row(
                "SELECT mastery FROM growth_node WHERE skill_id=?1",
                [skill_id],
                |r| r.get(0),
            ).map_err(|e| e.to_string())?;

            hits.push(ClassifyHit { skill_id, name, delta, new_mastery });
        }
    }

    Ok(hits)
}

#[derive(Serialize)]
struct PlanTaskOut {
    id: i64,
    skill_id: Option<i64>,
    title: String,
    minutes: i64,
    due: Option<String>,
    status: String,
}

#[tauri::command]
fn generate_plan(horizon: String) -> Result<Vec<PlanTaskOut>, String> {
    use chrono::{Local, Duration};
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut out = Vec::new();

    // WEEK → 7 天；QTR → 12 周
    let today = Local::now().date_naive();
    let (slots, step_days) = match horizon.as_str() {
        "QTR" => (12, 7),
        _     => (7, 1),
    };
    let mut assigned = 0usize;

    {
        let mut stmt = tx.prepare(
            "SELECT s.id, s.name, s.importance, COALESCE(g.mastery,0) as mastery, s.level
               FROM industry_skill s
               LEFT JOIN growth_node g ON s.id = g.skill_id
              ORDER BY (s.level - COALESCE(g.mastery,0)) * s.importance DESC, s.importance DESC
              LIMIT 5"
        ).map_err(|e| e.to_string())?;

        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let skill_id: i64 = row.get(0).map_err(|e| e.to_string())?;
            let name: String = row.get(1).map_err(|e| e.to_string())?;
            let importance: i64 = row.get(2).map_err(|e| e.to_string())?;
            let mastery: i64 = row.get(3).map_err(|e| e.to_string())?;
            let level: i64 = row.get(4).map_err(|e| e.to_string())?;
            let gap = level - mastery;
            if gap <= 0 { continue; }

            // ⭐ 去重：若已存在同 horizon+skill 的未完成任务（且截止日在今天及以后），就跳过
            let exists: Option<i64> = tx.query_row(
                "SELECT id FROM plan_task
                  WHERE horizon=?1 AND skill_id=?2
                    AND status<>'DONE'
                    AND (due IS NULL OR due >= date('now'))
                  LIMIT 1",
                rusqlite::params![&horizon, skill_id],
                |r| r.get(0),
            ).optional().map_err(|e| e.to_string())?;
            if exists.is_some() {
                continue; // 已有未完成任务：不再重复插入
            }

            let minutes = 60 * importance.min(gap);
            let title = format!("提升{}（差距{}）", name, gap);

            // 分散 due
            let slot = assigned % slots;
            let due = today + Duration::days((slot * step_days) as i64);
            let due_str = due.format("%Y-%m-%d").to_string();
            assigned += 1;

            tx.execute(
                "INSERT INTO plan_task (horizon, skill_id, title, minutes, due, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'TODO')",
                rusqlite::params![&horizon, skill_id, &title, minutes, &due_str],
            ).map_err(|e| e.to_string())?;

            let id = tx.last_insert_rowid();
            out.push(PlanTaskOut {
                id,
                skill_id: Some(skill_id),
                title,
                minutes,
                due: Some(due_str),
                status: "TODO".to_string(),
            });
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(out)
}

#[derive(Serialize)]
struct PlanTask {
    id: i64,
    skill_id: Option<i64>,
    title: String,
    minutes: i64,
    due: Option<String>,
    status: String,
    horizon: String,
}

#[tauri::command]
fn list_plan_tasks(horizon: Option<String>, status: Option<String>) -> Result<Vec<PlanTask>, String> {
    let conn = open_db()?;
    let (mut sql, mut args): (String, Vec<(usize, String)>) = (
        "SELECT id, skill_id, title, minutes, due, status, horizon
           FROM plan_task".to_string(),
        vec![]
    );
    let mut where_clause: Vec<String> = vec![];
    if let Some(h) = horizon.as_ref() {
        where_clause.push("horizon = ?1".to_string());
        args.push((1, h.clone()));
    }
    if let Some(s) = status.as_ref() {
        where_clause.push(format!("status = ?{}", args.len() + 1));
        args.push((args.len() + 1, s.clone()));
    }
    if !where_clause.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_clause.join(" AND "));
    }
    sql.push_str(" ORDER BY COALESCE(due,'9999-12-31') ASC, id DESC LIMIT 200");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(
        rusqlite::params_from_iter(args.iter().map(|(_, v)| v)),
        |row| Ok(PlanTask {
            id: row.get(0)?, skill_id: row.get(1)?,
            title: row.get(2)?, minutes: row.get(3)?,
            due: row.get(4)?, status: row.get(5)?, horizon: row.get(6)?,
        })
    ).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
fn update_plan_status(id: i64, status: String) -> Result<(), String> {
    let mut conn = open_db()?;
    conn.execute(
        "UPDATE plan_task SET status=?1 WHERE id=?2",
        rusqlite::params![status, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_plan_task(id: i64) -> Result<(), String> {
    let mut conn = open_db()?;
    conn.execute("DELETE FROM plan_task WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_plan_task(id: i64, title: String, minutes: i64, due: Option<String>) -> Result<(), String> {
    let mut conn = open_db()?;
    conn.execute(
        "UPDATE plan_task SET title=?1, minutes=?2, due=?3 WHERE id=?4",
        rusqlite::params![title, minutes, due, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
struct WeekReport {
    start: String,
    end: String,
    tasks_done: i64,
    minutes_done: i64,
    new_notes: i64,
    avg_mastery: f64,
    top_gaps: Vec<(String, i64, i64, i64)>, // name, required_level, mastery, gap
}

#[tauri::command]
fn report_week_summary() -> Result<WeekReport, String> {
    let conn = open_db()?;

    // 本周窗口：今天往前 6 天
    let end = Local::now().date_naive();
    let start = end - Duration::days(6);
    let start_s = start.format("%Y-%m-%d").to_string();
    let end_s   = end.format("%Y-%m-%d").to_string();

    // 1) 本周完成任务数 / 总分钟
    let (tasks_done, minutes_done):(i64,i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(minutes),0)
           FROM plan_task
          WHERE status='DONE' AND due IS NOT NULL
            AND due >= ?1 AND due <= ?2",
        rusqlite::params![&start_s, &end_s],
        |r| Ok((r.get(0)?, r.get(1)?))
    ).unwrap_or((0,0));

    // 2) 近 7 天新增笔记
    let new_notes: i64 = conn.query_row(
        "SELECT COUNT(*) FROM notes WHERE datetime(created_at) >= datetime(?1 || 'T00:00:00Z')",
        [&start_s],
        |r| r.get(0)
    ).unwrap_or(0);

    // 3) 当前平均 mastery
    let avg_mastery: f64 = conn.query_row(
        "SELECT COALESCE(AVG(mastery),0.0) FROM growth_node",
        [],
        |r| r.get(0)
    ).unwrap_or(0.0);

    // 4) 短板 Top5（gap*importance）
    let mut stmt4 = conn.prepare(
        "SELECT s.name, s.level AS required_level, COALESCE(g.mastery,0) as mastery,
                (s.level-COALESCE(g.mastery,0)) AS gap
           FROM industry_skill s
           LEFT JOIN growth_node g ON s.id = g.skill_id
          ORDER BY (s.level-COALESCE(g.mastery,0))*s.importance DESC, s.importance DESC
          LIMIT 5"
    ).map_err(|e| e.to_string())?;
    let rows = stmt4.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
        ))
    }).map_err(|e| e.to_string())?;
    let mut top_gaps = Vec::new();
    for r in rows { top_gaps.push(r.map_err(|e| e.to_string())?); }

    Ok(WeekReport{ start: start_s, end: end_s, tasks_done, minutes_done, new_notes, avg_mastery, top_gaps })
}

#[tauri::command]
fn cleanup_plan_duplicates(horizon: Option<String>) -> Result<u32, String> {
    // 删除“未完成”的重复计划：对 (horizon, skill_id) 只保留 id 最大的那条（最近生成的）
    let conn = open_db()?;

    let (sql, params): (String, Vec<String>) = if let Some(h) = horizon {
        (
            "DELETE FROM plan_task
              WHERE status <> 'DONE'
                AND horizon = ?1
                AND id NOT IN (
                  SELECT MAX(id) FROM plan_task
                   WHERE status <> 'DONE' AND horizon = ?1
                   GROUP BY horizon, skill_id
                )".to_string(),
            vec![h],
        )
    } else {
        (
            "DELETE FROM plan_task
              WHERE status <> 'DONE'
                AND id NOT IN (
                  SELECT MAX(id) FROM plan_task
                   WHERE status <> 'DONE'
                   GROUP BY horizon, skill_id
                )".to_string(),
            vec![],
        )
    };

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let changed = if params.is_empty() {
        stmt.execute([]).map_err(|e| e.to_string())?
    } else {
        stmt.execute(rusqlite::params![params[0]]).map_err(|e| e.to_string())?
    };
    Ok(changed as u32)
}


fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            add_note, search_notes, list_notes, update_note, delete_note,
            export_notes_jsonl, import_notes_jsonl, seed_industry_v1,
            classify_and_update, generate_plan,
            list_plan_tasks, update_plan_status, report_week_summary,
            delete_plan_task, update_plan_task, cleanup_plan_duplicates
        ])
          
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
