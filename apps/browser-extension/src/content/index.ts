/**
 * Content script: extracts article content from the current page
 * and shows an auto-popup asking user to clip to KnoYoo.
 */

// ── Types ────────────────────────────────────────────────────────────────

interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  source_type: string;
  favicon: string;
}

// ── Content extraction ───────────────────────────────────────────────────

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
  const selectors = [
    "article",
    '[role="main"]',
    "main",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".content",
    "#content",
    ".markdown-body",
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent && el.textContent.trim().length > 200) {
      return cleanText(el);
    }
  }

  const body = document.body.cloneNode(true) as HTMLElement;
  const removeSelectors = ["nav", "header", "footer", "aside", "script", "style", ".sidebar", ".comments"];
  for (const sel of removeSelectors) {
    body.querySelectorAll(sel).forEach((el) => el.remove());
  }

  return cleanText(body);
}

function cleanText(el: Element): string {
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

    const isBlock = ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "br", "tr", "blockquote", "pre"].includes(tag);
    if (isBlock && lines.length > 0) lines.push("");

    if (tag.match(/^h[1-6]$/)) {
      const level = parseInt(tag[1]);
      const prefix = "#".repeat(level) + " ";
      const text = (node as Element).textContent?.trim();
      if (text) {
        lines.push(prefix + text);
        return;
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
    .slice(0, 50000);
}

async function extractVideoInfo(): Promise<string> {
  const hostname = window.location.hostname;

  if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
    const { extractYouTubeSubtitles } = await import("./subtitles");
    const subtitles = await extractYouTubeSubtitles();
    if (subtitles) return subtitles;
    // Fallback: try multiple description selectors
    const descSelectors = [
      "#description-inline-expander",
      "#description",
      "ytd-text-inline-expander",
      "#info-container #description",
      'meta[name="description"]',
    ];
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      const text = sel.startsWith("meta")
        ? (el as HTMLMetaElement)?.content?.trim()
        : el?.textContent?.trim();
      if (text && text.length > 20) return text;
    }
    // Last resort: gather all meta info
    const metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const metaKeywords = document.querySelector('meta[name="keywords"]') as HTMLMetaElement | null;
    const parts = [document.title, metaDesc?.content, metaKeywords?.content].filter(Boolean);
    return parts.join("\n\n") || document.title;
  }

  if (hostname.includes("bilibili.com")) {
    const { extractBilibiliSubtitles } = await import("./subtitles");
    const subtitles = await extractBilibiliSubtitles();
    if (subtitles) return subtitles;
    // Fallback: multiple selectors
    const descSelectors = [
      ".basic-desc-info",
      ".desc-info-text",
      "#v_desc .info",
      'meta[name="description"]',
    ];
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      const text = sel.startsWith("meta")
        ? (el as HTMLMetaElement)?.content?.trim()
        : el?.textContent?.trim();
      if (text && text.length > 20) return text;
    }
    const metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    return metaDesc?.content || document.title;
  }

  return document.title;
}

function extractTweet(): string {
  const tweetEl = document.querySelector('[data-testid="tweetText"]');
  return tweetEl?.textContent?.trim() || document.title;
}

async function extractPageContent(): Promise<ExtractedContent> {
  const url = window.location.href;
  const title = document.title;
  const sourceType = detectSourceType(url);
  const favicon = getFavicon();

  let content: string;
  switch (sourceType) {
    case "video":
      content = await extractVideoInfo();
      break;
    case "tweet":
      content = extractTweet();
      break;
    default:
      content = extractArticleContent();
  }

  return { url, title, content, source_type: sourceType, favicon };
}

// ── Message listener (for popup manual clip) ─────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "EXTRACT_CONTENT") {
    extractPageContent()
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true; // keep sendResponse alive for async
  }
  return true;
});

// ── Auto-popup: small floating toast on every new page ───────────────────

const SKIP_PATTERNS = [
  /^chrome/,
  /^about:/,
  /^chrome-extension:/,
  /^moz-extension:/,
  /^edge:/,
  /^file:/,
];

function shouldSkipPage(): boolean {
  const url = window.location.href;
  return SKIP_PATTERNS.some((p) => p.test(url));
}

function showClipToast() {
  if (shouldSkipPage()) return;

  // Don't show if already shown on this page
  if (document.querySelector("knoyoo-clip-toast")) return;

  const host = document.createElement("knoyoo-clip-toast");
  const shadow = host.attachShadow({ mode: "closed" });

  const title = document.title || window.location.hostname;
  const truncatedTitle = title.length > 40 ? title.slice(0, 40) + "..." : title;

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }
      .toast {
        background: #1a1a2e;
        border: 1px solid rgba(108, 92, 231, 0.4);
        border-radius: 12px;
        padding: 12px 16px;
        width: 260px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease-out;
        color: #e8e8f0;
        font-size: 13px;
      }
      @keyframes slideIn {
        from { opacity: 0; transform: translateX(40px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes slideOut {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(40px); }
      }
      .toast.hiding {
        animation: slideOut 0.2s ease-in forwards;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
      }
      .logo {
        width: 20px;
        height: 20px;
        border-radius: 5px;
        flex-shrink: 0;
        object-fit: cover;
      }
      .label {
        font-size: 12px;
        color: #8888a0;
      }
      .title {
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 10px;
        line-height: 1.3;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .btns {
        display: flex;
        gap: 8px;
      }
      button {
        flex: 1;
        padding: 6px 0;
        border: none;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.15s;
      }
      button:hover { opacity: 0.85; }
      button:active { transform: scale(0.97); }
      .confirm {
        background: #6c5ce7;
        color: white;
      }
      .cancel {
        background: rgba(255,255,255,0.08);
        color: #8888a0;
      }
      .saving {
        text-align: center;
        color: #8888a0;
        font-size: 12px;
        padding: 4px 0;
      }
      .result {
        text-align: center;
        font-size: 12px;
        font-weight: 600;
        padding: 4px 0;
      }
      .result.ok { color: #2ed573; }
      .result.fail { color: #ff4757; }
    </style>
    <div class="toast" id="toast">
      <div class="header">
        <img class="logo" src="${chrome.runtime.getURL("icons/icon48.png")}" alt="K" />
        <span class="label">收藏到 KnoYoo？</span>
      </div>
      <div class="title" id="pageTitle">${escapeHtml(truncatedTitle)}</div>
      <div class="btns" id="btns">
        <button class="cancel" id="cancelBtn">取消</button>
        <button class="confirm" id="confirmBtn">收藏</button>
      </div>
    </div>
  `;

  function dismiss() {
    const toast = shadow.getElementById("toast");
    if (!toast) return;
    toast.classList.add("hiding");
    setTimeout(() => host.remove(), 200);
  }

  shadow.getElementById("cancelBtn")!.addEventListener("click", dismiss);

  shadow.getElementById("confirmBtn")!.addEventListener("click", async () => {
    const btns = shadow.getElementById("btns")!;
    btns.innerHTML = '<div class="saving">保存中...</div>';

    try {
      const data = await extractPageContent();
      const response = await chrome.runtime.sendMessage({
        type: "SAVE_CLIP",
        data: {
          url: data.url,
          title: data.title,
          content: data.content,
          source_type: data.source_type,
          favicon: data.favicon,
        },
      });

      if (response?.success) {
        btns.innerHTML = response.queued
          ? '<div class="result ok">已暂存，桌面端上线后同步</div>'
          : '<div class="result ok">已收藏</div>';
      } else {
        btns.innerHTML = '<div class="result fail">收藏失败</div>';
      }
    } catch {
      btns.innerHTML = '<div class="result fail">收藏失败</div>';
    }

    setTimeout(dismiss, 1200);
  });

  // Auto-dismiss after 8 seconds if no interaction
  const autoTimer = setTimeout(dismiss, 8000);
  shadow.getElementById("toast")!.addEventListener("mouseenter", () => clearTimeout(autoTimer));

  document.body.appendChild(host);
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Show toast by default; user can disable in extension popup settings
chrome.storage.local.get("auto_popup_enabled", (result) => {
  if (result.auto_popup_enabled !== false) {
    showClipToast();
  }
});
