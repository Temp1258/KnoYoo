use chrono::Local;
use rusqlite::OptionalExtension;

use crate::db::open_db;

// ============================================================
// 1. Activity Log + Learning Streak — 学习连续打卡
// ============================================================

#[derive(serde::Serialize)]
pub struct StreakInfo {
    /// Current consecutive days
    pub current_streak: i64,
    /// Longest ever streak
    pub best_streak: i64,
    /// Total active days
    pub total_active_days: i64,
    /// Whether user has been active today
    pub active_today: bool,
}

/// Record today's activity (idempotent — safe to call multiple times)
#[tauri::command]
pub fn record_activity() -> Result<(), String> {
    let conn = open_db()?;
    let today = Local::now().format("%Y-%m-%d").to_string();
    conn.execute(
        "INSERT OR IGNORE INTO activity_log(date) VALUES(?1)",
        rusqlite::params![&today],
    )
    .map_err(|e| e.to_string())?;

    // Update best_streak in app_kv
    let info = compute_streak(&conn)?;
    let best_stored: i64 = crate::db::kv_get(&conn, "best_streak")?
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    if info.current_streak > best_stored {
        conn.execute(
            "INSERT INTO app_kv(key, val) VALUES('best_streak', ?1)
             ON CONFLICT(key) DO UPDATE SET val=excluded.val",
            rusqlite::params![info.current_streak.to_string()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Get streak information
#[tauri::command]
pub fn get_streak_info() -> Result<StreakInfo, String> {
    let conn = open_db()?;
    compute_streak(&conn)
}

fn compute_streak(conn: &rusqlite::Connection) -> Result<StreakInfo, String> {
    let today = Local::now().date_naive();
    let today_s = today.format("%Y-%m-%d").to_string();

    // Check if active today
    let active_today: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM activity_log WHERE date=?1",
            [&today_s],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        > 0;

    // Total active days
    let total_active_days: i64 = conn
        .query_row("SELECT COUNT(*) FROM activity_log", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    // Compute current streak: count consecutive days backwards from today/yesterday
    let mut streak = 0i64;
    let start = if active_today { today } else { today - chrono::Duration::days(1) };

    let mut check_date = start;
    loop {
        let ds = check_date.format("%Y-%m-%d").to_string();
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM activity_log WHERE date=?1",
                [&ds],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?
            > 0;
        if exists {
            streak += 1;
            check_date -= chrono::Duration::days(1);
        } else {
            break;
        }
    }

    let best_stored: i64 = crate::db::kv_get(conn, "best_streak")?
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let best_streak = best_stored.max(streak);

    Ok(StreakInfo {
        current_streak: streak,
        best_streak,
        total_active_days,
        active_today,
    })
}

// ============================================================
// 2. Ollama Auto-detect — 检测本地 Ollama 是否运行
// ============================================================

#[derive(serde::Serialize)]
pub struct OllamaStatus {
    pub running: bool,
    pub models: Vec<String>,
}

/// Check if Ollama is running locally and list available models
#[tauri::command]
pub fn detect_ollama() -> Result<OllamaStatus, String> {
    // Try to connect to Ollama's default endpoint
    let resp = ureq::get("http://localhost:11434/api/tags")
        .timeout(std::time::Duration::from_secs(2))
        .call();

    match resp {
        Ok(r) if r.status() == 200 => {
            let body: serde_json::Value = r.into_json().unwrap_or_default();
            let models = body["models"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            Ok(OllamaStatus {
                running: true,
                models,
            })
        }
        _ => Ok(OllamaStatus {
            running: false,
            models: vec![],
        }),
    }
}

/// Auto-configure Ollama as the AI provider if running
#[tauri::command]
pub fn auto_configure_ollama(model: String) -> Result<(), String> {
    let conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let pairs = [
        ("provider", "ollama"),
        ("api_base", "http://localhost:11434"),
        ("api_key", "ollama"),
    ];
    for (k, v) in pairs {
        tx.execute(
            "INSERT INTO app_kv(key, val) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET val=excluded.val",
            rusqlite::params![k, v],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT INTO app_kv(key, val) VALUES('model', ?1)
         ON CONFLICT(key) DO UPDATE SET val=excluded.val",
        rusqlite::params![model],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================
// 3. Daily Coaching Tip — 每日教练小贴士
// ============================================================

/// Generate a quick daily coaching tip (non-AI fallback available)
#[tauri::command]
pub fn get_daily_tip() -> Result<String, String> {
    let conn = open_db()?;

    // Check if we already generated a tip today
    let today = Local::now().format("%Y-%m-%d").to_string();
    let cached_key = format!("daily_tip_{}", today);
    if let Some(cached) = crate::db::kv_get(&conn, &cached_key)? {
        return Ok(cached);
    }

    // Gather context for tip
    let career_goal = crate::db::kv_get(&conn, "career_goal")?.unwrap_or_default();
    let streak_info = compute_streak(&conn)?;

    let pending_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM plan_task WHERE status='TODO'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let overdue_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM plan_task WHERE status='TODO' AND due IS NOT NULL AND due < ?1",
            [&today],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Try AI tip
    let cfg = crate::db::read_ai_config(&conn)?;
    let api_base = cfg.get("api_base").cloned().unwrap_or_default();
    let api_key = cfg.get("api_key").cloned().unwrap_or_default();
    let model = cfg
        .get("model")
        .cloned()
        .unwrap_or_else(|| crate::models::DEFAULT_MODEL.to_string());

    let tip = if !api_base.trim().is_empty() && !api_key.trim().is_empty() {
        let url = format!("{}/v1/chat/completions", api_base.trim_end_matches('/'));
        let sys = "你是一个温暖的职业成长教练。用一句话给用户今日鼓励或建议。简短有力，不超过50字。用中文。";
        let user_msg = format!(
            "职业目标: {}\n连续学习: {}天\n待办任务: {}项\n逾期任务: {}项",
            if career_goal.is_empty() { "未设置" } else { &career_goal },
            streak_info.current_streak,
            pending_count,
            overdue_count,
        );

        let payload = serde_json::json!({
            "model": model,
            "temperature": 0.7,
            "max_tokens": 100,
            "messages": [
                {"role": "system", "content": sys},
                {"role": "user", "content": user_msg}
            ]
        });

        let resp = ureq::post(&url)
            .set("Authorization", &format!("Bearer {}", api_key))
            .set("Content-Type", "application/json")
            .send_json(payload);

        match resp {
            Ok(r) if r.status() < 300 => {
                let body: crate::models::ChatCompletionResponse =
                    r.into_json().unwrap_or_else(|_| crate::models::ChatCompletionResponse {
                        choices: vec![],
                    });
                body.choices
                    .first()
                    .and_then(|c| c.message.content.clone())
                    .unwrap_or_else(|| fallback_tip(&streak_info, pending_count, overdue_count))
            }
            _ => fallback_tip(&streak_info, pending_count, overdue_count),
        }
    } else {
        fallback_tip(&streak_info, pending_count, overdue_count)
    };

    // Cache the tip for today
    conn.execute(
        "INSERT INTO app_kv(key, val) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET val=excluded.val",
        rusqlite::params![&cached_key, &tip],
    )
    .map_err(|e| e.to_string())?;

    Ok(tip)
}

fn fallback_tip(streak: &StreakInfo, pending: i64, overdue: i64) -> String {
    if overdue > 0 {
        format!("你有 {} 项逾期任务，今天先处理最紧急的那个吧!", overdue)
    } else if streak.current_streak >= 7 {
        format!(
            "太棒了! 你已经连续学习 {} 天，保持这股劲头!",
            streak.current_streak
        )
    } else if streak.current_streak > 0 {
        format!(
            "连续学习第 {} 天，今天也要加油哦!",
            streak.current_streak + 1
        )
    } else if pending > 0 {
        format!("你有 {} 项待办任务等你完成，选一个最感兴趣的开始吧!", pending)
    } else {
        "新的一天，新的开始! 记录一条学习笔记吧。".to_string()
    }
}

// ============================================================
// 4. Skill Analytics — 技能雷达图数据 + 综合统计
// ============================================================

#[derive(serde::Serialize)]
pub struct SkillRadarItem {
    pub name: String,
    pub progress: f64,
    pub importance: i64,
}

#[derive(serde::Serialize)]
pub struct LearningStats {
    /// Top-level skill progress for radar chart
    pub radar: Vec<SkillRadarItem>,
    /// Total skills count
    pub total_skills: i64,
    /// Skills with progress > 0
    pub active_skills: i64,
    /// Skills with progress >= 0.8
    pub mastered_skills: i64,
    /// Average progress across all skills
    pub avg_progress: f64,
    /// Total learning minutes this month
    pub monthly_minutes: i64,
    /// Total notes count
    pub total_notes: i64,
    /// Overall completion percentage (mastered / total top-level)
    pub completion_pct: f64,
}

/// Get comprehensive learning statistics + radar chart data
#[tauri::command]
pub fn get_learning_stats() -> Result<LearningStats, String> {
    let conn = open_db()?;

    // Get top-level skills (children of root nodes) with progress
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                s.name,
                s.importance,
                COALESCE(t.done, 0) as done_tasks,
                COALESCE(t.total, 0) as total_tasks,
                COALESCE(n.cnt, 0) as note_count
            FROM industry_skill s
            INNER JOIN industry_skill root ON s.parent_id = root.id AND root.parent_id IS NULL
            LEFT JOIN (
                SELECT skill_id,
                       COUNT(*) as total,
                       SUM(CASE WHEN status='DONE' THEN 1 ELSE 0 END) as done
                FROM plan_task WHERE skill_id IS NOT NULL GROUP BY skill_id
            ) t ON t.skill_id = s.id
            LEFT JOIN (
                SELECT skill_id, COUNT(*) as cnt
                FROM note_skill_map GROUP BY skill_id
            ) n ON n.skill_id = s.id
            ORDER BY s.importance DESC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let mut radar = Vec::new();
    let mut total_skills: i64 = 0;
    let mut active_skills: i64 = 0;
    let mut mastered_skills: i64 = 0;
    let mut sum_progress: f64 = 0.0;

    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let name: String = row.get(0).map_err(|e| e.to_string())?;
        let importance: i64 = row.get(1).map_err(|e| e.to_string())?;
        let done: i64 = row.get(2).map_err(|e| e.to_string())?;
        let total: i64 = row.get(3).map_err(|e| e.to_string())?;
        let notes: i64 = row.get(4).map_err(|e| e.to_string())?;

        let task_progress = if total > 0 {
            done as f64 / total as f64
        } else {
            0.0
        };
        let note_signal = (notes as f64 / 5.0).min(1.0);
        let progress = (task_progress * 0.7 + note_signal * 0.3).min(1.0);

        total_skills += 1;
        sum_progress += progress;
        if progress > 0.0 {
            active_skills += 1;
        }
        if progress >= 0.8 {
            mastered_skills += 1;
        }

        radar.push(SkillRadarItem {
            name,
            progress,
            importance,
        });
    }
    drop(rows);
    drop(stmt);

    // Limit radar to top 8 skills by importance
    radar.truncate(8);

    let avg_progress = if total_skills > 0 {
        sum_progress / total_skills as f64
    } else {
        0.0
    };

    // Monthly minutes
    let month_start = Local::now()
        .date_naive()
        .format("%Y-%m-01")
        .to_string();
    let monthly_minutes: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(minutes), 0) FROM plan_task WHERE status='DONE' AND due >= ?1",
            [&month_start],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Total notes
    let total_notes: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let completion_pct = if total_skills > 0 {
        mastered_skills as f64 / total_skills as f64
    } else {
        0.0
    };

    Ok(LearningStats {
        radar,
        total_skills,
        active_skills,
        mastered_skills,
        avg_progress,
        monthly_minutes,
        total_notes,
        completion_pct,
    })
}

// ============================================================
// 5. Template Export/Import — 技能树模板导出导入
// ============================================================

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ExportedTemplate {
    pub name: String,
    pub career_goal: String,
    pub skills: Vec<ExportedSkill>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ExportedSkill {
    pub name: String,
    pub importance: i64,
    pub children: Vec<String>,
}

/// Export current skill tree as a shareable JSON template
#[tauri::command]
pub fn export_skill_template() -> Result<String, String> {
    let conn = open_db()?;
    let career_goal = crate::db::kv_get(&conn, "career_goal")?.unwrap_or_default();

    // Find root nodes
    let mut root_stmt = conn
        .prepare("SELECT id, name FROM industry_skill WHERE parent_id IS NULL")
        .map_err(|e| e.to_string())?;
    let mut root_rows = root_stmt.query([]).map_err(|e| e.to_string())?;

    let mut root_name = String::new();
    let mut root_id: Option<i64> = None;

    if let Some(row) = root_rows.next().map_err(|e| e.to_string())? {
        root_id = Some(row.get(0).map_err(|e| e.to_string())?);
        root_name = row.get(1).map_err(|e| e.to_string())?;
    }
    drop(root_rows);
    drop(root_stmt);

    let rid = root_id.ok_or("没有技能树可导出")?;

    // Get category skills (children of root)
    let mut cat_stmt = conn
        .prepare("SELECT id, name, importance FROM industry_skill WHERE parent_id=?1 ORDER BY importance DESC")
        .map_err(|e| e.to_string())?;
    let mut cat_rows = cat_stmt.query(rusqlite::params![rid]).map_err(|e| e.to_string())?;

    let mut skills = Vec::new();
    let mut cat_ids = Vec::new();

    while let Some(row) = cat_rows.next().map_err(|e| e.to_string())? {
        let cat_id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let name: String = row.get(1).map_err(|e| e.to_string())?;
        let importance: i64 = row.get(2).map_err(|e| e.to_string())?;
        cat_ids.push((cat_id, name, importance));
    }
    drop(cat_rows);
    drop(cat_stmt);

    for (cat_id, name, importance) in cat_ids {
        let mut child_stmt = conn
            .prepare("SELECT name FROM industry_skill WHERE parent_id=?1 ORDER BY id")
            .map_err(|e| e.to_string())?;
        let mut child_rows = child_stmt
            .query(rusqlite::params![cat_id])
            .map_err(|e| e.to_string())?;
        let mut children = Vec::new();
        while let Some(row) = child_rows.next().map_err(|e| e.to_string())? {
            let cn: String = row.get(0).map_err(|e| e.to_string())?;
            children.push(cn);
        }
        skills.push(ExportedSkill {
            name,
            importance,
            children,
        });
    }

    let template = ExportedTemplate {
        name: root_name,
        career_goal,
        skills,
    };

    serde_json::to_string_pretty(&template).map_err(|e| e.to_string())
}

/// Import a skill tree from a JSON template string
#[tauri::command]
pub fn import_skill_template(json_str: String) -> Result<Vec<crate::models::IndustryNode>, String> {
    let template: ExportedTemplate =
        serde_json::from_str(&json_str).map_err(|e| format!("JSON 解析失败: {e}"))?;

    if template.skills.is_empty() {
        return Err("模板中没有技能数据".into());
    }

    let mut conn = open_db()?;
    conn.execute("PRAGMA foreign_keys = ON;", [])
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Create root
    tx.execute(
        "INSERT OR IGNORE INTO industry_skill (name, parent_id, required_level, importance) VALUES (?1, NULL, 100, 1.0)",
        rusqlite::params![&template.name],
    )
    .map_err(|e| e.to_string())?;
    let root_id: i64 = tx
        .query_row(
            "SELECT id FROM industry_skill WHERE name=?1 AND parent_id IS NULL",
            [&template.name],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    for skill in &template.skills {
        tx.execute(
            "INSERT OR IGNORE INTO industry_skill (name, parent_id, required_level, importance) VALUES (?1, ?2, 3, ?3)",
            rusqlite::params![&skill.name, root_id, skill.importance],
        )
        .map_err(|e| e.to_string())?;

        let skill_id: i64 = tx
            .query_row(
                "SELECT id FROM industry_skill WHERE name=?1 AND parent_id=?2",
                rusqlite::params![&skill.name, root_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;

        for child in &skill.children {
            tx.execute(
                "INSERT OR IGNORE INTO industry_skill (name, parent_id, required_level, importance) VALUES (?1, ?2, 3, 3)",
                rusqlite::params![child, skill_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Save career goal
    if !template.career_goal.is_empty() {
        tx.execute(
            "INSERT INTO app_kv(key, val) VALUES('career_goal', ?1)
             ON CONFLICT(key) DO UPDATE SET val=excluded.val",
            rusqlite::params![&template.career_goal],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    crate::tree::list_industry_tree_v1()
}
