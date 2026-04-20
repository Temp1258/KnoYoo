//! Unified cross-content search. Two execution paths share the same result
//! shape:
//!
//! - **FTS path** (all tokens ≥ 3 chars): query `web_clips_fts` / `books_fts`
//!   via the trigram-tokenized FTS5 index, rank by bm25, normalize across
//!   tables, merge.
//! - **LIKE path** (any token < 3 chars): fall back to `col LIKE '%tok%'`
//!   against the base table. Needed because `SQLite`'s trigram tokenizer can
//!   only index 3-grams — query strings shorter than that either return
//!   empty MATCH results or force a full table scan, which felt both
//!   "nothing matches" AND "typing is laggy" to users on CJK text
//!   (single-char queries like "穷" or two-char like "爸爸" never hit).
//!
//! Both paths produce the same `SearchHit` shape; the UI doesn't need to
//! know which ran. LIKE hits get a flat score (`LIKE_SCORE`) since bm25
//! isn't meaningful here; short-query results order by recency instead.

use serde::{Deserialize, Serialize};

use crate::db::open_db;

const DEFAULT_LIMIT: u32 = 20;
const MAX_LIMIT: u32 = 50;
/// Hard cap on cross-table pagination depth. At this offset, scrolling
/// further is a hint the user should be using the main Clips page with
/// real filters, not a glance-mode overlay.
const MAX_OFFSET: u32 = 500;
/// Minimum per-table top-K — larger than the final limit so strong hits in
/// one kind can displace weak hits from another. The effective K scales up
/// with `limit + offset` so pagination still returns correct results.
const MIN_PER_TABLE_K: u32 = 30;
const MAX_QUERY_LEN: usize = 1000;
/// Minimum token length that can use the FTS path. `SQLite` trigram tokens
/// are 3 chars; any shorter and we fall through to LIKE.
const FTS_MIN_TOKEN_CHARS: usize = 3;
/// Flat score assigned to LIKE-path hits so they slot into the merged
/// ordering consistently. Books still get `BOOK_WEIGHT` applied on top.
const LIKE_SCORE: f64 = 0.5;

pub const KIND_CLIP: &str = "clip";
pub const KIND_BOOK: &str = "book";
pub const KIND_VIDEO: &str = "video";
/// Local audio + `local_video` clips. Routed to the Media page on click.
pub const KIND_MEDIA: &str = "media";

/// Unified result row. Field set is the superset across kinds; fields that
/// don't apply to a given kind come back empty (never null) so the frontend
/// can treat the response as a uniform list.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchHit {
    pub kind: String,
    pub id: i64,
    pub title: String,
    pub snippet: String,
    pub score: f64,
    pub url: String,
    pub favicon: String,
    pub cover_path: String,
    pub created_at: String,
}

fn tokens_of(raw: &str) -> Vec<&str> {
    raw.split_whitespace().collect()
}

/// FTS path is only viable when every token is at least 3 chars long (the
/// length of a trigram). Any shorter and we fall back to LIKE so the query
/// isn't silently empty and doesn't force a full FTS scan.
fn should_use_fts(raw: &str) -> bool {
    let toks = tokens_of(raw);
    !toks.is_empty() && toks.iter().all(|t| t.chars().count() >= FTS_MIN_TOKEN_CHARS)
}

/// FTS5 query cleanup: each whitespace-separated token wrapped in quotes,
/// AND-joined. Inner quotes scrubbed to keep FTS5's parser happy.
fn build_fts_query(raw: &str) -> String {
    raw.split_whitespace()
        .map(|w| format!("\"{}\"", w.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Escape `SQLite` LIKE meta-characters. We bind with `ESCAPE '\\'` so
/// user-typed `%` / `_` / `\` don't wildcard or fail to match literally.
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// bm25 returns negative f64 where more-negative = better. Map to [0, 1)
/// with values approaching 1 for stronger matches and approaching 0 for
/// barely-matched ones. Formula: `|raw| / (1 + |raw|)` — monotonically
/// increasing in `|raw|`, asymptotic to 1.
fn normalize_bm25(raw: f64) -> f64 {
    let abs = raw.abs();
    abs / (1.0 + abs)
}

/// Book kind weight. Smaller than clip/video because the indexed corpus is
/// much smaller (title + author + publisher + description only), which
/// pushes bm25 absolute values higher and would otherwise dominate merges.
const BOOK_WEIGHT: f64 = 0.95;

// ── FTS path ────────────────────────────────────────────────────────────────

fn search_clips_fts(
    conn: &rusqlite::Connection,
    fts_q: &str,
    want_article: bool,
    want_video: bool,
    want_media: bool,
    per_table_k: u32,
) -> Result<Vec<SearchHit>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.title, c.summary, c.url, c.favicon, c.source_type,
                    c.created_at, bm25(web_clips_fts) AS bm
             FROM web_clips_fts
             JOIN web_clips c ON c.id = web_clips_fts.rowid
             WHERE web_clips_fts MATCH ?1 AND c.deleted_at IS NULL
             ORDER BY rank
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![fts_q, per_table_k], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, f64>(7)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        let (id, title, summary, url, favicon, source_type, created_at, bm) =
            r.map_err(|e| e.to_string())?;
        let kind = kind_for_source_type(&source_type);
        if !keep_kind(kind, want_article, want_video, want_media) {
            continue;
        }
        out.push(SearchHit {
            kind: kind.to_string(),
            id,
            title,
            snippet: summary,
            score: normalize_bm25(bm),
            url,
            favicon,
            cover_path: String::new(),
            created_at,
        });
    }
    Ok(out)
}

/// Map a `web_clips.source_type` string to the wire-level `kind` the UI
/// routes on. Keeps the mapping centralized so FTS + LIKE paths stay in sync.
fn kind_for_source_type(source_type: &str) -> &'static str {
    match source_type {
        "video" => KIND_VIDEO,
        "audio" | "local_video" => KIND_MEDIA,
        _ => KIND_CLIP,
    }
}

/// Scope-check in one place so FTS + LIKE paths agree on which hits make it
/// through. Books are filtered at the `want_book` level up the stack —
/// this helper only discriminates among clip-like kinds.
fn keep_kind(kind: &str, want_article: bool, want_video: bool, want_media: bool) -> bool {
    match kind {
        k if k == KIND_CLIP => want_article,
        k if k == KIND_VIDEO => want_video,
        k if k == KIND_MEDIA => want_media,
        // KIND_BOOK is filtered at the unified_search dispatch level, but
        // be defensive: books never reach this helper so `false` here is
        // moot yet also safer than `true`.
        _ => false,
    }
}

fn search_books_fts(
    conn: &rusqlite::Connection,
    fts_q: &str,
    per_table_k: u32,
) -> Result<Vec<SearchHit>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT b.id, b.title, b.description, b.author, b.cover_path,
                    b.added_at, bm25(books_fts) AS bm
             FROM books_fts
             JOIN books b ON b.id = books_fts.rowid
             WHERE books_fts MATCH ?1 AND b.deleted_at IS NULL
             ORDER BY rank
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![fts_q, per_table_k], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, f64>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        let (id, title, description, author, cover_path, added_at, bm) =
            r.map_err(|e| e.to_string())?;
        out.push(SearchHit {
            kind: KIND_BOOK.to_string(),
            id,
            title,
            snippet: book_snippet(&description, &author),
            score: normalize_bm25(bm) * BOOK_WEIGHT,
            url: String::new(),
            favicon: String::new(),
            cover_path,
            created_at: added_at,
        });
    }
    Ok(out)
}

fn book_snippet(description: &str, author: &str) -> String {
    if description.trim().is_empty() {
        if author.is_empty() {
            String::new()
        } else {
            format!("作者：{author}")
        }
    } else {
        description.to_string()
    }
}

// ── LIKE path (short-query fallback) ────────────────────────────────────────

/// Build the repeated `(title LIKE ? OR content LIKE ? OR ...)` fragment plus
/// the params needed to bind it. Each token turns into `columns.len()` binds.
/// `ESCAPE '\\'` pairs with `escape_like` to keep `%` / `_` literal.
fn like_clause(tokens: &[&str], columns: &[&str]) -> (String, Vec<String>) {
    let mut sql = String::new();
    let mut params: Vec<String> = Vec::new();
    for t in tokens {
        sql.push_str(" AND (");
        for (i, col) in columns.iter().enumerate() {
            if i > 0 {
                sql.push_str(" OR ");
            }
            // ESCAPE must be a single char. In SQL: '\' → Rust: "'\\'".
            sql.push_str(&format!("{col} LIKE ? ESCAPE '\\'"));
        }
        sql.push(')');
        let pat = format!("%{}%", escape_like(t));
        for _ in columns {
            params.push(pat.clone());
        }
    }
    (sql, params)
}

fn search_clips_like(
    conn: &rusqlite::Connection,
    raw_query: &str,
    want_article: bool,
    want_video: bool,
    want_media: bool,
    per_table_k: u32,
) -> Result<Vec<SearchHit>, String> {
    let toks = tokens_of(raw_query);
    if toks.is_empty() {
        return Ok(Vec::new());
    }
    let (where_like, like_params) =
        like_clause(&toks, &["title", "content", "summary", "tags"]);

    // No SQL-level type filter: post-filter in Rust keeps the FTS and LIKE
    // branches behaviourally identical and sidesteps the ugly branching
    // that was needed to cover 4 kinds in one SQL `type_clause`.
    let sql = format!(
        "SELECT id, title, summary, url, favicon, source_type, created_at
         FROM web_clips
         WHERE deleted_at IS NULL{where_like}
         ORDER BY updated_at DESC
         LIMIT ?",
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut all_params: Vec<String> = like_params;
    all_params.push(per_table_k.to_string());
    let rows = stmt
        .query_map(rusqlite::params_from_iter(all_params.iter()), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        let (id, title, summary, url, favicon, source_type, created_at) =
            r.map_err(|e| e.to_string())?;
        let kind = kind_for_source_type(&source_type);
        if !keep_kind(kind, want_article, want_video, want_media) {
            continue;
        }
        out.push(SearchHit {
            kind: kind.to_string(),
            id,
            title,
            snippet: summary,
            score: LIKE_SCORE,
            url,
            favicon,
            cover_path: String::new(),
            created_at,
        });
    }
    Ok(out)
}

fn search_books_like(
    conn: &rusqlite::Connection,
    raw_query: &str,
    per_table_k: u32,
) -> Result<Vec<SearchHit>, String> {
    let toks = tokens_of(raw_query);
    if toks.is_empty() {
        return Ok(Vec::new());
    }
    let (where_like, like_params) =
        like_clause(&toks, &["title", "author", "publisher", "description"]);

    let sql = format!(
        "SELECT id, title, description, author, cover_path, added_at
         FROM books
         WHERE deleted_at IS NULL{where_like}
         ORDER BY updated_at DESC
         LIMIT ?",
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut all_params: Vec<String> = like_params;
    all_params.push(per_table_k.to_string());
    let rows = stmt
        .query_map(rusqlite::params_from_iter(all_params.iter()), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        let (id, title, description, author, cover_path, added_at) =
            r.map_err(|e| e.to_string())?;
        out.push(SearchHit {
            kind: KIND_BOOK.to_string(),
            id,
            title,
            snippet: book_snippet(&description, &author),
            score: LIKE_SCORE * BOOK_WEIGHT,
            url: String::new(),
            favicon: String::new(),
            cover_path,
            created_at: added_at,
        });
    }
    Ok(out)
}

// ── Scope parsing + entry point ────────────────────────────────────────────

/// Returns `(want_article, want_video, want_book, want_media)`.
/// - `"all"` (default) — everything
/// - `"clips"` — article-type web clips only
/// - `"videos"` — online video (YouTube/Bilibili) only
/// - `"books"` — library entries only
/// - `"media"` — local audio + `local_video` only
///
/// Any other value falls back to "all" so older callers don't break silently.
fn parse_scope(scope: Option<String>) -> (bool, bool, bool, bool) {
    match scope.as_deref().unwrap_or("all") {
        "clips" => (true, false, false, false),
        "videos" => (false, true, false, false),
        "books" => (false, false, true, false),
        "media" => (false, false, false, true),
        _ => (true, true, true, true),
    }
}

/// Unified search across clips, videos, books, and local media.
///
/// `q`         : user query string (trimmed; empty returns empty result)
/// `scope`     : "all" (default) | "clips" | "videos" | "books" | "media"
/// `limit`     : max results per call (default 20, cap 50)
/// `offset`    : skip this many top results for pagination (cap 500)
///
/// Pagination is cross-table: we fetch `limit + offset` rows from each FTS
/// table (bounded by `MAX_OFFSET + MAX_LIMIT`), merge by score, then skip
/// the offset. This sacrifices a bit of memory for correctness — true
/// cursor-based pagination across four sort keys would need a lot more
/// machinery for the same result.
#[tauri::command]
pub fn unified_search(
    q: String,
    scope: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<SearchHit>, String> {
    let trimmed = q.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if trimmed.len() > MAX_QUERY_LEN {
        return Err("搜索关键词过长".to_string());
    }

    let conn = open_db()?;
    let lim = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
    let off = offset.unwrap_or(0).min(MAX_OFFSET);
    // Each table needs enough rows that merge+skip yields `lim` valid hits.
    let per_table_k = (lim + off).max(MIN_PER_TABLE_K);
    let (want_article, want_video, want_book, want_media) = parse_scope(scope);
    let use_fts = should_use_fts(trimmed);

    let mut hits: Vec<SearchHit> = Vec::new();

    if want_article || want_video || want_media {
        if use_fts {
            hits.extend(search_clips_fts(
                &conn,
                &build_fts_query(trimmed),
                want_article,
                want_video,
                want_media,
                per_table_k,
            )?);
        } else {
            hits.extend(search_clips_like(
                &conn,
                trimmed,
                want_article,
                want_video,
                want_media,
                per_table_k,
            )?);
        }
    }
    if want_book {
        if use_fts {
            hits.extend(search_books_fts(
                &conn,
                &build_fts_query(trimmed),
                per_table_k,
            )?);
        } else {
            hits.extend(search_books_like(&conn, trimmed, per_table_k)?);
        }
    }

    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(hits
        .into_iter()
        .skip(off as usize)
        .take(lim as usize)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory");
        conn.execute_batch(
            r"
            CREATE TABLE web_clips (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              url TEXT NOT NULL,
              title TEXT NOT NULL DEFAULT '',
              content TEXT NOT NULL DEFAULT '',
              summary TEXT NOT NULL DEFAULT '',
              tags TEXT NOT NULL DEFAULT '[]',
              source_type TEXT NOT NULL DEFAULT 'article',
              favicon TEXT NOT NULL DEFAULT '',
              deleted_at TEXT,
              created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
            CREATE VIRTUAL TABLE web_clips_fts USING fts5(
              title, content, summary, tags,
              content='web_clips', content_rowid='id',
              tokenize='trigram');
            CREATE TRIGGER web_clips_ai AFTER INSERT ON web_clips BEGIN
              INSERT INTO web_clips_fts(rowid, title, content, summary, tags)
                VALUES (new.id, new.title, new.content, new.summary, new.tags);
            END;

            CREATE TABLE books (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL DEFAULT '',
              author TEXT NOT NULL DEFAULT '',
              publisher TEXT NOT NULL DEFAULT '',
              description TEXT NOT NULL DEFAULT '',
              cover_path TEXT NOT NULL DEFAULT '',
              added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              deleted_at TEXT
            );
            CREATE VIRTUAL TABLE books_fts USING fts5(
              title, author, publisher, description,
              content='books', content_rowid='id',
              tokenize='trigram');
            CREATE TRIGGER books_ai AFTER INSERT ON books BEGIN
              INSERT INTO books_fts(rowid, title, author, publisher, description)
                VALUES (new.id, new.title, new.author, new.publisher, new.description);
            END;
            ",
        )
        .expect("init schema");
        conn
    }

    fn add_clip(conn: &Connection, title: &str, summary: &str, source_type: &str) {
        conn.execute(
            "INSERT INTO web_clips(url, title, content, summary, source_type)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                format!("https://ex.test/{title}"),
                title,
                summary,
                summary,
                source_type
            ],
        )
        .unwrap();
    }

    fn add_book(conn: &Connection, title: &str, description: &str) {
        conn.execute(
            "INSERT INTO books(title, description) VALUES (?1, ?2)",
            rusqlite::params![title, description],
        )
        .unwrap();
    }

    #[test]
    fn build_fts_query_wraps_tokens() {
        assert_eq!(build_fts_query("rust cli"), "\"rust\" \"cli\"");
        assert_eq!(build_fts_query("  hello  "), "\"hello\"");
        assert_eq!(build_fts_query(""), "");
    }

    #[test]
    fn should_use_fts_rejects_short_tokens() {
        assert!(should_use_fts("rust programming"));
        assert!(should_use_fts("富爸爸"));
        assert!(!should_use_fts(""));
        assert!(!should_use_fts("a"), "single-char English falls to LIKE");
        assert!(!should_use_fts("爸爸"), "2-char CJK falls to LIKE");
        assert!(
            !should_use_fts("rust ab"),
            "any short token forces LIKE path"
        );
    }

    #[test]
    fn escape_like_protects_meta_chars() {
        assert_eq!(escape_like("100%"), "100\\%");
        assert_eq!(escape_like("foo_bar"), "foo\\_bar");
        assert_eq!(escape_like(r"a\b"), r"a\\b");
    }

    #[test]
    fn normalize_bm25_monotonic() {
        let strong = normalize_bm25(-10.0);
        let weak = normalize_bm25(-0.5);
        assert!(strong > weak);
    }

    #[test]
    fn fts_path_finds_clips() {
        let conn = test_db();
        add_clip(&conn, "Rust cheatsheet", "ownership lifetimes", "article");
        let hits = search_clips_fts(
            &conn,
            &build_fts_query("rust"),
            true, // want_article
            true, // want_video
            true, // want_media
            MIN_PER_TABLE_K,
        )
        .unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].score > 0.0 && hits[0].score <= 1.0);
    }

    #[test]
    fn like_path_finds_short_cjk_query() {
        let conn = test_db();
        add_clip(&conn, "富爸爸穷爸爸", "关于财务思维", "article");
        // 2 chars — FTS would miss this under trigram; LIKE must catch it.
        let hits = search_clips_like(
            &conn, "爸爸", true, true, true, MIN_PER_TABLE_K,
        )
        .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "富爸爸穷爸爸");
        // LIKE path always produces the same flat score; compare exactly.
        assert!((hits[0].score - LIKE_SCORE).abs() < f64::EPSILON);
    }

    #[test]
    fn like_path_finds_single_char_cjk() {
        let conn = test_db();
        add_clip(&conn, "富爸爸穷爸爸", "summary here", "article");
        let hits = search_clips_like(
            &conn, "穷", true, true, true, MIN_PER_TABLE_K,
        )
        .unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn like_path_requires_all_tokens_present() {
        let conn = test_db();
        add_clip(&conn, "rust", "rust ownership", "article");
        add_clip(&conn, "python", "python decorators", "article");
        // AND semantics: only docs containing BOTH tokens.
        let hits = search_clips_like(
            &conn, "rust cli", true, true, true, MIN_PER_TABLE_K,
        )
        .unwrap();
        assert_eq!(hits.len(), 0);
    }

    #[test]
    fn like_path_excludes_soft_deleted() {
        let conn = test_db();
        add_clip(&conn, "富爸爸", "s", "article");
        conn.execute(
            "UPDATE web_clips SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            [],
        )
        .unwrap();
        let hits = search_clips_like(
            &conn, "爸爸", true, true, true, MIN_PER_TABLE_K,
        )
        .unwrap();
        assert_eq!(hits.len(), 0);
    }

    #[test]
    fn like_path_scope_filter_for_videos() {
        let conn = test_db();
        add_clip(&conn, "富爸爸 视频", "", "video");
        add_clip(&conn, "富爸爸 文章", "", "article");
        // want_article=false, want_video=true, want_media=false — videos only.
        let only_video = search_clips_like(
            &conn, "爸爸", false, true, false, MIN_PER_TABLE_K,
        )
        .unwrap();
        assert_eq!(only_video.len(), 1);
        assert_eq!(only_video[0].kind, KIND_VIDEO);
    }

    #[test]
    fn like_path_scope_media_excludes_video_and_article() {
        // Scope="media" means audio + local_video only.
        let conn = test_db();
        add_clip(&conn, "文章", "", "article");
        add_clip(&conn, "在线视频", "", "video");
        add_clip(&conn, "音频", "", "audio");
        add_clip(&conn, "本地视频", "", "local_video");
        let hits = search_clips_like(
            &conn, "频", false, false, true, MIN_PER_TABLE_K,
        )
        .unwrap();
        let titles: Vec<&str> = hits.iter().map(|h| h.title.as_str()).collect();
        assert!(titles.contains(&"音频"));
        assert!(titles.contains(&"本地视频"));
        assert!(!titles.contains(&"在线视频"));
        // All hits should be KIND_MEDIA
        assert!(hits.iter().all(|h| h.kind == KIND_MEDIA));
    }

    #[test]
    fn like_path_books() {
        let conn = test_db();
        add_book(&conn, "富爸爸穷爸爸", "讲述财务思维");
        let hits = search_books_like(&conn, "爸爸", MIN_PER_TABLE_K).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, KIND_BOOK);
    }

    #[test]
    fn like_clause_escapes_wildcards() {
        // The fragment builder must keep user-typed `%` literal via ESCAPE.
        let (sql, params) = like_clause(&["100%"], &["title"]);
        assert!(sql.contains("ESCAPE"));
        // Expected LIKE pattern: `%100\%%` in memory — outer wildcards + the
        // user's `%` escaped.
        assert_eq!(params, vec!["%100\\%%".to_string()]);
    }

    #[test]
    fn source_type_distinguishes_video_from_article() {
        let conn = test_db();
        add_clip(&conn, "Intro video", "react hooks", "video");
        add_clip(&conn, "Article", "react patterns", "article");

        // want_article=false, want_video=true, want_media=false
        let only_video = search_clips_fts(
            &conn,
            &build_fts_query("react"),
            false,
            true,
            false,
            MIN_PER_TABLE_K,
        )
        .unwrap();
        assert_eq!(only_video.len(), 1);
        assert_eq!(only_video[0].kind, KIND_VIDEO);
    }

    #[test]
    fn fts_path_soft_deleted_excluded() {
        let conn = test_db();
        add_clip(&conn, "Rust book", "ownership", "article");
        conn.execute(
            "UPDATE web_clips SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            [],
        )
        .unwrap();
        let hits = search_clips_fts(
            &conn,
            &build_fts_query("rust"),
            true,
            true,
            true,
            MIN_PER_TABLE_K,
        )
        .unwrap();
        assert_eq!(hits.len(), 0);
    }

    #[test]
    fn parse_scope_defaults_to_all() {
        assert_eq!(parse_scope(None), (true, true, true, true));
        assert_eq!(parse_scope(Some("all".into())), (true, true, true, true));
        assert_eq!(parse_scope(Some("clips".into())), (true, false, false, false));
        assert_eq!(parse_scope(Some("videos".into())), (false, true, false, false));
        assert_eq!(parse_scope(Some("books".into())), (false, false, true, false));
        assert_eq!(parse_scope(Some("media".into())), (false, false, false, true));
        assert_eq!(parse_scope(Some("garbage".into())), (true, true, true, true));
    }

    #[test]
    fn keep_kind_scopes_all_four_kinds() {
        // Every kind individually; only its own flag should let it through.
        assert!(keep_kind(KIND_CLIP, true, false, false));
        assert!(!keep_kind(KIND_CLIP, false, true, true));
        assert!(keep_kind(KIND_VIDEO, false, true, false));
        assert!(!keep_kind(KIND_VIDEO, true, false, true));
        assert!(keep_kind(KIND_MEDIA, false, false, true));
        assert!(!keep_kind(KIND_MEDIA, true, true, false));
        // Books never reach this helper — guard should return false regardless.
        assert!(!keep_kind(KIND_BOOK, true, true, true));
    }
}
