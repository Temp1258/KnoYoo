/**
 * Popup UI — vanilla TypeScript (no framework, keep it lightweight).
 */

import { getToken, setToken } from "../utils/api";

interface PageInfo {
  url: string;
  title: string;
  content: string;
  source_type: string;
  favicon: string;
  charCount: number;
}

interface Status {
  online: boolean;
  queueSize: number;
}

let pageInfo: PageInfo | null = null;
let status: Status = { online: false, queueSize: 0 };

const app = document.getElementById("app")!;

function render() {
  const statusClass = status.online ? "online" : "offline";
  const statusText = status.online ? "桌面端已连接" : "桌面端离线";

  const pageSection = pageInfo
    ? `<div class="page-info">
        <div class="page-title">${escapeHtml(pageInfo.title || "无标题")}</div>
        <div class="page-domain">${escapeHtml(getDomain(pageInfo.url))}</div>
        <div class="page-stats">正文已提取，约 ${pageInfo.charCount} 字</div>
      </div>`
    : `<div class="page-info"><div class="page-title">正在提取页面内容...</div></div>`;

  const queueInfo =
    status.queueSize > 0
      ? `<div class="queue-info">有 ${status.queueSize} 条待同步，桌面端上线后自动发送</div>`
      : "";

  app.innerHTML = `
    <div class="header">
      <div class="logo">K</div>
      <div class="header-text">
        <h1>KnoYoo</h1>
        <div class="subtitle">网页收藏助手</div>
      </div>
    </div>

    <div class="status">
      <span class="status-dot ${statusClass}"></span>
      <span>${statusText}</span>
    </div>

    ${pageSection}

    <button class="save-btn primary" id="saveBtn" ${!pageInfo ? "disabled" : ""}>
      ⚡ 一键收藏
    </button>

    ${queueInfo}

    <div class="settings">
      <div class="settings-row">
        <label>Token:</label>
        <input type="text" id="tokenInput" placeholder="从桌面端复制 Token" />
      </div>
    </div>
  `;

  // Bind events
  document.getElementById("saveBtn")?.addEventListener("click", handleSave);
  const tokenInput = document.getElementById("tokenInput") as HTMLInputElement;
  if (tokenInput) {
    getToken().then((t) => {
      tokenInput.value = t;
    });
    tokenInput.addEventListener("change", () => {
      setToken(tokenInput.value.trim());
    });
  }
}

async function handleSave() {
  if (!pageInfo) return;

  const btn = document.getElementById("saveBtn") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "保存中...";

  const response = await chrome.runtime.sendMessage({
    type: "SAVE_CLIP",
    data: {
      url: pageInfo.url,
      title: pageInfo.title,
      content: pageInfo.content,
      source_type: pageInfo.source_type,
      favicon: pageInfo.favicon,
    },
  });

  if (response?.success) {
    if (response.queued) {
      btn.className = "save-btn queued";
      btn.innerHTML = "📦 已暂存，等待桌面端上线";
    } else {
      btn.className = "save-btn success";
      btn.innerHTML = "✓ 已收藏";
    }
  } else {
    btn.className = "save-btn primary";
    btn.textContent = "收藏失败，点击重试";
    btn.disabled = false;
  }
}

async function init() {
  render();

  // Check desktop status
  const statusResp = await chrome.runtime.sendMessage({ type: "CHECK_STATUS" });
  if (statusResp) {
    status = statusResp;
  }

  // Extract content from current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONTENT" });
      if (response?.success) {
        pageInfo = {
          ...response.data,
          charCount: response.data.content?.length || 0,
        };
      }
    } catch {
      // Content script might not be injected (e.g., chrome:// pages)
      pageInfo = {
        url: tab.url || "",
        title: tab.title || "",
        content: "",
        source_type: "article",
        favicon: tab.favIconUrl || "",
        charCount: 0,
      };
    }
  }

  render();
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();
