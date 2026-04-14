use serde::{Deserialize, Serialize};

use crate::clips::{row_to_clip, WebClip};
use crate::db::open_db;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub color: String,
    pub filter_rule: String,
    pub clip_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_collection(row: &rusqlite::Row) -> rusqlite::Result<Collection> {
    Ok(Collection {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        icon: row.get("icon")?,
        color: row.get("color")?,
        filter_rule: row.get("filter_rule")?,
        clip_count: row.get("clip_count")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[tauri::command]
pub fn create_collection(
    name: String,
    description: Option<String>,
    icon: Option<String>,
    color: Option<String>,
) -> Result<Collection, String> {
    let conn = open_db()?;
    let desc = description.unwrap_or_default();
    let icon = icon.unwrap_or_else(|| "folder".to_string());
    let color = color.unwrap_or_else(|| "#6b7280".to_string());

    conn.execute(
        "INSERT INTO collections (name, description, icon, color) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![name, desc, icon, color],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT c.*, 0 AS clip_count FROM collections c WHERE c.id = ?1",
        [id],
        row_to_collection,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_collection(
    id: i64,
    name: Option<String>,
    description: Option<String>,
    icon: Option<String>,
    color: Option<String>,
) -> Result<Collection, String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if let Some(ref n) = name {
        tx.execute(
            "UPDATE collections SET name = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
            rusqlite::params![n, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(ref d) = description {
        tx.execute(
            "UPDATE collections SET description = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
            rusqlite::params![d, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(ref i) = icon {
        tx.execute(
            "UPDATE collections SET icon = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
            rusqlite::params![i, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(ref c) = color {
        tx.execute(
            "UPDATE collections SET color = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
            rusqlite::params![c, id],
        )
        .map_err(|e| e.to_string())?;
    }
    let collection = tx
        .query_row(
            "SELECT c.*, COALESCE(cnt.n, 0) AS clip_count
             FROM collections c
             LEFT JOIN (SELECT collection_id, COUNT(*) AS n FROM collection_clips GROUP BY collection_id) cnt
               ON cnt.collection_id = c.id
             WHERE c.id = ?1",
            [id],
            row_to_collection,
        )
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(collection)
}

#[tauri::command]
pub fn delete_collection(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM collections WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_collections() -> Result<Vec<Collection>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT c.*, COALESCE(cnt.n, 0) AS clip_count
             FROM collections c
             LEFT JOIN (SELECT collection_id, COUNT(*) AS n FROM collection_clips GROUP BY collection_id) cnt
               ON cnt.collection_id = c.id
             ORDER BY c.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_collection)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn get_collection(id: i64) -> Result<Collection, String> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT c.*, COALESCE(cnt.n, 0) AS clip_count
         FROM collections c
         LEFT JOIN (SELECT collection_id, COUNT(*) AS n FROM collection_clips GROUP BY collection_id) cnt
           ON cnt.collection_id = c.id
         WHERE c.id = ?1",
        [id],
        row_to_collection,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn add_clip_to_collection(collectionId: i64, clipId: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT OR IGNORE INTO collection_clips (collection_id, clip_id) VALUES (?1, ?2)",
        rusqlite::params![collectionId, clipId],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn remove_clip_from_collection(collectionId: i64, clipId: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "DELETE FROM collection_clips WHERE collection_id = ?1 AND clip_id = ?2",
        rusqlite::params![collectionId, clipId],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn list_collection_clips(
    collectionId: i64,
    page: Option<u32>,
    pageSize: Option<u32>,
) -> Result<Vec<WebClip>, String> {
    let conn = open_db()?;
    let page = page.unwrap_or(1).max(1);
    let size = pageSize.unwrap_or(20).min(100);
    let offset = (page - 1) * size;

    let mut stmt = conn
        .prepare(
            "SELECT w.* FROM web_clips w
             JOIN collection_clips cc ON w.id = cc.clip_id
             WHERE cc.collection_id = ?1 AND w.deleted_at IS NULL
             ORDER BY cc.sort_order ASC, cc.added_at DESC
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![collectionId, size, offset], row_to_clip)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn list_clip_collections(clipId: i64) -> Result<Vec<Collection>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT c.*, COALESCE(cnt.n, 0) AS clip_count
             FROM collections c
             JOIN collection_clips cc ON c.id = cc.collection_id
             LEFT JOIN (SELECT collection_id, COUNT(*) AS n FROM collection_clips GROUP BY collection_id) cnt
               ON cnt.collection_id = c.id
             WHERE cc.clip_id = ?1
             ORDER BY c.name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([clipId], row_to_collection)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}
