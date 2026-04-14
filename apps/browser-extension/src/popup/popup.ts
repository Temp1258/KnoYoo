/**
 * Popup UI — vanilla TypeScript (no framework, keep it lightweight).
 */

import { getToken, setToken, ping, authCheck, autoHandshake, reHandshake } from "../utils/api";

interface PageInfo {
  url: string;
  title: string;
  content: string;
  raw_content: string;
  source_type: string;
  favicon: string;
  charCount: number;
}

interface Status {
  online: boolean;
  authenticated: boolean;
  queueSize: number;
}

let pageInfo: PageInfo | null = null;
let status: Status = { online: false, authenticated: false, queueSize: 0 };
let showTokenInput = false;
let authError = false;
let rehandshaking = false;

const app = document.getElementById("app")!;

function render() {
  // Three-state indicator: offline, auth-failed, fully connected.
  // Queueing against a mismatched token silently loses work, so we make the
  // distinction loud in the UI and offer a one-click re-handshake.
  const isUsable = status.online && status.authenticated;
  const statusClass = !status.online ? "offline" : isUsable ? "online" : "warn";
  const statusText = !status.online
    ? "桌面端离线"
    : isUsable
      ? "桌面端已连接"
      : "Token 不匹配，点击下方重新握手";

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

  const authFailed = status.online && !status.authenticated;
  const tokenSection = showTokenInput
    ? `<div class="settings">
        <div class="settings-header" id="toggleSettings">
          <span>连接设置</span>
          <span class="settings-arrow">&#x25B4;</span>
        </div>
        ${authError || authFailed ? '<div class="auth-error">Token 不匹配，可输入正确 Token 或重新握手</div>' : ""}
        <div class="settings-row">
          <input type="text" id="tokenInput" placeholder="从桌面端复制 Token" />
          <button class="verify-btn" id="verifyBtn">验证</button>
        </div>
        <button class="rehandshake-btn" id="rehandshakeBtn" ${rehandshaking ? "disabled" : ""}>
          ${rehandshaking ? "重新握手中…" : "🔄 一键重新握手（清除旧 Token 并重新连接）"}
        </button>
        <div class="verify-result" id="verifyResult"></div>
      </div>`
    : `<div class="settings-toggle" id="toggleSettings">${authFailed ? "⚠️ 连接设置" : "连接设置"} <span class="settings-arrow">&#x25BE;</span></div>`;

  app.innerHTML = `
    <div class="header">
      <img class="logo" src="icons/icon48.png" alt="K" />
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
    ${tokenSection}

    <div class="settings-toggle" style="margin-top: 6px; display: flex; align-items: center; gap: 8px;">
      <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: #8888a0;">
        <input type="checkbox" id="autoPopupToggle" style="cursor: pointer;" />
        自动弹窗提示收藏
      </label>
    </div>
  `;

  // Bind events
  document.getElementById("saveBtn")?.addEventListener("click", handleSave);
  document.getElementById("toggleSettings")?.addEventListener("click", () => {
    showTokenInput = !showTokenInput;
    authError = false;
    render();
  });
  document.getElementById("verifyBtn")?.addEventListener("click", handleVerifyToken);
  document.getElementById("rehandshakeBtn")?.addEventListener("click", handleRehandshake);
  const tokenInput = document.getElementById("tokenInput") as HTMLInputElement;
  if (tokenInput) {
    getToken().then((t) => {
      tokenInput.value = t;
    });
    tokenInput.addEventListener("change", () => {
      setToken(tokenInput.value.trim());
      authError = false;
    });
  }

  // Auto-popup toggle
  const autoPopupToggle = document.getElementById("autoPopupToggle") as HTMLInputElement;
  if (autoPopupToggle) {
    chrome.storage.local.get("auto_popup_enabled", (result) => {
      autoPopupToggle.checked = result.auto_popup_enabled !== false;
    });
    autoPopupToggle.addEventListener("change", () => {
      chrome.storage.local.set({ auto_popup_enabled: autoPopupToggle.checked });
    });
  }
}

async function handleVerifyToken() {
  const tokenInput = document.getElementById("tokenInput") as HTMLInputElement;
  const resultEl = document.getElementById("verifyResult")!;
  const btn = document.getElementById("verifyBtn") as HTMLButtonElement;

  if (!tokenInput?.value.trim()) {
    resultEl.className = "verify-result error";
    resultEl.textContent = "请输入 Token";
    return;
  }

  await setToken(tokenInput.value.trim());
  btn.disabled = true;
  btn.textContent = "...";
  resultEl.textContent = "";

  // Actually hit the authenticated endpoint — ping alone tells us nothing
  // about whether THIS token is accepted. Distinguish the three outcomes.
  const [isOnline, isAuth] = await Promise.all([ping(), authCheck()]);
  btn.disabled = false;
  btn.textContent = "验证";

  if (!isOnline) {
    resultEl.className = "verify-result error";
    resultEl.textContent = "桌面端未运行，请先启动 KnoYoo";
    return;
  }
  if (!isAuth) {
    resultEl.className = "verify-result error";
    resultEl.textContent = "Token 不匹配，请检查是否从桌面端复制的最新值";
    authError = true;
    return;
  }
  resultEl.className = "verify-result success";
  resultEl.textContent = "Token 已保存，桌面端已连接";
  authError = false;
  status = { ...status, online: true, authenticated: true };
  setTimeout(() => {
    showTokenInput = false;
    render();
  }, 1500);
}

async function handleRehandshake() {
  const resultEl = document.getElementById("verifyResult")!;
  rehandshaking = true;
  render();
  const ok = await reHandshake();
  rehandshaking = false;
  if (ok) {
    const resp = await chrome.runtime.sendMessage({ type: "CHECK_STATUS" });
    if (resp) status = resp;
    authError = false;
    render();
    const latest = document.getElementById("verifyResult");
    if (latest) {
      latest.className = "verify-result success";
      latest.textContent = "重新握手成功，已自动保存新 Token";
    }
    setTimeout(() => {
      showTokenInput = false;
      render();
    }, 1800);
  } else {
    render();
    const latest = document.getElementById("verifyResult");
    if (latest) {
      latest.className = "verify-result error";
      latest.textContent = "重新握手失败：请确认桌面端正在运行";
    }
    // re-bind resultEl var (we just re-rendered)
    if (resultEl) {
      /* noop: kept for reference; latest is the live node after render */
    }
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
      raw_content: pageInfo.raw_content,
      source_type: pageInfo.source_type,
      favicon: pageInfo.favicon,
    },
  });

  if (response?.success) {
    if (response.queued) {
      btn.className = "save-btn queued";
      btn.innerHTML =
        response.reason === "offline"
          ? "📦 已暂存，等待桌面端上线"
          : "📦 已暂存，等待连接恢复";
    } else {
      btn.className = "save-btn success";
      btn.innerHTML = "✓ 已收藏";
    }
  } else {
    const isAuthErr =
      response?.reason === "auth" ||
      response?.error?.includes("401") ||
      response?.error?.includes("unauthorized");
    if (isAuthErr) {
      authError = true;
      showTokenInput = true;
    }
    btn.className = "save-btn primary";
    btn.textContent = isAuthErr ? "Token 不匹配，请重新握手" : "收藏失败，点击重试";
    btn.disabled = false;
    if (isAuthErr) render();
  }
}

async function init() {
  render();

  // Try auto-handshake if no token configured
  const token = await getToken();
  if (!token) {
    const handshakeOk = await autoHandshake();
    if (handshakeOk) {
      status.online = true;
    }
  }

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
        raw_content: "",
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
