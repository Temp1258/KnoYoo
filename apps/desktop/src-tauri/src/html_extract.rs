//! Server-side HTML fetching and content extraction.
//!
//! Fetches a URL with ureq, parses the HTML with scraper,
//! and extracts the main content as plain text.

use std::io::Read as _;
use std::time::Duration;

use scraper::{Html, Selector};

/// Maximum HTML response size (5 MB).
const MAX_HTML_BYTES: u64 = 5 * 1024 * 1024;

/// Timeout for fetching a URL.
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

/// Maximum extracted content length (50k chars).
const MAX_CONTENT_CHARS: usize = 50_000;

/// Extracted page data.
pub struct ExtractedPage {
    pub title: String,
    /// First-pass scraped content (selector-based extraction). Gets replaced
    /// by the AI-cleaned version once stage 2 of the pipeline runs.
    pub content: String,
    /// Full-body dump with only script/style/noscript/svg stripped. Preserved
    /// so the UI can offer a "原始" toggle and AI has a complete input to
    /// clean from. For YouTube/Bilibili this equals `content` because the
    /// API-sourced payload is already the cleanest version available.
    pub raw_content: String,
    pub favicon: String,
    pub og_image: String,
}

/// Validate that a URL is safe to fetch (no internal/private networks).
fn validate_url_safe(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;

    match parsed.scheme() {
        "http" | "https" => {}
        s => return Err(format!("Unsupported scheme: {s}")),
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?;

    // Block obviously private/internal hostnames
    let blocked_hosts = [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "[::1]",
        "metadata.google.internal",
    ];
    let host_lower = host.to_lowercase();
    if blocked_hosts.iter().any(|b| host_lower == *b) {
        return Err(format!("Blocked host: {host}"));
    }

    // Block private IP ranges
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let is_private = match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.octets()[0] == 169 && v4.octets()[1] == 254 // link-local
                    || v4.is_broadcast()
                    || v4.is_unspecified()
            }
            std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
        };
        if is_private {
            return Err(format!("Blocked private/internal IP: {host}"));
        }
    }

    // Block common internal TLDs. `host_lower` is already lowercased at L56,
    // so suffix matching is effectively case-insensitive — clippy can't prove
    // that and flags it as a file-extension check.
    #[allow(clippy::case_sensitive_file_extension_comparisons)]
    if host_lower.ends_with(".local")
        || host_lower.ends_with(".internal")
        || host_lower.ends_with(".localhost")
    {
        return Err(format!("Blocked internal hostname: {host}"));
    }

    Ok(())
}

/// Fetch a URL and extract its main content.
pub fn fetch_and_extract(url: &str) -> Result<ExtractedPage, String> {
    validate_url_safe(url)?;

    // YouTube watch pages need specialized extraction: the article-style DOM
    // scraping returns almost nothing useful (SPA-rendered), so we pull the
    // embedded player metadata + full spoken transcript instead.
    if crate::youtube::is_youtube_url(url) {
        return extract_youtube(url);
    }

    // Bilibili has the same problem as YouTube — homepage share links carry
    // only SPA boilerplate. We hit the public `view` API by BV id instead.
    if crate::bilibili::is_bilibili_url(url) {
        return extract_bilibili(url);
    }

    let html = fetch_html(url)?;
    let doc = Html::parse_document(&html);

    let title = extract_title(&doc).unwrap_or_default();
    let favicon = extract_favicon(&doc, url);
    let og_image = extract_og_image(&doc, url);
    let content = extract_main_content(&doc);
    let raw_content = extract_all_body_text(&doc);

    if content.len() < 50 && raw_content.len() < 50 {
        return Err("Extracted content too short, page may require JavaScript rendering".into());
    }

    Ok(ExtractedPage {
        title,
        content,
        raw_content,
        favicon,
        og_image,
    })
}

fn extract_bilibili(url: &str) -> Result<ExtractedPage, String> {
    let v = crate::bilibili::fetch_video(url)?;

    let mut parts: Vec<String> = Vec::new();
    if !v.uploader.is_empty() {
        parts.push(format!("UP主：{}", v.uploader));
    }
    if let Some(sec) = v.duration_sec {
        // Render as `MM:SS` / `H:MM:SS` so the clip header reads naturally.
        let (h, m, s) = (sec / 3600, (sec % 3600) / 60, sec % 60);
        let dur = if h > 0 {
            format!("{h}:{m:02}:{s:02}")
        } else {
            format!("{m}:{s:02}")
        };
        parts.push(format!("时长：{dur}"));
    }
    parts.push(format!("BV号：{}", v.bvid));
    if !v.description.trim().is_empty() {
        parts.push(format!("## 视频简介\n\n{}", v.description.trim()));
    } else {
        parts.push(
            "## 视频简介\n\n（该视频无简介。未来版本将补充自动字幕转录。）".to_string(),
        );
    }

    let content = parts.join("\n\n");
    Ok(ExtractedPage {
        title: v.title,
        raw_content: content.clone(),
        content,
        favicon: "https://www.bilibili.com/favicon.ico".into(),
        og_image: v.thumbnail,
    })
}

fn extract_youtube(url: &str) -> Result<ExtractedPage, String> {
    let v = crate::youtube::fetch_video(url)?;

    // Compose `content` so the user sees WHAT the video is about AND WHAT
    // was said. Transcript is labeled so it's obvious where it came from.
    let mut parts: Vec<String> = Vec::new();
    if !v.channel.is_empty() {
        parts.push(format!("频道：{}", v.channel));
    }
    if !v.description.trim().is_empty() {
        parts.push(format!("## 视频简介\n\n{}", v.description.trim()));
    }
    match v.transcript_source {
        "publisher" => parts.push(format!("## 字幕转录\n\n{}", v.transcript)),
        "auto" => parts.push(format!(
            "## 自动识别转录\n\n> 来源：YouTube 自动字幕\n\n{}",
            v.transcript
        )),
        _ => {
            // No captions available. We still have title + (maybe) description,
            // which is better than nothing; the clip lands in the library and
            // the user can decide whether to keep it.
        }
    }

    let content = parts.join("\n\n");
    // If we got literally nothing (no title, no description, no transcript),
    // surface an error so the caller can fall back to article extraction.
    if content.trim().is_empty() && v.title.trim().is_empty() {
        return Err("无法从该 YouTube 链接提取任何内容".into());
    }

    let final_content = if content.trim().is_empty() {
        "（该视频无字幕，也无可用简介）".to_string()
    } else {
        content
    };
    Ok(ExtractedPage {
        title: if v.title.is_empty() {
            "YouTube 视频".to_string()
        } else {
            v.title
        },
        raw_content: final_content.clone(),
        content: final_content,
        favicon: "https://www.youtube.com/s/desktop/favicon.ico".into(),
        og_image: v.thumbnail,
    })
}

/// Maximum redirect hops to follow.
const MAX_REDIRECTS: u8 = 5;

fn fetch_html(url: &str) -> Result<String, String> {
    let mut current_url = url.to_string();

    // Agent with no auto-redirects so we can validate each hop
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(FETCH_TIMEOUT)
        .build();

    // Manual redirect loop: validate each hop against SSRF rules
    for _ in 0..MAX_REDIRECTS {
        validate_url_safe(&current_url)?;

        let resp = agent
            .get(&current_url)
            .set(
                "User-Agent",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            )
            .set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .set("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")
            .call();

        match resp {
            Ok(r) => return read_html_body(r),
            Err(ureq::Error::Status(status, r)) if (301..=308).contains(&status) => {
                let location = r
                    .header("location")
                    .ok_or_else(|| format!("Redirect {status} without Location header"))?
                    .to_string();
                // Resolve relative redirect URLs; loop re-enters automatically.
                current_url = resolve_url(&location, &current_url);
            }
            Err(ureq::Error::Status(status, _)) => {
                return Err(format!("HTTP {status} from {current_url}"));
            }
            Err(e) => return Err(format!("Failed to fetch URL: {e}")),
        }
    }

    Err(format!("Too many redirects (>{MAX_REDIRECTS})"))
}

fn read_html_body(resp: ureq::Response) -> Result<String, String> {

    let content_type = resp
        .header("Content-Type")
        .unwrap_or("")
        .to_lowercase();

    if !content_type.contains("text/html") && !content_type.contains("application/xhtml") {
        return Err(format!("Not an HTML page: {content_type}"));
    }

    let reader = resp.into_reader().take(MAX_HTML_BYTES);
    let mut body = String::new();
    std::io::BufReader::new(reader)
        .read_to_string(&mut body)
        .map_err(|e| format!("Failed to read response: {e}"))?;

    Ok(body)
}

fn extract_title(doc: &Html) -> Option<String> {
    let sel = Selector::parse("title").ok()?;
    doc.select(&sel)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|t| !t.is_empty())
}

fn extract_favicon(doc: &Html, page_url: &str) -> String {
    // Try <link rel="icon"> variants
    let selectors = [
        r#"link[rel="icon"]"#,
        r#"link[rel="shortcut icon"]"#,
        r#"link[rel="apple-touch-icon"]"#,
    ];

    for sel_str in &selectors {
        if let Ok(sel) = Selector::parse(sel_str) {
            if let Some(el) = doc.select(&sel).next() {
                if let Some(href) = el.value().attr("href") {
                    let resolved = resolve_url(href, page_url);
                    if is_safe_http_url(&resolved) {
                        return resolved;
                    }
                }
            }
        }
    }

    // Fallback: origin/favicon.ico
    if let Ok(parsed) = url::Url::parse(page_url) {
        if matches!(parsed.scheme(), "http" | "https") {
            if let Some(host) = parsed.host_str() {
                return format!("{}://{}/favicon.ico", parsed.scheme(), host);
            }
        }
    }

    String::new()
}

/// Gate-keep URLs that will end up in `<img src>` / `<a href>` on the frontend.
/// Only http/https pass; javascript:/data:/file:/vbscript: etc. are rejected.
fn is_safe_http_url(s: &str) -> bool {
    match url::Url::parse(s) {
        Ok(u) => matches!(u.scheme(), "http" | "https"),
        Err(_) => false,
    }
}

fn resolve_url(href: &str, base: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    if href.starts_with("//") {
        return format!("https:{href}");
    }
    if let Ok(base_url) = url::Url::parse(base) {
        if let Ok(resolved) = base_url.join(href) {
            return resolved.to_string();
        }
    }
    href.to_string()
}

/// Extract Open Graph image from meta tags.
fn extract_og_image(doc: &Html, page_url: &str) -> String {
    let selectors = [
        r#"meta[property="og:image"]"#,
        r#"meta[name="twitter:image"]"#,
    ];
    for sel_str in &selectors {
        if let Ok(sel) = Selector::parse(sel_str) {
            if let Some(el) = doc.select(&sel).next() {
                if let Some(content) = el.value().attr("content") {
                    let url = content.trim();
                    if !url.is_empty() {
                        let resolved = resolve_url(url, page_url);
                        if is_safe_http_url(&resolved) {
                            return resolved;
                        }
                    }
                }
            }
        }
    }
    String::new()
}

/// Extract main content from the parsed HTML document.
fn extract_main_content(doc: &Html) -> String {
    // Priority selectors: try the most specific content containers first
    let content_selectors = [
        "article",
        "[role=\"main\"]",
        "main",
        ".post-content",
        ".article-content",
        ".entry-content",
        ".markdown-body",
        ".post-body",
        "#content",
    ];

    for sel_str in &content_selectors {
        if let Ok(sel) = Selector::parse(sel_str) {
            if let Some(el) = doc.select(&sel).next() {
                let text = collect_text_clean(&el);
                if text.len() >= 100 {
                    return truncate_content(&text);
                }
            }
        }
    }

    // Fallback: use <body> with noise elements removed
    if let Ok(body_sel) = Selector::parse("body") {
        if let Some(body) = doc.select(&body_sel).next() {
            let text = collect_text_excluding_noise(&body);
            return truncate_content(&text);
        }
    }

    String::new()
}

/// Full-body text dump used as the "raw" stage of the clip pipeline.
///
/// Unlike `extract_main_content` (which tries to pick the article container),
/// this walks the entire body, strips only script/style/noscript/svg, and
/// inserts newlines at block-element boundaries so paragraphs stay separate.
/// Noisy output is fine — the AI cleaning stage is designed to strip nav,
/// ads, and comments.
fn extract_all_body_text(doc: &Html) -> String {
    let body_sel = match Selector::parse("body") {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let Some(body) = doc.select(&body_sel).next() else {
        return String::new();
    };
    let mut buf = String::new();
    walk_all_text(&body, &mut buf);
    collapse_blank_lines(&truncate_content(&buf))
}

fn walk_all_text(el: &scraper::ElementRef, out: &mut String) {
    const NOISE: &[&str] = &["script", "style", "noscript", "svg", "template"];
    const BLOCK: &[&str] = &[
        "p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr",
        "blockquote", "pre", "article", "section", "header", "footer",
    ];
    for child in el.children() {
        if let Some(e) = child.value().as_element() {
            let tag = e.name().to_lowercase();
            if NOISE.contains(&tag.as_str()) {
                continue;
            }
            if let Some(er) = scraper::ElementRef::wrap(child) {
                walk_all_text(&er, out);
                if BLOCK.contains(&tag.as_str()) && !out.ends_with('\n') {
                    out.push('\n');
                }
            }
        } else if let Some(text) = child.value().as_text() {
            out.push_str(text);
        }
    }
}

/// Collapse runs of 3+ blank lines into 2, and trim trailing whitespace per
/// line. Keeps the raw dump roughly the same size as the source while letting
/// Markdown viewers show paragraph boundaries.
fn collapse_blank_lines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut blanks = 0usize;
    for line in s.lines() {
        let t = line.trim_end();
        if t.is_empty() {
            blanks += 1;
            if blanks <= 1 {
                out.push('\n');
            }
        } else {
            blanks = 0;
            out.push_str(t);
            out.push('\n');
        }
    }
    out
}

/// Collect text from an element, joining with newlines for block elements.
fn collect_text_clean(el: &scraper::ElementRef) -> String {
    el.text()
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Collect text from body, skipping noise elements (nav, header, footer, etc.).
fn collect_text_excluding_noise(body: &scraper::ElementRef) -> String {
    let noise_tags = ["nav", "header", "footer", "aside", "script", "style", "noscript", "svg"];
    let mut parts = Vec::new();

    for child in body.children() {
        if let Some(el) = child.value().as_element() {
            let tag = el.name().to_lowercase();
            if noise_tags.contains(&tag.as_str()) {
                continue;
            }
            if let Some(el_ref) = scraper::ElementRef::wrap(child) {
                let text = collect_text_clean(&el_ref);
                if !text.is_empty() {
                    parts.push(text);
                }
            }
        }
    }

    parts.join("\n\n")
}

fn truncate_content(text: &str) -> String {
    if text.chars().count() <= MAX_CONTENT_CHARS {
        text.to_string()
    } else {
        text.chars().take(MAX_CONTENT_CHARS).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_url_handles_absolute() {
        assert_eq!(
            resolve_url("https://example.com/icon.png", "https://example.com/page"),
            "https://example.com/icon.png"
        );
    }

    #[test]
    fn resolve_url_handles_protocol_relative() {
        assert_eq!(
            resolve_url("//cdn.example.com/icon.png", "https://example.com/page"),
            "https://cdn.example.com/icon.png"
        );
    }

    #[test]
    fn resolve_url_handles_relative() {
        let result = resolve_url("/favicon.ico", "https://example.com/page");
        assert_eq!(result, "https://example.com/favicon.ico");
    }

    #[test]
    fn extract_from_html() {
        let html = r#"
        <html>
        <head><title>Test Page</title></head>
        <body>
            <nav>Navigation stuff</nav>
            <article>
                <h1>Main Article</h1>
                <p>This is the main content of the article. It contains enough text to pass the minimum threshold for content extraction to work properly in the test.</p>
            </article>
            <footer>Footer stuff</footer>
        </body>
        </html>
        "#;
        let doc = Html::parse_document(html);
        let title = extract_title(&doc).unwrap();
        assert_eq!(title, "Test Page");

        let content = extract_main_content(&doc);
        assert!(content.contains("Main Article"));
        assert!(content.contains("main content"));
        assert!(!content.contains("Navigation stuff"));
    }
}
