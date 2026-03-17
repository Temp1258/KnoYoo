use rusqlite::{params, OptionalExtension};
use std::collections::{HashMap, HashSet};

use crate::db::{kv_get, open_db};
use crate::models::{IndustryNode, SavedTreeRow, SkillNote};

/// 列出完整的行业技能树。
#[tauri::command]
pub fn list_industry_tree_v1() -> Result<Vec<IndustryNode>, String> {
    let conn = open_db().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT s.id, s.parent_id, s.name, s.required_level, s.importance
            FROM industry_skill s
            ORDER BY COALESCE(s.parent_id, -1), s.id
            "#,
        )
        .map_err(|e| e.to_string())?;

    #[derive(Clone)]
    struct TmpNode {
        parent_id: Option<i64>,
        node: IndustryNode,
    }

    let mut tmp: Vec<TmpNode> = Vec::new();

    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let parent_id: Option<i64> = row.get(1).map_err(|e| e.to_string())?;
        let name: String = row.get(2).map_err(|e| e.to_string())?;
        let required_level: i64 = row.get(3).map_err(|e| e.to_string())?;
        let importance: f64 = row.get::<_, f64>(4).map_err(|e| e.to_string())?;

        tmp.push(TmpNode {
            parent_id,
            node: IndustryNode {
                id,
                name,
                required_level,
                importance,
                children: Vec::new(),
            },
        });
    }

    let mut bucket: HashMap<i64, Vec<IndustryNode>> = HashMap::new();
    let mut roots: Vec<IndustryNode> = Vec::new();

    for t in tmp.into_iter() {
        match t.parent_id {
            Some(pid) => bucket.entry(pid).or_default().push(t.node),
            None => roots.push(t.node),
        }
    }

    fn fill_children(node: &mut IndustryNode, bucket: &mut HashMap<i64, Vec<IndustryNode>>) {
        if let Some(mut kids) = bucket.remove(&node.id) {
            for k in kids.iter_mut() {
                fill_children(k, bucket);
            }
            node.children = kids;
        }
    }
    for r in roots.iter_mut() {
        fill_children(r, &mut bucket);
    }

    Ok(roots)
}

/// 获取与某个技能关联的笔记列表。
#[tauri::command]
pub fn list_skill_notes_v1(
    skill_id: i64,
    limit: Option<i64>,
) -> Result<Vec<SkillNote>, String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(50);

    let mut stmt = conn
        .prepare(
            r#"
            SELECT n.id, n.title, COALESCE(n.created_at, ''), SUBSTR(n.content, 1, 100) as snippet
            FROM note_skill_map m
            JOIN notes n ON n.id = m.note_id
            WHERE m.skill_id = ?
            ORDER BY n.created_at DESC
            LIMIT ?
            "#,
        )
        .map_err(|e| e.to_string())?;

    let mut out: Vec<SkillNote> = Vec::new();
    let mut rows = stmt
        .query(rusqlite::params![skill_id, lim])
        .map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let title: String = row.get(1).map_err(|e| e.to_string())?;
        let created_at: String = row.get(2).map_err(|e| e.to_string())?;
        let snippet: Option<String> = row.get(3).map_err(|e| e.to_string())?;

        out.push(SkillNote {
            id,
            title,
            created_at,
            snippet,
        });
    }
    if out.is_empty() {
        tracing::debug!("no notes found for skill_id={}", skill_id);
    }
    Ok(out)
}

/// 保存一个自定义根节点（行业或技能）并返回其 id。
#[tauri::command]
pub fn save_custom_root_v1(name: String) -> Result<i64, String> {
    let mut conn = open_db().map_err(|e| e.to_string())?;
    conn.execute("PRAGMA foreign_keys = ON;", [])
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| format!("begin tx: {e}"))?;

    let mut sel = tx
        .prepare("SELECT id FROM industry_skill WHERE name=?1 AND parent_id IS NULL")
        .map_err(|e| e.to_string())?;

    let id_opt = sel
        .query_row(params![name], |r| r.get::<_, i64>(0))
        .optional()
        .map_err(|e| e.to_string())?;

    drop(sel);

    if let Some(id) = id_opt {
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(id);
    }

    tx.execute(
        "INSERT INTO industry_skill (name, parent_id, required_level, importance) VALUES (?1, NULL, 100, 1.0)",
        params![name]
    ).map_err(|e| format!("insert root '{name}': {e}"))?;
    let id = tx.last_insert_rowid();

    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn list_root_nodes_v1() -> Result<Vec<IndustryNode>, String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, required_level, importance
            FROM industry_skill
            WHERE parent_id IS NULL AND required_level=100 AND importance=1.0
            ORDER BY id DESC",
        )
        .map_err(|e| e.to_string())?;
    let mut roots = Vec::new();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        roots.push(IndustryNode {
            id: row.get(0).map_err(|e| e.to_string())?,
            name: row.get(1).map_err(|e| e.to_string())?,
            required_level: row.get(2).map_err(|e| e.to_string())?,
            importance: row.get::<_, f64>(3).map_err(|e| e.to_string())?,
            children: Vec::new(),
        });
    }
    Ok(roots)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_root_and_subtree_v1(rootId: i64) -> Result<(), String> {
    let mut conn = open_db().map_err(|e| e.to_string())?;
    conn.execute("PRAGMA foreign_keys = ON;", [])
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| format!("begin tx: {e}"))?;

    let mut all_ids = crate::db::collect_subtree_ids(&tx, rootId)?;
    crate::db::delete_subtree_by_ids(&tx, &mut all_ids)?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_all_roots_v1() -> Result<u32, String> {
    let mut conn = open_db().map_err(|e| e.to_string())?;
    conn.execute("PRAGMA foreign_keys = ON;", [])
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| format!("begin tx: {e}"))?;

    let mut ids = Vec::<i64>::new();
    {
        let mut s = tx
            .prepare(
                "SELECT id FROM industry_skill
                 WHERE parent_id IS NULL AND required_level=100 AND importance=1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = s.query([]).map_err(|e| e.to_string())?;
        while let Some(r) = rows.next().map_err(|e| e.to_string())? {
            ids.push(r.get::<_, i64>(0).map_err(|e| e.to_string())?);
        }
    }

    for root in ids.iter() {
        let mut all = crate::db::collect_subtree_ids(&tx, *root)?;
        crate::db::delete_subtree_by_ids(&tx, &mut all)?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(ids.len() as u32)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn ai_expand_node_v2(
    name: String,
    parentId: Option<i64>,
    limit: Option<i64>,
    pathNames: Option<Vec<String>>,
) -> Result<Vec<IndustryNode>, String> {
    let mut conn = open_db().map_err(|e| e.to_string())?;

    let get_kv = |key: &str| -> Result<Option<String>, String> {
        kv_get(&conn, key)
    };

    let api_base = get_kv("api_base")?
        .ok_or_else(|| "缺少 app_kv['api_base']，请在 AI 设置 里配置".to_string())?;
    let api_key = get_kv("api_key")?
        .ok_or_else(|| "缺少 app_kv['api_key']，请在 AI 设置 里配置".to_string())?;

    let max_n = limit.unwrap_or(0);
    let prompt = if let Some(ref path) = pathNames {
        let path_str = path.join("\u{2192}");
        if max_n > 0 {
            format!(
                "请根据\"{}\"这个技能路径，返回它最重要的最多{}个更具体的技能点名称。\
只能返回 JSON：{{\"skills\": [\"...\", ...]}}，不要任何解释。",
                path_str, max_n
            )
        } else {
            format!(
                "请根据\"{}\"这个技能路径，返回它更具体的技能点名称。\
只能返回 JSON：{{\"skills\": [\"...\", ...]}}，不要任何解释。",
                path_str
            )
        }
    } else {
        let top_k = if max_n > 0 {
            max_n.clamp(1, 10)
        } else {
            0
        };
        if top_k > 0 {
            format!(
                "请根据\"{}\"这个职业/技能，返回它最重要的最多{}个技能点名称。\
只能返回 JSON：{{\"skills\": [\"...\", ...]}}，不要任何解释。",
                name, top_k
            )
        } else {
            format!(
                "请根据\"{}\"这个职业/技能，返回它更具体的技能点名称。\
只能返回 JSON：{{\"skills\": [\"...\", ...]}}，不要任何解释。",
                name
            )
        }
    };

    let endpoint = format!("{}/v1/chat/completions", api_base.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": get_kv("model")?.unwrap_or_else(|| crate::models::DEFAULT_MODEL.to_string()),
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": "你是一个技能扩展助手，只能输出严格 JSON。" },
            { "role": "user",   "content": prompt }
        ],
        "response_format": { "type": "json_object" }
    });

    let resp = ureq::post(&endpoint)
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", "application/json")
        .send_json(body)
        .map_err(|e| format!("调用 AI 接口失败：{e}"))?;

    let resp_body: crate::models::ChatCompletionResponse = resp
        .into_json()
        .map_err(|e| format!("解析 AI 响应失败：{e}"))?;
    let content_str = resp_body.choices.first()
        .and_then(|c| c.message.content.as_deref())
        .ok_or("AI 未返回有效内容")?;

    let payload: serde_json::Value = serde_json::from_str(content_str)
        .unwrap_or_else(|_| serde_json::json!({}));

    let mut skills: Vec<String> = Vec::new();
    if let Some(arr) = payload.get("skills").and_then(|x| x.as_array()) {
        for it in arr {
            if let Some(s) = it.as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    skills.push(t.to_string());
                }
            }
        }
    }
    if skills.is_empty() {
        return Err(
            "AI 未返回有效的 skills，请检查接口响应格式（应为 {\"skills\":[...]})".into(),
        );
    }

    if let Some(ref path) = pathNames {
        let lower_path: Vec<String> = path.iter().map(|s| s.trim().to_lowercase()).collect();
        skills.retain(|s| {
            let ls = s.trim().to_lowercase();
            !lower_path.contains(&ls)
        });
    }
    let mut seen = HashSet::<String>::new();
    skills.retain(|s| {
        let t = s.trim().to_string();
        if seen.contains(&t.to_lowercase()) {
            false
        } else {
            seen.insert(t.to_lowercase());
            true
        }
    });

    tracing::info!("AI expand: parent={}, got {} skills", name, skills.len());

    conn.execute("PRAGMA foreign_keys = ON;", [])
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| format!("begin tx: {e}"))?;

    let ensure_skill =
        |tx: &rusqlite::Transaction, nm: &str, p: Option<i64>| -> Result<i64, String> {
            let (req, imp): (i64, i64) = if p.is_none() { (100, 1) } else { (3, 3) };
            let mut sel = tx
                .prepare(
                    "SELECT id FROM industry_skill
                      WHERE name=?1 AND ( (parent_id IS NULL AND ?2 IS NULL) OR parent_id=?2 )",
                )
                .map_err(|e| e.to_string())?;
            if let Some(id) = sel
                .query_row(params![nm, p], |r| r.get::<_, i64>(0))
                .optional()
                .map_err(|e| e.to_string())?
            {
                return Ok(id);
            }
            tx.execute(
                "INSERT INTO industry_skill(name, parent_id, required_level, importance)
                 VALUES (?1, ?2, ?3, ?4)",
                params![nm, p, req, imp],
            )
            .map_err(|e| format!("insert industry_skill '{nm}': {e}"))?;
            let id = tx.last_insert_rowid();
            Ok(id)
        };

    let parent_id = if let Some(pid) = parentId {
        pid
    } else {
        ensure_skill(&tx, &name, None)?
    };
    for s in skills.iter() {
        ensure_skill(&tx, s, Some(parent_id))?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    list_industry_tree_v1()
}

/// 保存当前行业树为快照
#[tauri::command]
pub fn save_industry_tree_v1(name: String) -> Result<i64, String> {
    let trees = list_industry_tree_v1()?;
    let json = serde_json::to_string(&trees).map_err(|e| e.to_string())?;
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO saved_industry_tree (name, data) VALUES (?1, ?2)",
        rusqlite::params![name, json],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(id)
}

/// 列出所有已保存的行业树概要（按保存时间倒序）
#[tauri::command]
pub fn list_saved_industry_trees_v1() -> Result<Vec<SavedTreeRow>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM saved_industry_tree ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut out = Vec::<SavedTreeRow>::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        out.push(SavedTreeRow {
            id: row.get(0).map_err(|e| e.to_string())?,
            name: row.get(1).map_err(|e| e.to_string())?,
            created_at: row.get(2).map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

/// 读取指定 ID 的行业树
#[tauri::command]
pub fn get_saved_industry_tree_v1(id: i64) -> Result<Vec<IndustryNode>, String> {
    let conn = open_db()?;
    let json: String = conn
        .query_row(
            "SELECT data FROM saved_industry_tree WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let tree: Vec<IndustryNode> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(tree)
}

/// 删除指定 ID 的行业树快照
#[tauri::command]
pub fn delete_saved_industry_tree_v1(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "DELETE FROM saved_industry_tree WHERE id=?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn seed_industry_v1() -> Result<u32, String> {
    let skills: Vec<(Option<i64>, &'static str, i64, i64)> = vec![
        (None, "数据分析", 1, 5),
        (None, "机器学习", 1, 5),
        (None, "深度学习", 1, 4),
        (None, "数据工程", 1, 4),
        (None, "AI 产品", 1, 4),
        (None, "大模型", 1, 4),
        (None, "Prompt 工程", 1, 3),
        (None, "数据可视化", 1, 3),
        (None, "数据治理", 1, 3),
        (None, "NLP", 1, 3),
        (None, "CV", 1, 3),
        (None, "推荐系统", 1, 3),
        (None, "知识图谱", 1, 2),
        (None, "AI 安全", 1, 2),
        (None, "AI 法律伦理", 1, 2),
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
