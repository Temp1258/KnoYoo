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
    pub content: String,
    pub favicon: String,
    pub og_image: String,
}

/// Fetch a URL and extract its main content.
pub fn fetch_and_extract(url: &str) -> Result<ExtractedPage, String> {
    let html = fetch_html(url)?;
    let doc = Html::parse_document(&html);

    let title = extract_title(&doc).unwrap_or_default();
    let favicon = extract_favicon(&doc, url);
    let og_image = extract_og_image(&doc, url);
    let content = extract_main_content(&doc);

    if content.len() < 50 {
        return Err("Extracted content too short, page may require JavaScript rendering".into());
    }

    Ok(ExtractedPage {
        title,
        content,
        favicon,
        og_image,
    })
}

fn fetch_html(url: &str) -> Result<String, String> {
    let resp = ureq::get(url)
        .set(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        .set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .set("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")
        .timeout(FETCH_TIMEOUT)
        .call()
        .map_err(|e| format!("Failed to fetch URL: {e}"))?;

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
                    return resolve_url(href, page_url);
                }
            }
        }
    }

    // Fallback: origin/favicon.ico
    if let Ok(parsed) = url::Url::parse(page_url) {
        return format!("{}://{}/favicon.ico", parsed.scheme(), parsed.host_str().unwrap_or(""));
    }

    String::new()
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
                        return resolve_url(url, page_url);
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
