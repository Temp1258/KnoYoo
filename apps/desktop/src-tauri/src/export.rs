use crate::clips::{row_to_clip, WebClip};
use crate::db::open_db;
use rusqlite::OptionalExtension;

fn clip_to_markdown(clip: &WebClip, note: Option<&str>) -> String {
    let tags_str = clip
        .tags
        .iter()
        .map(|t| format!("\"{}\"", t))
        .collect::<Vec<_>>()
        .join(", ");

    let mut md = format!(
        "---\ntitle: \"{}\"\nurl: \"{}\"\ntags: [{}]\nsource_type: \"{}\"\nsaved_at: \"{}\"\n---\n\n# {}\n\n",
        clip.title.replace('"', "\\\""),
        clip.url,
        tags_str,
        clip.source_type,
        clip.created_at,
        clip.title,
    );

    if !clip.summary.is_empty() {
        md.push_str(&format!("> **AI Summary:** {}\n\n", clip.summary));
    }

    if let Some(n) = note {
        if !n.is_empty() {
            md.push_str(&format!("## My Notes\n\n{}\n\n", n));
        }
    }

    md.push_str("---\n\n");
    md.push_str(&clip.content);
    md.push_str(&format!("\n\n---\n*Source: [{}]({})*\n", clip.url, clip.url));

    md
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c > '\u{4e00}' { c } else { '_' })
        .collect::<String>()
        .trim()
        .chars()
        .take(80)
        .collect();
    if cleaned.is_empty() { "untitled".to_string() } else { cleaned }
}

#[tauri::command]
pub fn export_clip_to_file(id: i64, path: String) -> Result<(), String> {
    let conn = open_db()?;
    let clip = conn
        .query_row("SELECT * FROM web_clips WHERE id = ?1", [id], row_to_clip)
        .map_err(|e| e.to_string())?;

    let note: Option<String> = conn
        .query_row(
            "SELECT content FROM clip_notes WHERE clip_id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let md = clip_to_markdown(&clip, note.as_deref());
    std::fs::write(&path, md).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn export_collection_to_dir(collectionId: i64, dirPath: String) -> Result<u32, String> {
    let conn = open_db()?;
    std::fs::create_dir_all(&dirPath).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT w.* FROM web_clips w
             JOIN collection_clips cc ON w.id = cc.clip_id
             WHERE cc.collection_id = ?1
             ORDER BY cc.sort_order ASC, cc.added_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([collectionId], row_to_clip)
        .map_err(|e| e.to_string())?;

    let mut count = 0u32;
    for r in rows {
        let clip = r.map_err(|e| e.to_string())?;
        let note: Option<String> = conn
            .query_row(
                "SELECT content FROM clip_notes WHERE clip_id = ?1",
                [clip.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let md = clip_to_markdown(&clip, note.as_deref());
        let base = sanitize_filename(&clip.title);
        let mut filename = format!("{}.md", base);
        let mut counter = 1;
        while std::path::Path::new(&dirPath).join(&filename).exists() {
            filename = format!("{}_{}.md", base, counter);
            counter += 1;
        }
        let filepath = std::path::Path::new(&dirPath).join(&filename);
        std::fs::write(filepath, md).map_err(|e| e.to_string())?;
        count += 1;
    }
    Ok(count)
}
