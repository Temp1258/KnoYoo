//! Document format extraction for Phase C. Each extractor consumes a
//! filesystem path and returns plain text + a compact `TocEntry` list
//! describing the heading structure. The text is capped at
//! `MAX_TEXT_CHARS` so pathological inputs (a 1000-page novel, an
//! auto-generated 50 MB docx) can't blow up the AI pipeline budget or
//! the `SQLite` row.
//!
//! Format-specific notes
//! - **pdf**: mirrors `books.rs::extract_pdf_text` (`pdf-extract` primary,
//!   `lopdf` per-page fallback). TOC is intentionally left empty for now —
//!   PDF outlines live in the `/Outlines` catalog and require deeper
//!   `lopdf` walking; deferring until real demand surfaces.
//! - **docx**: `word/document.xml` inside the ZIP. Streaming SAX parser
//!   walks `<w:t>` for text and captures `<w:pStyle w:val="Heading[1-6]">`
//!   for TOC entries.
//! - **md**: trivial `read_to_string`; TOC comes from leading `#` runs
//!   at line start.
//! - **txt**: plain read; no TOC possible.

use std::io::Read;
use std::path::Path;

use serde::Serialize;

/// 500 KB of extracted text ≈ 250 000 CJK chars / ~500 pages of a typical
/// book. Matches the content-size cap used elsewhere in the codebase.
pub const MAX_TEXT_CHARS: usize = 500_000;

/// One entry in a document's TOC. `level` is 1–6 in Markdown/HTML
/// convention; `anchor` is an optional slug used by the future TOC
/// sidebar for scroll-into-view (may be empty when the format doesn't
/// expose stable anchors, e.g. docx).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct TocEntry {
    pub level: u8,
    pub title: String,
    pub anchor: String,
}

/// Output of every extractor. `toc_json` is the JSON-serialized form of
/// `Vec<TocEntry>` — empty `""` when the format or file has no headings.
pub struct DocExtract {
    pub text: String,
    pub toc_json: String,
    pub word_count: u32,
}

/// Dispatch by file format. `format` is the value written into
/// `documents.file_format`: `"pdf"` | `"docx"` | `"md"` | `"txt"`.
pub fn extract(path: &Path, format: &str) -> Result<DocExtract, String> {
    match format {
        "pdf" => extract_pdf(path),
        "docx" => extract_docx(path),
        "md" => extract_md(path),
        "txt" => extract_txt(path),
        other => Err(format!("unsupported document format: {other}")),
    }
}

fn count_words(text: &str) -> u32 {
    // Each CJK ideograph counts as one "word"; latin runs are chunked on
    // whitespace. Critical detail: latin-run flushing must happen at CJK
    // boundaries so "你好" isn't counted as one bonus whitespace-token
    // on top of its two ideographs. word_count is advisory so a perfect
    // segmentation (e.g. jieba) isn't warranted — this heuristic is
    // close enough for "N 字" badges.
    let mut count = 0usize;
    let mut latin_run = String::new();
    let flush = |run: &mut String, count: &mut usize| {
        for w in run.split_whitespace() {
            if !w.is_empty() {
                *count += 1;
            }
        }
        run.clear();
    };
    for ch in text.chars() {
        if (0x4E00..=0x9FFF).contains(&(ch as u32)) {
            flush(&mut latin_run, &mut count);
            count += 1;
        } else {
            latin_run.push(ch);
        }
    }
    flush(&mut latin_run, &mut count);
    u32::try_from(count).unwrap_or(u32::MAX)
}

fn toc_to_json(entries: &[TocEntry]) -> String {
    if entries.is_empty() {
        String::new()
    } else {
        serde_json::to_string(entries).unwrap_or_default()
    }
}

fn clamp_text(text: String) -> String {
    text.chars().take(MAX_TEXT_CHARS).collect()
}

// ── PDF ────────────────────────────────────────────────────────────────

fn extract_pdf(path: &Path) -> Result<DocExtract, String> {
    let text = pdf_text_with_fallback(path, MAX_TEXT_CHARS)?;
    let word_count = count_words(&text);
    Ok(DocExtract {
        text,
        toc_json: String::new(),
        word_count,
    })
}

fn pdf_text_with_fallback(path: &Path, budget: usize) -> Result<String, String> {
    // Primary: pdf-extract (handles ToUnicode CMaps that trip lopdf).
    match try_pdf_extract(path, budget) {
        Ok(Some(text)) => return Ok(text),
        Ok(None) => tracing::info!(
            "pdf-extract returned empty for {}, falling back to lopdf",
            path.display()
        ),
        Err(e) => tracing::warn!(
            "pdf-extract failed for {}: {} — falling back to lopdf",
            path.display(),
            e
        ),
    }

    // Fallback: lopdf per-page, panic-tolerant.
    let doc = lopdf::Document::load(path).map_err(|e| format!("PDF: {e}"))?;
    let pages = doc.get_pages();
    const MAX_PDF_PAGES: usize = 50;
    let page_numbers: Vec<u32> = pages.keys().copied().take(MAX_PDF_PAGES).collect();
    if page_numbers.is_empty() {
        return Ok(String::new());
    }
    let mut buf = String::new();
    let mut ok_pages = 0usize;
    for p in page_numbers {
        if buf.chars().count() >= budget {
            break;
        }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            doc.extract_text(&[p])
        }));
        match result {
            Ok(Ok(text)) => {
                buf.push_str(&text);
                buf.push('\n');
                ok_pages += 1;
            }
            Ok(Err(e)) => tracing::warn!("PDF {} page {} extract failed: {}", path.display(), p, e),
            Err(_) => tracing::warn!("PDF {} page {} extract panicked", path.display(), p),
        }
    }
    if ok_pages == 0 {
        return Err(
            "PDF 文本抽取失败（pdf-extract 与 lopdf 都无法解析；可能是扫描版/加密/非标准 PDF）"
                .to_string(),
        );
    }
    Ok(buf.chars().take(budget).collect())
}

fn try_pdf_extract(path: &Path, budget: usize) -> Result<Option<String>, String> {
    let path_buf = path.to_path_buf();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        pdf_extract::extract_text(&path_buf)
    }));
    match result {
        Ok(Ok(text)) => {
            if text.trim().is_empty() {
                Ok(None)
            } else {
                Ok(Some(text.chars().take(budget).collect()))
            }
        }
        Ok(Err(e)) => Err(format!("{e}")),
        Err(_) => Err("pdf-extract panicked".to_string()),
    }
}

// ── DOCX ───────────────────────────────────────────────────────────────

fn extract_docx(path: &Path) -> Result<DocExtract, String> {
    let file =
        std::fs::File::open(path).map_err(|e| format!("打开 docx 失败: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("docx 非 ZIP: {e}"))?;

    let mut doc_xml = String::new();
    {
        let mut entry = archive
            .by_name("word/document.xml")
            .map_err(|e| format!("docx 缺少 word/document.xml: {e}"))?;
        entry
            .read_to_string(&mut doc_xml)
            .map_err(|e| format!("读取 document.xml 失败: {e}"))?;
    }

    let (text, entries) = parse_docx_xml(&doc_xml);
    Ok(DocExtract {
        word_count: count_words(&text),
        text: clamp_text(text),
        toc_json: toc_to_json(&entries),
    })
}

/// SAX-walk of `word/document.xml`:
/// - concatenate every `<w:t>` element's text
/// - insert `\n` at the end of every `<w:p>` paragraph
/// - when a `<w:p>` carries `<w:pStyle w:val="Heading{1-6}">`, record its
///   plain-text as a `TocEntry` at the corresponding level
///
/// Uses `quick-xml`'s event iterator so docx files up to the hundreds of
/// MB can be processed without building a full DOM in memory.
fn parse_docx_xml(xml: &str) -> (String, Vec<TocEntry>) {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut text = String::new();
    let mut entries: Vec<TocEntry> = Vec::new();

    // Per-paragraph state, reset on each `<w:p>` start.
    let mut in_t = false;
    let mut para_text = String::new();
    let mut para_level: Option<u8> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = e.name();
                match name.as_ref() {
                    b"w:p" => {
                        para_text.clear();
                        para_level = None;
                    }
                    b"w:t" => in_t = true,
                    b"w:pStyle" => {
                        // `<w:pStyle w:val="Heading1"/>` (usually empty
                        // element, handled below too). Level parsed from
                        // the trailing digit.
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"w:val" {
                                if let Ok(v) = std::str::from_utf8(&attr.value) {
                                    para_level = level_from_style(v);
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                // Most `<w:pStyle>` elements in docx are self-closing.
                if e.name().as_ref() == b"w:pStyle" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"w:val" {
                            if let Ok(v) = std::str::from_utf8(&attr.value) {
                                para_level = level_from_style(v);
                            }
                        }
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if in_t {
                    if let Ok(raw) = t.unescape() {
                        para_text.push_str(raw.as_ref());
                    }
                }
            }
            Ok(Event::End(e)) => match e.name().as_ref() {
                b"w:t" => in_t = false,
                b"w:p" => {
                    if para_text.trim().is_empty() {
                        text.push('\n');
                    } else {
                        if let Some(level) = para_level {
                            // Emit Markdown heading syntax so downstream
                            // rendering (ReactMarkdown with custom h1..h6
                            // id-injecting renderers) produces real DOM
                            // headings whose slugged ids match the TOC
                            // entries we build here. Without this, the
                            // TOC's scrollIntoView calls had nothing to
                            // scroll to for docx imports.
                            for _ in 0..level {
                                text.push('#');
                            }
                            text.push(' ');
                            entries.push(TocEntry {
                                level,
                                title: para_text.trim().to_string(),
                                anchor: slugify(para_text.trim()),
                            });
                        }
                        text.push_str(&para_text);
                        text.push('\n');
                    }
                    para_text.clear();
                    para_level = None;
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(e) => {
                tracing::warn!("docx xml parse error: {e}");
                break;
            }
            _ => {}
        }
    }
    (text, entries)
}

fn level_from_style(style: &str) -> Option<u8> {
    // Matches "Heading1" / "Heading2" / … / "heading1" (case-insensitive).
    // Anything else (e.g. "Normal", "Title") isn't a TOC-worthy heading.
    let lower = style.to_ascii_lowercase();
    lower
        .strip_prefix("heading")
        .and_then(|rest| rest.trim().parse::<u8>().ok())
        .filter(|&n| (1..=6).contains(&n))
}

// ── MD ────────────────────────────────────────────────────────────────

fn extract_md(path: &Path) -> Result<DocExtract, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("读取 md 失败: {e}"))?;
    let entries = parse_md_toc(&text);
    Ok(DocExtract {
        word_count: count_words(&text),
        text: clamp_text(text),
        toc_json: toc_to_json(&entries),
    })
}

fn parse_md_toc(text: &str) -> Vec<TocEntry> {
    // Only ATX-style headings (`# Title`, `## Title`, …). Setext headings
    // (underline with === / ---) are less common in the tools users
    // actually author markdown with (Notion / Obsidian / VS Code); skip
    // for v1.
    let mut out = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        if !trimmed.starts_with('#') {
            continue;
        }
        let hashes = trimmed.chars().take_while(|&c| c == '#').count();
        if !(1..=6).contains(&hashes) {
            continue;
        }
        let rest = &trimmed[hashes..];
        // A space between `#` runs and the title is required by spec —
        // "#Heading" (no space) is a paragraph, not a heading.
        if !rest.starts_with(' ') && !rest.starts_with('\t') {
            continue;
        }
        let title = rest.trim();
        if title.is_empty() {
            continue;
        }
        out.push(TocEntry {
            level: hashes as u8,
            title: title.to_string(),
            anchor: slugify(title),
        });
    }
    out
}

// ── TXT ───────────────────────────────────────────────────────────────

fn extract_txt(path: &Path) -> Result<DocExtract, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("读取 txt 失败: {e}"))?;
    Ok(DocExtract {
        word_count: count_words(&text),
        text: clamp_text(text),
        toc_json: String::new(),
    })
}

// ── Slugify ───────────────────────────────────────────────────────────

/// Convert a heading title into a URL-safe anchor. `is_alphanumeric` is
/// already Unicode-aware — CJK ideographs are kept because they have the
/// Alphabetic property. Punctuation (including full-width `：` etc.)
/// collapses into a single hyphen. An earlier version OR'd in
/// `ch as u32 >= 0x80` as a catch-all for "high Unicode stays", but that
/// also let CJK punctuation through — the slug for "第一章：开始" came
/// out as `第一章：开始` instead of `第一章-开始`. Relying on the
/// `is_alphanumeric` classification avoids that trap.
fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_hyphen = false;
    for ch in s.chars() {
        if ch.is_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_hyphen = false;
        } else if !prev_hyphen && !out.is_empty() {
            out.push('-');
            prev_hyphen = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_words_mixed_cjk_and_latin() {
        assert_eq!(count_words("hello world"), 2);
        assert_eq!(count_words("你好"), 2);
        assert_eq!(count_words("hello 你好 world"), 4);
        assert_eq!(count_words(""), 0);
    }

    #[test]
    fn level_from_style_matches_headings() {
        assert_eq!(level_from_style("Heading1"), Some(1));
        assert_eq!(level_from_style("heading6"), Some(6));
        assert_eq!(level_from_style("Heading7"), None);
        assert_eq!(level_from_style("Normal"), None);
        assert_eq!(level_from_style("Title"), None);
    }

    #[test]
    fn md_toc_picks_up_hash_headings() {
        let md = "# Intro\n\nsome body\n\n## Setup\n\n### Details\n\n#not a heading\n\n#### Fourth";
        let toc = parse_md_toc(md);
        assert_eq!(toc.len(), 4);
        assert_eq!(toc[0].level, 1);
        assert_eq!(toc[0].title, "Intro");
        assert_eq!(toc[1].level, 2);
        assert_eq!(toc[1].title, "Setup");
        assert_eq!(toc[2].level, 3);
        assert_eq!(toc[3].level, 4);
    }

    #[test]
    fn md_toc_ignores_runs_over_six() {
        // Seven `#` is not a heading per CommonMark.
        let toc = parse_md_toc("####### Not a heading");
        assert_eq!(toc.len(), 0);
    }

    #[test]
    fn slugify_keeps_cjk_strips_punct() {
        assert_eq!(slugify("Hello, World!"), "hello-world");
        assert_eq!(slugify("第一章：开始"), "第一章-开始");
        assert_eq!(slugify("   "), "");
    }

    #[test]
    fn clamp_text_respects_char_budget() {
        let overflow: String = std::iter::repeat_n('a', MAX_TEXT_CHARS + 100).collect();
        let clamped = clamp_text(overflow);
        assert_eq!(clamped.chars().count(), MAX_TEXT_CHARS);
    }

    #[test]
    fn parse_docx_xml_extracts_text_and_headings() {
        // Minimal docx document.xml shape — one heading + one paragraph.
        let xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Chapter One</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Body text goes here.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>Sub section</w:t></w:r>
    </w:p>
  </w:body>
</w:document>"#;
        let (text, toc) = parse_docx_xml(xml);
        // Headings are now emitted with Markdown syntax so downstream
        // ReactMarkdown rendering produces real <h1>..<h6> elements
        // whose slugged ids match the TOC's `anchor` field.
        assert!(text.contains("# Chapter One"));
        assert!(text.contains("## Sub section"));
        assert!(text.contains("Body text goes here."));
        assert_eq!(toc.len(), 2);
        assert_eq!(toc[0].level, 1);
        assert_eq!(toc[0].title, "Chapter One");
        assert_eq!(toc[1].level, 2);
        assert_eq!(toc[1].title, "Sub section");
    }

    #[test]
    fn parse_docx_xml_skips_non_heading_pstyles() {
        let xml = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r><w:t>Just body</w:t></w:r>
    </w:p>
  </w:body>
</w:document>"#;
        let (_text, toc) = parse_docx_xml(xml);
        assert_eq!(toc.len(), 0);
    }
}
