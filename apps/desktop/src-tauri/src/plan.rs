use chrono::{Duration, Local};
use rusqlite::OptionalExtension;

use crate::db::open_db;
use crate::models::{PlanGroup, PlanTask, PlanTaskOut, WeekReport};

#[tauri::command]
pub fn generate_plan(horizon: String) -> Result<Vec<PlanTaskOut>, String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut out = Vec::new();

    let today = Local::now().date_naive();
    let (slots, step_days) = match horizon.as_str() {
        "QTR" => (12, 7),
        _ => (7, 1),
    };
    let mut assigned = 0usize;

    {
        let mut stmt = tx
            .prepare(
                "SELECT s.id, s.name, s.importance, s.required_level
               FROM industry_skill s
              ORDER BY s.importance DESC, s.required_level DESC
              LIMIT 5",
            )
            .map_err(|e| e.to_string())?;

        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let skill_id: i64 = row.get(0).map_err(|e| e.to_string())?;
            let name: String = row.get(1).map_err(|e| e.to_string())?;
            let importance: i64 = row.get(2).map_err(|e| e.to_string())?;
            let required_level: i64 = row.get(3).map_err(|e| e.to_string())?;
            let gap = required_level;
            if gap <= 0 {
                continue;
            }

            let exists: Option<i64> = tx
                .query_row(
                    "SELECT id FROM plan_task
                  WHERE horizon=?1 AND skill_id=?2
                    AND status<>'DONE'
                  LIMIT 1",
                    rusqlite::params![&horizon, skill_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if exists.is_some() {
                continue;
            }

            let minutes = 60 * importance.min(gap);
            let title = format!("提升{}（差距{}）", name, gap);

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
                        continue;
                    } else {
                        return Err(msg);
                    }
                }
            }
        }
    }

    tx.execute(
        "DELETE FROM plan_task
          WHERE status <> 'DONE'
            AND id NOT IN (
              SELECT MAX(id) FROM plan_task
               WHERE status <> 'DONE'
               GROUP BY horizon, skill_id
            )",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
pub fn list_plan_tasks(
    horizon: Option<String>,
    status: Option<String>,
) -> Result<Vec<PlanTask>, String> {
    let conn = open_db()?;
    let (mut sql, mut args): (String, Vec<(usize, String)>) = (
        "SELECT id, skill_id, title, minutes, due, status, horizon, group_id, parent_id, sort_order, description
           FROM plan_task"
            .to_string(),
        vec![],
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
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(args.iter().map(|(_, v)| v)),
            |row| {
                Ok(PlanTask {
                    id: row.get(0)?,
                    skill_id: row.get(1)?,
                    title: row.get(2)?,
                    minutes: row.get(3)?,
                    due: row.get(4)?,
                    status: row.get(5)?,
                    horizon: row.get(6)?,
                    group_id: row.get(7)?,
                    parent_id: row.get(8)?,
                    sort_order: row.get::<_, Option<i64>>(9)?.unwrap_or(0),
                    description: row.get(10)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn update_plan_status(id: i64, status: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE plan_task SET status=?1 WHERE id=?2",
        rusqlite::params![status, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_plan_task(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM plan_task WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_plan_task(
    id: i64,
    title: String,
    minutes: i64,
    due: Option<String>,
) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE plan_task SET title=?1, minutes=?2, due=?3 WHERE id=?4",
        rusqlite::params![title, minutes, due, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn add_plan_task(
    horizon: String,
    skill_id: Option<i64>,
    title: String,
    minutes: Option<i64>,
    due: Option<String>,
    groupId: Option<i64>,
    parentId: Option<i64>,
    description: Option<String>,
) -> Result<i64, String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    if let Some(sid) = skill_id {
        let exists: Option<i64> = tx
            .query_row(
                "SELECT id FROM plan_task
             WHERE horizon=?1 AND skill_id=?2
               AND status<>'DONE'
             LIMIT 1",
                rusqlite::params![&horizon, sid],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_some() {
            return Err(format!(
                "该周期已存在此技能的未完成任务（skill_id={}）。",
                sid
            ));
        }
    }

    tx.execute(
        "INSERT INTO plan_task (horizon, skill_id, title, minutes, due, status, group_id, parent_id, description)
         VALUES (?1, ?2, ?3, ?4, ?5, 'TODO', ?6, ?7, ?8)",
        rusqlite::params![&horizon, &skill_id, &title, minutes.unwrap_or(60), &due, &groupId, &parentId, &description],
    )
    .map_err(|e| e.to_string())?;

    let id = tx.last_insert_rowid();
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

/// Remove duplicate TODO tasks. Only considers tasks as duplicates when they share
/// the same title, horizon, and due date — preserving intentionally created same-name tasks
/// with different due dates. DONE tasks are never touched.
#[tauri::command]
pub fn cleanup_plan_duplicates(horizon: Option<String>) -> Result<u32, String> {
    let conn = open_db()?;

    let (sql, params): (String, Vec<String>) = if let Some(h) = horizon {
        (
            "DELETE FROM plan_task
              WHERE status = 'TODO'
                AND horizon = ?1
                AND id NOT IN (
                  SELECT MAX(id) FROM plan_task
                   WHERE status = 'TODO' AND horizon = ?1
                   GROUP BY title, horizon, due
                )"
            .to_string(),
            vec![h],
        )
    } else {
        (
            "DELETE FROM plan_task
              WHERE status = 'TODO'
                AND id NOT IN (
                  SELECT MAX(id) FROM plan_task
                   WHERE status = 'TODO'
                   GROUP BY title, horizon, due
                )"
            .to_string(),
            vec![],
        )
    };

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let changed = if params.is_empty() {
        stmt.execute([]).map_err(|e| e.to_string())?
    } else {
        stmt.execute(rusqlite::params![params[0]])
            .map_err(|e| e.to_string())?
    };
    Ok(changed as u32)
}

#[tauri::command]
pub fn report_week_summary() -> Result<WeekReport, String> {
    let conn = open_db()?;

    let end = Local::now().date_naive();
    let start = end - Duration::days(6);
    let start_s = start.format("%Y-%m-%d").to_string();
    let end_s = end.format("%Y-%m-%d").to_string();

    let (tasks_done, minutes_done): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(minutes),0)
           FROM plan_task
          WHERE status='DONE' AND due IS NOT NULL
            AND due >= ?1 AND due <= ?2",
            rusqlite::params![&start_s, &end_s],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let new_notes: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE datetime(created_at) >= datetime(?1 || 'T00:00:00Z')",
            [&start_s],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(WeekReport {
        start: start_s,
        end: end_s,
        tasks_done,
        minutes_done,
        new_notes,
    })
}

#[tauri::command]
pub fn get_plan_goal() -> Result<String, String> {
    let conn = open_db()?;
    Ok(crate::db::kv_get(&conn, "plan_goal")?.unwrap_or_default())
}

#[tauri::command]
pub fn set_plan_goal(goal: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO app_kv(key,val) VALUES('plan_goal',?1)
         ON CONFLICT(key) DO UPDATE SET val=excluded.val",
        rusqlite::params![goal],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn generate_plan_by_range(
    start: String,
    end: String,
    goal: Option<String>,
) -> Result<Vec<PlanTaskOut>, String> {
    use chrono::{Duration, NaiveDate};

    let start_d = NaiveDate::parse_from_str(&start, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let end_d = NaiveDate::parse_from_str(&end, "%Y-%m-%d").map_err(|e| e.to_string())?;
    if end_d < start_d {
        return Err("结束日期必须不小于开始日期".into());
    }

    let days = (end_d - start_d).num_days() + 1;
    let horizon = if days <= 28 {
        "WEEK".to_string()
    } else {
        "QTR".to_string()
    };

    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let picked: Vec<(i64, String, i64, i64)> = {
        let mut stmt = tx
            .prepare(
                "SELECT s.id, s.name, s.importance, s.required_level
               FROM industry_skill s
              ORDER BY s.importance DESC, s.required_level DESC
              LIMIT 5",
            )
            .map_err(|e| e.to_string())?;

        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut tmp = Vec::new();
        while let Some(r) = rows.next().map_err(|e| e.to_string())? {
            let sid: i64 = r.get(0).map_err(|e| e.to_string())?;
            let name: String = r.get(1).map_err(|e| e.to_string())?;
            let imp: i64 = r.get(2).map_err(|e| e.to_string())?;
            let req: i64 = r.get(3).map_err(|e| e.to_string())?;
            if req > 0 {
                tmp.push((sid, name, imp, req));
            }
        }
        tmp
    };

    let mut out: Vec<PlanTaskOut> = Vec::new();

    for (i, (skill_id, name, imp, req)) in picked.iter().enumerate() {
        let exists: Option<i64> = tx
            .query_row(
                "SELECT id FROM plan_task
              WHERE horizon=?1 AND skill_id=?2
                AND status<>'DONE'
              LIMIT 1",
                rusqlite::params![&horizon, skill_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_some() {
            continue;
        }

        let minutes: i64 = 60 * (*imp).min(*req);
        let title = format!("提升{}", name);

        let span = ((days - 1).max(0)) as usize;
        let pos = if picked.len() <= 1 {
            0
        } else {
            (i * span) / (picked.len() - 1)
        };
        let due = start_d + Duration::days(pos as i64);
        let due_s = due.format("%Y-%m-%d").to_string();

        tx.execute(
            "INSERT INTO plan_task (horizon, skill_id, title, minutes, due, status)
             VALUES (?1, ?2, ?3, ?4, ?5, 'TODO')",
            rusqlite::params![&horizon, skill_id, &title, minutes, &due_s],
        )
        .map_err(|e| e.to_string())?;

        let id = tx.last_insert_rowid();
        out.push(PlanTaskOut {
            id,
            skill_id: Some(*skill_id),
            title,
            minutes,
            due: Some(due_s),
            status: "TODO".into(),
        });
    }

    if let Some(g) = goal {
        let g = g.trim().to_string();
        if !g.is_empty() {
            let title = format!("目标：{}", g);
            let due_s = end_d.format("%Y-%m-%d").to_string();
            tx.execute(
                "INSERT INTO plan_task (horizon, skill_id, title, minutes, due, status)
                 VALUES (?1, NULL, ?2, ?3, ?4, 'TODO')",
                rusqlite::params![&horizon, &title, 0_i64, &due_s],
            )
            .map_err(|e| e.to_string())?;

            let id = tx.last_insert_rowid();
            out.push(PlanTaskOut {
                id,
                skill_id: None,
                title,
                minutes: 0,
                due: Some(due_s),
                status: "TODO".into(),
            });
        }
    }

    tx.execute(
        "DELETE FROM plan_task
          WHERE status <> 'DONE'
            AND id NOT IN (
              SELECT MAX(id) FROM plan_task
               WHERE status <> 'DONE'
               GROUP BY horizon, skill_id
            )",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(out)
}

// === AI 版计划生成 ===
#[tauri::command]
pub fn ai_generate_plan_by_range(
    start: String,
    end: String,
    goal: Option<String>,
) -> Result<Vec<PlanTaskOut>, String> {
    use chrono::NaiveDate;

    let start_d = NaiveDate::parse_from_str(&start, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let end_d = NaiveDate::parse_from_str(&end, "%Y-%m-%d").map_err(|e| e.to_string())?;
    if end_d < start_d {
        return Err("结束日期必须不小于开始日期".into());
    }
    let days = (end_d - start_d).num_days() + 1;
    let horizon = if days <= 28 { "WEEK" } else { "QTR" }.to_string();

    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let picked: Vec<(i64, String, i64, i64)> = {
        let mut stmt = tx
            .prepare(
                "SELECT s.id, s.name, s.importance, s.required_level
               FROM industry_skill s
              ORDER BY s.importance DESC, s.required_level DESC
              LIMIT 5",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut tmp = Vec::new();
        while let Some(r) = rows.next().map_err(|e| e.to_string())? {
            let sid: i64 = r.get(0).map_err(|e| e.to_string())?;
            let name: String = r.get(1).map_err(|e| e.to_string())?;
            let imp: i64 = r.get(2).map_err(|e| e.to_string())?;
            let req: i64 = r.get(3).map_err(|e| e.to_string())?;
            if req > 0 {
                tmp.push((sid, name, imp, req));
            }
        }
        tmp
    };

    if picked.is_empty() {
        tx.commit().ok();
        return Ok(vec![]);
    }

    let mut descs = Vec::new();
    for (_sid, name, _imp, req) in &picked {
        descs.push(format!("{}(需求L{})", name, req));
    }
    let desc_str = descs.join("；");
    let goal_str = goal.unwrap_or_default().trim().to_string();

    let cfg = crate::db::read_ai_config(&tx)?;
    let config = crate::ai_client::AiClientConfig::from_map(&cfg).map_err(|e| e.to_string())?;

    let sys_msg = "你是一个成长计划教练，需要根据用户的能力差距和时间范围生成学习任务。\
每条任务必须包含三个字段：title（简洁明了的行动），minutes（一个合理的学习时长，单位分钟，可为 0 表示里程碑），due（任务截止日期，格式 YYYY-MM-DD），并且 due 必须在给定的时间范围内。\
生成的任务应该聚焦于弥补用户的能力差距，每项能力可以有 1~5 个任务，总体任务数量不宜过多。\
输出严格 JSON：{\"tasks\":[{\"title\":\"...\",\"minutes\":45,\"due\":\"2025-10-10\"},...]}，不要任何解释。";
    let user_msg = if goal_str.is_empty() {
        format!(
            "能力差距列表：{}。时间范围：{} 到 {}。请生成对应的任务。",
            desc_str, start, end
        )
    } else {
        format!(
            "能力差距列表：{}。时间范围：{} 到 {}。总目标：{}。请生成对应的任务。",
            desc_str, start, end, goal_str
        )
    };

    let messages = vec![
        serde_json::json!({"role": "system", "content": sys_msg}),
        serde_json::json!({"role": "user", "content": user_msg}),
    ];

    let content = crate::ai_client::chat_json(&config, messages, 0.3).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("AI JSON 解析失败: {}", e))?;
    let tasks = parsed["tasks"]
        .as_array()
        .ok_or("AI 未返回 tasks 数组".to_string())?;

    let mut result: Vec<PlanTaskOut> = Vec::new();
    for item in tasks {
        let title = item["title"].as_str().unwrap_or("").trim().to_string();
        let minutes = item["minutes"].as_i64().unwrap_or(0).max(0);
        let due = item["due"].as_str().unwrap_or("").trim().to_string();
        if title.is_empty() || due.is_empty() {
            continue;
        }
        let mut skill_id: Option<i64> = None;
        for (sid, name, _imp, _req) in &picked {
            if title.to_lowercase().contains(&name.to_lowercase()) {
                skill_id = Some(*sid);
                break;
            }
        }
        tx.execute(
            "INSERT INTO plan_task (horizon, skill_id, title, minutes, due, status)
             VALUES (?1, ?2, ?3, ?4, ?5, 'TODO')",
            rusqlite::params![&horizon, &skill_id, &title, &minutes, &due],
        )
        .map_err(|e| e.to_string())?;
        let id = tx.last_insert_rowid();
        result.push(PlanTaskOut {
            id,
            skill_id,
            title,
            minutes,
            due: Some(due.clone()),
            status: "TODO".into(),
        });
    }
    if !goal_str.is_empty() {
        let title = format!("目标：{}", goal_str);
        let due_s = end_d.format("%Y-%m-%d").to_string();
        tx.execute(
            "INSERT INTO plan_task (horizon, skill_id, title, minutes, due, status)
             VALUES (?1, NULL, ?2, ?3, ?4, 'TODO')",
            rusqlite::params![&horizon, &title, 0_i64, &due_s],
        )
        .map_err(|e| e.to_string())?;
        let id = tx.last_insert_rowid();
        result.push(PlanTaskOut {
            id,
            skill_id: None,
            title,
            minutes: 0,
            due: Some(due_s.clone()),
            status: "TODO".into(),
        });
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

// === Plan Group CRUD ===

#[tauri::command]
pub fn create_plan_group(name: String, color: Option<String>) -> Result<PlanGroup, String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO plan_group (name, color) VALUES (?1, ?2)",
        rusqlite::params![&name, &color],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    let created_at: String = conn
        .query_row("SELECT created_at FROM plan_group WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    Ok(PlanGroup {
        id,
        name,
        color,
        sort_order: 0,
        created_at,
    })
}

#[tauri::command]
pub fn list_plan_groups() -> Result<Vec<PlanGroup>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT id, name, color, sort_order, created_at FROM plan_group ORDER BY sort_order ASC, id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PlanGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                sort_order: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                created_at: row.get(4)?,
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
pub fn update_plan_group(id: i64, name: String, color: Option<String>) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE plan_group SET name=?1, color=?2 WHERE id=?3",
        rusqlite::params![&name, &color, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_plan_group(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM plan_group WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 按月列出任务（包含该月所有 due 在指定范围的任务）
#[tauri::command]
pub fn list_plan_tasks_by_month(year: i32, month: u32) -> Result<Vec<PlanTask>, String> {
    let conn = open_db()?;
    let start = format!("{:04}-{:02}-01", year, month);
    let end = if month == 12 {
        format!("{:04}-01-01", year + 1)
    } else {
        format!("{:04}-{:02}-01", year, month + 1)
    };

    let mut stmt = conn
        .prepare(
            "SELECT id, skill_id, title, minutes, due, status, horizon, group_id, parent_id, sort_order, description
               FROM plan_task
              WHERE due >= ?1 AND due < ?2
              ORDER BY due ASC, sort_order ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![&start, &end], |row| {
            Ok(PlanTask {
                id: row.get(0)?,
                skill_id: row.get(1)?,
                title: row.get(2)?,
                minutes: row.get(3)?,
                due: row.get(4)?,
                status: row.get(5)?,
                horizon: row.get(6)?,
                group_id: row.get(7)?,
                parent_id: row.get(8)?,
                sort_order: row.get::<_, Option<i64>>(9)?.unwrap_or(0),
                description: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}
