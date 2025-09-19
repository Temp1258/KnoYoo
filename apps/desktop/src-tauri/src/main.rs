#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Serialize, Deserialize};
use directories::ProjectDirs;
use std::path::PathBuf;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use chrono::{Local, Duration};
use std::collections::HashSet;
use std::collections::HashMap;




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
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
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

    -- 先删历史重复，再加唯一索引（避免导入造成重复）
    DELETE FROM notes
    WHERE id NOT IN (
      SELECT MIN(id) FROM notes
      GROUP BY title, content, created_at
    );
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

    CREATE TABLE IF NOT EXISTS growth_node (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL REFERENCES industry_skill(id) ON DELETE CASCADE,
      mastery INTEGER NOT NULL DEFAULT 0,        -- 0~100
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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

    -- 能力差距视图（统一用 required_level）
    CREATE VIEW IF NOT EXISTS v_skill_gap AS
    SELECT
      s.id AS skill_id,
      s.name,
      s.required_level,
      s.importance,
      COALESCE(g.mastery, 0) AS mastery,
      (s.required_level - COALESCE(g.mastery, 0)) AS gap
    FROM industry_skill s
    LEFT JOIN growth_node g ON s.id = g.skill_id;

    -- 约束与索引
    CREATE UNIQUE INDEX IF NOT EXISTS idx_growth_unique ON growth_node(skill_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_open_unique
      ON plan_task(horizon, skill_id)
      WHERE status <> 'DONE';
    CREATE INDEX IF NOT EXISTS idx_plan_hsd ON plan_task(horizon, status, due);
    CREATE INDEX IF NOT EXISTS idx_note_skill_note ON note_skill_map(note_id);
    CREATE INDEX IF NOT EXISTS idx_note_skill_skill ON note_skill_map(skill_id);

    -- 应用配置（AI 等）
    CREATE TABLE IF NOT EXISTS app_kv (
      key TEXT PRIMARY KEY,
      val TEXT NOT NULL
    );
    "#,
    )
    .map_err(|e| e.to_string())?;
    // 首次启动自动写入行业树 v1（迷你 12 项示例）
    {
        let cnt: i64 = conn
            .query_row("SELECT COUNT(1) FROM industry_skill", [], |r| r.get::<_, i64>(0))
            .unwrap_or(0);

        if cnt == 0 {
            // name, required_level(L1~L5 -> 1~5), importance(1~5)
            // Data/AI 方向的最小能力集（正式版本见文档：v1 约 40±5 项，这里先放 12 项示例）
            let skills = [
                ("Python 基础",            3, 5),
                ("Python 数据分析",        3, 5),
                ("SQL/数据库",            3, 5),
                ("概率统计",               3, 4),
                ("机器学习基础",           3, 5),
                ("特征工程",               3, 4),
                ("模型评估与调参",         3, 4),
                ("深度学习基础",           2, 3),
                ("NLP 基础",               2, 3),
                ("数据可视化",             3, 3),
                ("Git/工程协作",           3, 4),
                ("MLOps/部署基础",         2, 3),
            ];
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            for (name, req, imp) in skills {
                tx.execute(
                    "INSERT OR IGNORE INTO industry_skill(name, required_level, importance) VALUES (?1,?2,?3)",
                    params![name, req, imp],
                ).map_err(|e| e.to_string())?;
                // 建立对应的成长节点（mastery 初始为 0）
                tx.execute(
                    "INSERT INTO growth_node(skill_id, mastery)
                     SELECT id, 0 FROM industry_skill WHERE name=?1
                     ON CONFLICT DO NOTHING",
                    params![name],
                ).map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
        }
    }
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
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 先删映射，避免外键挡住删除 notes
    tx.execute(
        "DELETE FROM note_skill_map WHERE note_id=?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;

    // 再删笔记本身
    tx.execute(
        "DELETE FROM notes WHERE id=?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    // 删除后重算 mastery，雷达/统计会即时回落
    recompute_mastery(&conn)?;
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
            "INSERT OR IGNORE INTO industry_skill (parent_id, name, required_level, importance) VALUES (?1, ?2, ?3, ?4)",
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
    let mut skill_stmt = conn.prepare(
        "SELECT MIN(id) AS id, name FROM industry_skill GROUP BY name"
    ).map_err(|e| e.to_string())?;
    let skills = skill_stmt.query_map([], |row| Ok((
        row.get::<_, i64>(0)?,
        row.get::<_, String>(1)?,
    ))).map_err(|e| e.to_string())?;

    let mut hits: Vec<ClassifyHit> = Vec::new();
    for s in skills {
        let (skill_id, name) = s.map_err(|e| e.to_string())?;
        if text.contains(&name) {
            // 只有首次建立映射时才加分
            let inserted = conn.execute(
                "INSERT OR IGNORE INTO note_skill_map (note_id, skill_id, weight) VALUES (?1, ?2, 1)",
                rusqlite::params![note_id, skill_id],
            ).map_err(|e| e.to_string())?;
            if inserted > 0 {
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
                let new_mastery: i64 = conn.query_row(
                    "SELECT mastery FROM growth_node WHERE skill_id=?1",
                    [skill_id],
                    |r| r.get(0),
                ).map_err(|e| e.to_string())?;
                hits.push(ClassifyHit { skill_id, name, delta, new_mastery });
            }
        }
    }
    recompute_mastery(&conn)?;
    if hits.is_empty() {
        return Ok(vec![]);
    }
    Ok(hits)
}

// 工具函数：bigrams & similarity_score
fn bigrams(s: &str) -> HashSet<String> {
    let chars: Vec<char> = s.chars().collect();
    let mut set = HashSet::new();
    if chars.len() < 2 { return set; }
    for i in 0..(chars.len() - 1) {
        let bg: String = [chars[i], chars[i + 1]].iter().collect();
        set.insert(bg);
    }
    set
}

fn similarity_score(note: &str, skill: &str) -> i64 {
    // 直接包含给高分
    if !skill.is_empty() && note.contains(skill) {
        return 95;
    }
    // 限制长度避免过慢
    let note_cut: String = note.chars().take(2000).collect();
    let a = bigrams(&note_cut);
    let b = bigrams(skill);
    if a.is_empty() || b.is_empty() { return 0; }
    let inter = a.intersection(&b).count() as f64;
    let union = (a.len() + b.len()) as f64 - inter;
    if union <= 0.0 { return 0; }
    let score = (inter / union * 100.0).round() as i64;
    score.clamp(0, 100)
}

#[tauri::command]
fn classify_note_embed(note_id: i64) -> Result<Vec<ClassifyHit>, String> {
    let mut conn = open_db()?;

    let (title, content): (String, String) = conn.query_row(
        "SELECT title, content FROM notes WHERE id=?1",
        rusqlite::params![note_id],
        |r| Ok((r.get(0)?, r.get(1)?))
    ).map_err(|e| e.to_string())?;
    let text = format!("{} {}", title, content);

    // —— 评分（对每个名字只保留最小 id）——
    let mut scored: Vec<(i64, String, i64)> = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT MIN(id) AS id, name FROM industry_skill GROUP BY name"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (sid, name) = row.map_err(|e| e.to_string())?;
            let score = similarity_score(&text, &name);
            scored.push((sid, name, score));
        }
    }

    scored.sort_by(|a, b| b.2.cmp(&a.2));
    let picked: Vec<(i64, String, i64)> =
        scored.into_iter().filter(|(_, _, s)| *s >= 60).take(5).collect();

    // —— 只对“首次命中”的映射加分；已命中过不再加 —— 
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut hits: Vec<ClassifyHit> = Vec::new();

    for (skill_id, name, score) in picked {
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO note_skill_map (note_id, skill_id, weight) VALUES (?1, ?2, 1)",
            rusqlite::params![note_id, skill_id],
        ).map_err(|e| e.to_string())?;
        if inserted > 0 {
            let delta: i64 = (score / 10).clamp(5, 20);
            let updated = tx.execute(
                "UPDATE growth_node SET mastery = MIN(mastery+?2,100) WHERE skill_id=?1",
                rusqlite::params![skill_id, delta],
            ).map_err(|e| e.to_string())?;
            if updated == 0 {
                tx.execute(
                    "INSERT INTO growth_node (skill_id, mastery) VALUES (?1, ?2)",
                    rusqlite::params![skill_id, delta],
                ).map_err(|e| e.to_string())?;
            }
            let new_mastery: i64 = tx.query_row(
                "SELECT mastery FROM growth_node WHERE skill_id=?1",
                rusqlite::params![skill_id],
                |r| r.get(0),
            ).map_err(|e| e.to_string())?;
            hits.push(ClassifyHit { skill_id, name, delta, new_mastery });
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    recompute_mastery(&conn)?;
    if hits.is_empty() {
        return Ok(vec![]);
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
            "SELECT s.id, s.name, s.importance, COALESCE(g.mastery,0) as mastery, s.required_level
               FROM industry_skill s
               LEFT JOIN growth_node g ON s.id = g.skill_id
              ORDER BY (s.required_level - COALESCE(g.mastery,0)) * s.importance DESC, s.importance DESC
              LIMIT 5"
        ).map_err(|e| e.to_string())?;

        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let skill_id: i64 = row.get(0).map_err(|e| e.to_string())?;
            let name: String = row.get(1).map_err(|e| e.to_string())?;
            let importance: i64 = row.get(2).map_err(|e| e.to_string())?;
            let mastery: i64 = row.get(3).map_err(|e| e.to_string())?;
            let required_level: i64 = row.get(4).map_err(|e| e.to_string())?;
            let gap = required_level - mastery;
            if gap <= 0 { continue; }

            // ⭐ 去重：若已存在同 horizon+skill 的未完成任务（且截止日在今天及以后），就跳过
            let exists: Option<i64> = tx.query_row(
                "SELECT id FROM plan_task
                  WHERE horizon=?1 AND skill_id=?2
                    AND status<>'DONE'
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

            match tx.execute(
                "INSERT INTO plan_task (horizon, skill_id, title, minutes, due, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'TODO')",
                rusqlite::params![&horizon, skill_id, &title, minutes, &due_str],
            ) {
                Ok(_) => {
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
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("UNIQUE constraint failed") {
                        // 已被唯一索引拦截（例如存在逾期未完成任务），跳过即可
                        continue;
                    } else {
                        return Err(msg);
                    }
                }
            }
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
    let conn = open_db()?;
    conn.execute(
        "UPDATE plan_task SET status=?1 WHERE id=?2",
        rusqlite::params![status, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_plan_task(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM plan_task WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_plan_task(id: i64, title: String, minutes: i64, due: Option<String>) -> Result<(), String> {
    let conn = open_db()?;
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
        "SELECT s.name, s.required_level, COALESCE(g.mastery,0) as mastery,
                (s.required_level-COALESCE(g.mastery,0)) AS gap
           FROM industry_skill s
           LEFT JOIN growth_node g ON s.id = g.skill_id
          ORDER BY (s.required_level-COALESCE(g.mastery,0))*s.importance DESC, s.importance DESC
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

#[derive(Serialize)]
struct Counts { industry: i64, growth: i64, plans: i64 }

#[tauri::command]
fn debug_counts() -> Result<Counts, String> {
    let conn = open_db()?;
    let industry: i64 = conn.query_row(
        "SELECT COUNT(1) FROM industry_skill", [], |r| r.get::<_, i64>(0)
    ).unwrap_or(0);
    let growth: i64 = conn.query_row(
        "SELECT COUNT(1) FROM growth_node", [], |r| r.get::<_, i64>(0)
    ).unwrap_or(0);
    let plans: i64 = conn.query_row(
        "SELECT COUNT(1) FROM plan_task", [], |r| r.get::<_, i64>(0)
    ).unwrap_or(0);
    Ok(Counts { industry, growth, plans })
}

#[tauri::command]
fn backfill_growth_nodes() -> Result<u32, String> {
    let conn = open_db()?;
    // 为没有成长节点的技能补 0 分的 mastery
    let changed = conn.execute(
        "INSERT INTO growth_node (skill_id, mastery)
         SELECT s.id, 0
           FROM industry_skill s
      LEFT JOIN growth_node g ON g.skill_id = s.id
          WHERE g.skill_id IS NULL",
        [],
    ).map_err(|e| e.to_string())?;
    Ok(changed as u32)
}

#[tauri::command]
fn fix_schema_required_level() -> Result<String, String> {
    let conn = open_db()?;

    // 1) 检查列名
    let mut has_required = false;
    let mut has_level = false;
    {
        let mut stmt = conn.prepare("PRAGMA table_info(industry_skill)")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        for r in rows {
            let name = r.map_err(|e| e.to_string())?;
            if name == "required_level" { has_required = true; }
            if name == "level" { has_level = true; }
        }
    }

    // 2) 如仍是 level → 改名为 required_level
    if !has_required && has_level {
        conn.execute(
            "ALTER TABLE industry_skill RENAME COLUMN level TO required_level",
            [],
        ).map_err(|e| format!("rename column failed: {}", e))?;
    }

    // 3) 视图可能老版本引用了 level，统一重建
    conn.execute("DROP VIEW IF EXISTS v_skill_gap", [])
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        CREATE VIEW IF NOT EXISTS v_skill_gap AS
        SELECT
          s.id AS skill_id,
          s.name,
          s.required_level,
          s.importance,
          COALESCE(g.mastery, 0) AS mastery,
          (s.required_level - COALESCE(g.mastery, 0)) AS gap
        FROM industry_skill s
        LEFT JOIN growth_node g ON s.id = g.skill_id;
        "#,
    ).map_err(|e| e.to_string())?;

    Ok("ok".into())
}

#[derive(Serialize)]
struct SkillGap {
    name: String,
    required_level: i64, // 1~5
    mastery: i64,        // 0~100
    gap: i64,            // required_level - mastery
}

#[tauri::command]
fn list_skill_gaps(limit: Option<i64>) -> Result<Vec<SkillGap>, String> {
    let conn = open_db()?;
    let lim = limit.unwrap_or(8).clamp(1, 50);
    let mut stmt = conn.prepare(
        "SELECT s.name,
                s.required_level,
                COALESCE(g.mastery, 0) AS mastery,
                (s.required_level - COALESCE(g.mastery, 0)) AS gap,
                s.importance
           FROM industry_skill s
           LEFT JOIN growth_node g ON s.id = g.skill_id
          ORDER BY (s.required_level - COALESCE(g.mastery, 0)) * s.importance DESC,
                   s.importance DESC
          LIMIT ?1"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([lim], |row| {
        Ok(SkillGap {
            name: row.get(0)?,
            required_level: row.get(1)?,
            mastery: row.get(2)?,
            gap: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
fn fix_skill_name_unique() -> Result<i64, String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 统计有多少个重名（>1）
    let dup: i64 = tx.query_row(
        "SELECT COUNT(*) FROM (
           SELECT name, COUNT(*) c FROM industry_skill GROUP BY name HAVING c > 1
         )",
        [],
        |r| r.get(0),
    ).unwrap_or(0);

    // 建映射：每个 name 取最小 id 为 keep_id
    tx.execute_batch(r#"
      CREATE TEMP TABLE IF NOT EXISTS name_to_keep AS
        SELECT name, MIN(id) AS keep_id FROM industry_skill GROUP BY name;

      -- 合并 growth_node（同名取 mastery 最大值）
      CREATE TEMP TABLE IF NOT EXISTS tmp_g AS
        SELECT k.keep_id AS skill_id, MAX(COALESCE(g.mastery,0)) AS mastery
        FROM name_to_keep k
        LEFT JOIN industry_skill s ON s.name = k.name
        LEFT JOIN growth_node g ON g.skill_id = s.id
        GROUP BY k.keep_id;

      -- 更新 plan_task 的 skill_id
      UPDATE plan_task
      SET skill_id = (
        SELECT k.keep_id
        FROM industry_skill s JOIN name_to_keep k ON s.name = k.name
        WHERE s.id = plan_task.skill_id
      )
      WHERE skill_id IS NOT NULL;

      -- 合并 note_skill_map（先把合并后的映射插入，避免主键冲突）
      INSERT OR IGNORE INTO note_skill_map(note_id, skill_id, weight)
      SELECT nsm.note_id, k.keep_id, MAX(nsm.weight)
      FROM note_skill_map nsm
      JOIN industry_skill s ON nsm.skill_id = s.id
      JOIN name_to_keep k ON s.name = k.name
      GROUP BY nsm.note_id, k.keep_id;

      -- 删除旧的映射（指向非 keep_id 的）
      DELETE FROM note_skill_map
      WHERE (note_id, skill_id) IN (
        SELECT nsm.note_id, nsm.skill_id
        FROM note_skill_map nsm
        JOIN industry_skill s ON nsm.skill_id = s.id
        JOIN name_to_keep k ON s.name = k.name
        WHERE nsm.skill_id <> k.keep_id
      );

      -- 清掉非 keep 的 growth_node，再用 tmp_g 回填（取更大 mastery）
      DELETE FROM growth_node
      WHERE skill_id IN (
        SELECT s.id FROM industry_skill s JOIN name_to_keep k ON s.name = k.name
        WHERE s.id <> k.keep_id
      );
      INSERT INTO growth_node(skill_id, mastery)
      SELECT skill_id, mastery FROM tmp_g
      ON CONFLICT(skill_id) DO UPDATE SET mastery = excluded.mastery
      WHERE excluded.mastery > growth_node.mastery;

      -- 删除 industry_skill 的重复行（保留 keep_id）
      DELETE FROM industry_skill
      WHERE id IN (
        SELECT s.id FROM industry_skill s JOIN name_to_keep k ON s.name = k.name
        WHERE s.id <> k.keep_id
      );

      -- 处理 plan_task 因合并产生的未完成重复（保留最新）
      DELETE FROM plan_task
      WHERE status <> 'DONE'
        AND id NOT IN (
          SELECT MAX(id) FROM plan_task
          WHERE status <> 'DONE'
          GROUP BY horizon, skill_id
        );

      -- 加唯一索引：以后禁止同名
      CREATE UNIQUE INDEX IF NOT EXISTS idx_industry_skill_name_unique ON industry_skill(name);

      DROP TABLE IF EXISTS tmp_g;
      DROP TABLE IF EXISTS name_to_keep;
    "#).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(dup)
}

fn recompute_mastery(conn: &rusqlite::Connection) -> Result<(), String> {
    // 用 SQL 事务（BEGIN/COMMIT）而不是 Rust 的 conn.transaction()，
    // 这样签名保持 &Connection，调用处无需改。
    conn.execute_batch(r#"
      BEGIN;

      -- 基于 note_skill_map 全量聚合，算出每个技能的 mastery（权重×10，上限100）
      WITH agg AS (
        SELECT skill_id, MIN(100, COALESCE(SUM(weight * 10), 0)) AS m
        FROM note_skill_map
        GROUP BY skill_id
      )
      -- 把结果“左联到行业技能”，确保没有映射的技能 mastery=0 也会被写入
      INSERT INTO growth_node (skill_id, mastery)
      SELECT s.id,
             COALESCE(a.m, 0)
      FROM industry_skill s
      LEFT JOIN agg a ON a.skill_id = s.id
      ON CONFLICT(skill_id) DO UPDATE SET mastery = excluded.mastery;

      COMMIT;
    "#).map_err(|e| e.to_string())
}

#[tauri::command]
fn fix_notes_delete_cascade() -> Result<&'static str, String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 用“重建表”方式为 note_skill_map(note_id) 加 ON DELETE CASCADE
    tx.execute_batch(r#"
      PRAGMA foreign_keys=OFF;

      CREATE TABLE IF NOT EXISTS _note_skill_map_new (
        note_id INTEGER NOT NULL,
        skill_id INTEGER NOT NULL,
        weight INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(note_id, skill_id),
        FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY(skill_id) REFERENCES industry_skill(id)
      );

      INSERT OR IGNORE INTO _note_skill_map_new(note_id, skill_id, weight)
      SELECT note_id, skill_id, weight FROM note_skill_map;

      DROP TABLE note_skill_map;
      ALTER TABLE _note_skill_map_new RENAME TO note_skill_map;

      CREATE INDEX IF NOT EXISTS idx_note_skill_note ON note_skill_map(note_id);
      CREATE INDEX IF NOT EXISTS idx_note_skill_skill ON note_skill_map(skill_id);

      PRAGMA foreign_keys=ON;
    "#).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok("ok")
}

#[tauri::command]
fn add_plan_task(
    horizon: String,
    skill_id: Option<i64>,
    title: String,
    minutes: Option<i64>,
    due: Option<String>,
) -> Result<i64, String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 如果绑定了技能，且已存在同 horizon 的“未完成”任务，避免重复
    if let Some(sid) = skill_id {
        let exists: Option<i64> = tx.query_row(
            "SELECT id FROM plan_task
             WHERE horizon=?1 AND skill_id=?2
               AND status<>'DONE'
             LIMIT 1",
            rusqlite::params![&horizon, sid],
            |r| r.get(0),
        ).optional().map_err(|e| e.to_string())?;
        if exists.is_some() {
            return Err(format!("该周期已存在此技能的未完成任务（skill_id={}）。", sid));
        }
    }

    tx.execute(
        "INSERT INTO plan_task (horizon, skill_id, title, minutes, due, status)
         VALUES (?1, ?2, ?3, ?4, ?5, 'TODO')",
        rusqlite::params![
            &horizon,
            &skill_id,
            &title,
            minutes.unwrap_or(60),
            &due
        ],
    ).map_err(|e| e.to_string())?;

    let id = tx.last_insert_rowid();
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

/// 读取 AI 配置：返回 {provider, api_base, api_key, model}
#[tauri::command]
fn get_ai_config() -> Result<HashMap<String, String>, String> {
    let conn = open_db()?;
    let mut out = HashMap::new();
    let keys = ["provider", "api_base", "api_key", "model"];
    for k in keys {
        let v: Option<String> = conn
            .query_row("SELECT val FROM app_kv WHERE key=?1", [k], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(vv) = v { out.insert(k.to_string(), vv); }
    }
    Ok(out)
}

/// 写入 AI 配置：传 {provider?, api_base?, api_key?, model?}，仅更新提供的键
#[tauri::command]
fn set_ai_config(cfg: HashMap<String, String>) -> Result<(), String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (k, v) in cfg {
        tx.execute(
            "INSERT INTO app_kv(key, val) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET val=excluded.val",
            rusqlite::params![k, v],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 冒烟自检（不联外网）：若配置齐全返回 "ok"，否则返回提示字符串
#[tauri::command]
fn ai_smoketest() -> Result<String, String> {
    let cfg = get_ai_config()?;
    let provider = cfg.get("provider").cloned().unwrap_or_default();
    let api_key  = cfg.get("api_key").cloned().unwrap_or_default();
    if provider.is_empty() {
        return Ok("provider is empty".to_string());
    }
    if api_key.is_empty() {
        return Ok("api_key is empty".to_string());
    }
    // 这里先不发请求，之后再接真实 API
    Ok("ok".to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            add_note, search_notes, list_notes, update_note, delete_note,
            export_notes_jsonl, import_notes_jsonl, seed_industry_v1,
            classify_and_update, generate_plan,
            list_plan_tasks, update_plan_status, report_week_summary,
            delete_plan_task, update_plan_task, cleanup_plan_duplicates,
            debug_counts, backfill_growth_nodes, fix_schema_required_level,
            list_skill_gaps, classify_note_embed, fix_skill_name_unique,
            fix_notes_delete_cascade,
            add_plan_task,
            get_ai_config, set_ai_config, ai_smoketest
          ])
          
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
