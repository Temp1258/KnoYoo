use crate::db::open_db;
use crate::models::Counts;

#[tauri::command]
pub fn fix_skill_name_unique() -> Result<i64, String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let dup: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM (
           SELECT name, COUNT(*) c FROM industry_skill GROUP BY name HAVING c > 1
         )",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    tx.execute_batch(
        r#"
      CREATE TEMP TABLE IF NOT EXISTS name_to_keep AS
        SELECT name, MIN(id) AS keep_id FROM industry_skill GROUP BY name;

      UPDATE plan_task
      SET skill_id = (
        SELECT k.keep_id
        FROM industry_skill s JOIN name_to_keep k ON s.name = k.name
        WHERE s.id = plan_task.skill_id
      )
      WHERE skill_id IS NOT NULL;

      INSERT OR IGNORE INTO note_skill_map(note_id, skill_id, weight)
      SELECT nsm.note_id, k.keep_id, MAX(nsm.weight)
      FROM note_skill_map nsm
      JOIN industry_skill s ON nsm.skill_id = s.id
      JOIN name_to_keep k ON s.name = k.name
      GROUP BY nsm.note_id, k.keep_id;

      DELETE FROM note_skill_map
      WHERE (note_id, skill_id) IN (
        SELECT nsm.note_id, nsm.skill_id
        FROM note_skill_map nsm
        JOIN industry_skill s ON nsm.skill_id = s.id
        JOIN name_to_keep k ON s.name = k.name
        WHERE nsm.skill_id <> k.keep_id
      );

      DELETE FROM industry_skill
      WHERE id IN (
        SELECT s.id FROM industry_skill s JOIN name_to_keep k ON s.name = k.name
        WHERE s.id <> k.keep_id
      );

      DELETE FROM plan_task
      WHERE status <> 'DONE'
        AND id NOT IN (
          SELECT MAX(id) FROM plan_task
          WHERE status <> 'DONE'
          GROUP BY horizon, skill_id
        );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_industry_skill_name_unique ON industry_skill(name);

      DROP TABLE IF EXISTS name_to_keep;
    "#,
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(dup)
}

#[tauri::command]
pub fn fix_notes_delete_cascade() -> Result<&'static str, String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute_batch(
        r#"
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
    "#,
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok("ok")
}

#[tauri::command]
pub fn debug_counts() -> Result<Counts, String> {
    let conn = open_db()?;
    let industry: i64 = conn
        .query_row("SELECT COUNT(1) FROM industry_skill", [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(|e| e.to_string())?;
    let plans: i64 = conn
        .query_row("SELECT COUNT(1) FROM plan_task", [], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    Ok(Counts {
        industry,
        plans,
    })
}
