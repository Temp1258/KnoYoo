/**
 * Background service worker.
 * Handles communication between content scripts, popup, and the desktop app.
 * Manages offline queue for clips when desktop is not running.
 */

import { ping, authCheck, sendClip, sendClipUrl, type ClipPayload } from "../utils/api";

// ── Offline queue ────────────────────────────────────────────────────────

const MAX_QUEUE_SIZE = 100;

interface QueuedClip extends ClipPayload {
  queuedAt: number;
}

// Serialize all queue operations through a promise chain to prevent races
let queueLock: Promise<unknown> = Promise.resolve();
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = queueLock.then(fn, fn);
  queueLock = next.catch(() => {}); // prevent unhandled rejection chain
  return next;
}

async function getQueue(): Promise<QueuedClip[]> {
  const result = await chrome.storage.local.get("clip_queue");
  return result.clip_queue || [];
}

async function setQueue(queue: QueuedClip[]): Promise<void> {
  await chrome.storage.local.set({ clip_queue: queue });
}

// Surface a notification when the offline queue overflows — previously the
// oldest clip got silently dropped and users had no idea they were losing
// saves. Cooldown prevents a fill-up of 50 pages from firing 50 toasts.
const QUEUE_FULL_COOLDOWN_MS = 5 * 60 * 1000;

async function maybeNotifyQueueFull(): Promise<void> {
  const stored = await chrome.storage.local.get("queue_full_last_notified");
  const last = typeof stored.queue_full_last_notified === "number" ? stored.queue_full_last_notified : 0;
  const now = Date.now();
  if (now - last < QUEUE_FULL_COOLDOWN_MS) return;
  await chrome.storage.local.set({ queue_full_last_notified: now });
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "KnoYoo 离线队列已满",
      message: `缓存已达 ${MAX_QUEUE_SIZE} 条上限，最早的收藏已被丢弃。打开桌面端即可同步。`,
      priority: 1,
    });
  } catch (e) {
    // Notifications permission denied is harmless — log and move on.
    console.warn("[KnoYoo] queue-full notification suppressed:", e);
  }
}

async function enqueue(clip: ClipPayload): Promise<void> {
  return withQueueLock(async () => {
    const queue = await getQueue();
    if (queue.length >= MAX_QUEUE_SIZE) {
      // Drop oldest item to make room — and tell the user, so they can
      // open the desktop app before more saves fall off the back.
      queue.shift();
      await maybeNotifyQueueFull();
    }
    queue.push({ ...clip, queuedAt: Date.now() });
    await setQueue(queue);
  });
}

async function flushQueue(): Promise<number> {
  return withQueueLock(async () => {
    const queue = await getQueue();
    if (queue.length === 0) return 0;

    // Queue drains only when the desktop is both reachable AND our token is
    // accepted. Without the auth check, a bad token would send 401 on every
    // item and we'd clear the queue without persisting anything.
    const [isOnline, isAuth] = await Promise.all([ping(), authCheck()]);
    if (!isOnline || !isAuth) return 0;

    let sent = 0;
    const remaining: QueuedClip[] = [];

    for (const item of queue) {
      try {
        await sendClip(item);
        sent++;
      } catch {
        remaining.push(item);
      }
    }

    await setQueue(remaining);
    return sent;
  });
}

// ── Message handler ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SAVE_CLIP") {
    handleSaveClip(message.data as ClipPayload).then(sendResponse);
    return true;
  }

  if (message.type === "CHECK_STATUS") {
    handleCheckStatus().then(sendResponse);
    return true;
  }

  if (message.type === "GET_QUEUE_SIZE") {
    getQueue().then((q) => sendResponse({ size: q.length }));
    return true;
  }

  if (message.type === "FLUSH_QUEUE") {
    flushQueue().then((sent) => sendResponse({ sent }));
    return true;
  }
});

async function handleSaveClip(
  clip: ClipPayload,
): Promise<{ success: boolean; error?: string; queued?: boolean; reason?: "offline" | "auth" }> {
  const [isOnline, isAuth] = await Promise.all([ping(), authCheck()]);

  if (!isOnline) {
    await enqueue(clip);
    return { success: true, queued: true, reason: "offline" };
  }
  if (!isAuth) {
    // Don't queue — queued items silently drain once a token arrives, which
    // is *not* what you want when the token is actively wrong. Surface the
    // error to the popup so the user can re-handshake.
    return { success: false, error: "unauthorized", reason: "auth" };
  }

  try {
    await sendClip(clip);
    return { success: true };
  } catch (err) {
    // Transient send failure: queue for later retry.
    await enqueue(clip);
    return { success: true, queued: true, error: String(err) };
  }
}

async function handleCheckStatus(): Promise<{
  online: boolean;
  authenticated: boolean;
  queueSize: number;
}> {
  const [isOnline, isAuth, queue] = await Promise.all([ping(), authCheck(), getQueue()]);

  // Auto-flush queue only when we can actually deliver items.
  if (isOnline && isAuth && queue.length > 0) {
    flushQueue();
  }

  return { online: isOnline, authenticated: isAuth, queueSize: queue.length };
}

// ── Context menu (right-click) ───────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "import-to-knoyoo",
    title: "Import to KnoYoo",
    contexts: ["link", "selection"],
  });
  chrome.contextMenus.create({
    id: "import-video-to-knoyoo",
    title: "Import Video to KnoYoo",
    contexts: ["link", "selection"],
  });
});

/** Extract a usable URL from context menu info. */
function extractUrl(info: chrome.contextMenus.OnClickData): string | null {
  // Prefer linkUrl (right-click on <a> element)
  if (info.linkUrl) return info.linkUrl;
  // Fall back to selected text if it looks like a URL
  const text = info.selectionText?.trim();
  if (text && /^https?:\/\//i.test(text)) return text;
  return null;
}

chrome.contextMenus.onClicked.addListener(async (info, _tab) => {
  const url = extractUrl(info);
  if (!url) return;

  const isVideo = info.menuItemId === "import-video-to-knoyoo";
  const hint = isVideo ? "video" : "article";

  notify("KnoYoo", `正在抓取${isVideo ? "视频字幕" : "网页"}…`);

  // Single code path: hand the URL to the Rust server, which fetches the
  // page (and for YouTube, the full transcript) and saves the clip. This is
  // more reliable than opening a hidden tab and relying on a content script —
  // YouTube's ytInitialPlayerResponse lives in the initial HTML that the
  // server can retrieve without running any JavaScript.
  try {
    await sendClipUrl(url, hint);
    console.log(`[KnoYoo] Imported ${hint}: ${url}`);
    notify("KnoYoo", isVideo ? "视频已导入（含字幕转录）" : "网页已收藏");
  } catch (err) {
    console.warn(`[KnoYoo] Failed to import ${hint} ${url}:`, err);
    const msg = String(err);
    const isOfflineOrAuth = msg.includes("Failed to fetch") || msg.includes("401");
    if (isOfflineOrAuth) {
      // Queue makes sense only when the desktop is unreachable/unauthed —
      // the same URL will work once it comes back. For 422/5xx from a
      // successful hit, the server already tried html_extract and failed
      // (typical for modern SPAs where the initial HTML has no article
      // content); re-queueing with empty payload would just spam the DB
      // with title-only clips.
      await enqueue({ url, title: url, content: "", source_type: hint });
      notify("KnoYoo 已暂存", "桌面端暂不可用，已加入离线队列");
    } else {
      notify(
        "KnoYoo 导入失败",
        `服务端无法抓取此页面（多为 SPA/登录墙站点）。请打开页面后使用一键收藏`,
      );
    }
  }
});

/** Show a native desktop notification. Silent when the user has denied the
 *  permission — the console warning is still captured in the SW log. */
function notify(title: string, message: string) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
      priority: 0,
    });
  } catch (e) {
    console.warn("[KnoYoo] notification suppressed:", e);
  }
}

// ── Periodic queue flush ─────────────────────────────────────────────────

chrome.alarms.create("flush_queue", { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "flush_queue") {
    flushQueue().then((sent) => {
      if (sent > 0) {
        console.log(`[KnoYoo] Flushed ${sent} queued clips`);
      }
    });
  }
});
