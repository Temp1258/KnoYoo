/**
 * Content script: extracts article content from the current page.
 * Communicates with the background service worker via chrome.runtime messages.
 */

// Simple article extractor that works without external dependencies
// (Readability.js cannot be imported in content scripts easily)

interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  source_type: string;
  favicon: string;
}

function detectSourceType(url: string): string {
  const hostname = new URL(url).hostname;
  if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "video";
  if (hostname.includes("bilibili.com")) return "video";
  if (hostname.includes("twitter.com") || hostname.includes("x.com")) return "tweet";
  if (hostname.includes("github.com")) return "code";
  return "article";
}

function getFavicon(): string {
  const link =
    document.querySelector<HTMLLinkElement>('link[rel="icon"]') ||
    document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
  if (link?.href) return link.href;
  return `${window.location.origin}/favicon.ico`;
}

function extractArticleContent(): string {
  // Try to find main content area
  const selectors = [
    "article",
    '[role="main"]',
    "main",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".content",
    "#content",
    ".markdown-body", // GitHub
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent && el.textContent.trim().length > 200) {
      return cleanText(el);
    }
  }

  // Fallback: get body text, removing nav/header/footer/aside
  const body = document.body.cloneNode(true) as HTMLElement;
  const removeSelectors = ["nav", "header", "footer", "aside", "script", "style", ".sidebar", ".comments"];
  for (const sel of removeSelectors) {
    body.querySelectorAll(sel).forEach((el) => el.remove());
  }

  return cleanText(body);
}

function cleanText(el: Element): string {
  // Convert to readable text, preserving some structure
  const lines: string[] = [];

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) lines.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = (node as Element).tagName?.toLowerCase();
    if (["script", "style", "noscript"].includes(tag)) return;

    // Add line breaks for block elements
    const isBlock = ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "br", "tr", "blockquote", "pre"].includes(tag);
    if (isBlock && lines.length > 0) lines.push("");

    // Add markdown-style headings
    if (tag.match(/^h[1-6]$/)) {
      const level = parseInt(tag[1]);
      const prefix = "#".repeat(level) + " ";
      const text = (node as Element).textContent?.trim();
      if (text) {
        lines.push(prefix + text);
        return; // Don't recurse into headings
      }
    }

    for (const child of node.childNodes) {
      walk(child);
    }
  }

  walk(el);

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 50000); // Cap at 50k chars
}

function extractVideoInfo(): string {
  const hostname = window.location.hostname;

  if (hostname.includes("youtube.com")) {
    const desc = document.querySelector("#description-inline-expander, #description")?.textContent?.trim();
    return desc || document.title;
  }

  if (hostname.includes("bilibili.com")) {
    const desc = document.querySelector(".basic-desc-info, .desc-info-text")?.textContent?.trim();
    return desc || document.title;
  }

  return document.title;
}

function extractTweet(): string {
  const tweetEl = document.querySelector('[data-testid="tweetText"]');
  return tweetEl?.textContent?.trim() || document.title;
}

function extractPageContent(): ExtractedContent {
  const url = window.location.href;
  const title = document.title;
  const sourceType = detectSourceType(url);
  const favicon = getFavicon();

  let content: string;
  switch (sourceType) {
    case "video":
      content = extractVideoInfo();
      break;
    case "tweet":
      content = extractTweet();
      break;
    default:
      content = extractArticleContent();
  }

  return { url, title, content, source_type: sourceType, favicon };
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "EXTRACT_CONTENT") {
    try {
      const data = extractPageContent();
      sendResponse({ success: true, data });
    } catch (err) {
      sendResponse({ success: false, error: String(err) });
    }
  }
  return true; // Keep channel open for async response
});
