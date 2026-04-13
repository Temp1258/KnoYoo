/**
 * Background service worker.
 * Handles communication between content scripts, popup, and the desktop app.
 * Manages offline queue for clips when desktop is not running.
 */

import { ping, sendClip, sendClipUrl, type ClipPayload } from "../utils/api";

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

async function enqueue(clip: ClipPayload): Promise<void> {
  return withQueueLock(async () => {
    const queue = await getQueue();
    if (queue.length >= MAX_QUEUE_SIZE) {
      // Drop oldest item to make room
      queue.shift();
    }
    queue.push({ ...clip, queuedAt: Date.now() });
    await setQueue(queue);
  });
}

async function flushQueue(): Promise<number> {
  return withQueueLock(async () => {
    const queue = await getQueue();
    if (queue.length === 0) return 0;

    const isOnline = await ping();
    if (!isOnline) return 0;

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

async function handleSaveClip(clip: ClipPayload): Promise<{ success: boolean; error?: string; queued?: boolean }> {
  const isOnline = await ping();

  if (!isOnline) {
    await enqueue(clip);
    return { success: true, queued: true };
  }

  try {
    await sendClip(clip);
    return { success: true };
  } catch (err) {
    // If send fails, queue it
    await enqueue(clip);
    return { success: true, queued: true, error: String(err) };
  }
}

async function handleCheckStatus(): Promise<{ online: boolean; queueSize: number }> {
  const [isOnline, queue] = await Promise.all([ping(), getQueue()]);

  // Auto-flush queue when desktop comes online
  if (isOnline && queue.length > 0) {
    flushQueue(); // fire and forget
  }

  return { online: isOnline, queueSize: queue.length };
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

  if (isVideo) {
    // Video: open in background tab → content script extracts subtitles → send rich clip
    await importVideoViaTab(url);
  } else {
    // Article: server-side fetch & extract
    try {
      await sendClipUrl(url, "article");
      console.log(`[KnoYoo] Imported article: ${url}`);
    } catch (err) {
      console.warn(`[KnoYoo] Failed to import ${url}:`, err);
      await enqueue({ url, title: url, content: "", source_type: "article" });
    }
  }
});

/** Open URL in a hidden tab, extract content via content script, then save. */
async function importVideoViaTab(url: string): Promise<void> {
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    if (!tabId) throw new Error("Failed to create tab");

    // Wait for page to fully load
    await waitForTabLoad(tabId);

    // Ask content script to extract (includes subtitle extraction)
    const response = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_CONTENT" });
    await chrome.tabs.remove(tabId);

    if (response?.success && response.data) {
      await sendClip({
        url: response.data.url,
        title: response.data.title,
        content: response.data.content,
        source_type: "video",
        favicon: response.data.favicon,
      });
      console.log(`[KnoYoo] Imported video: ${url}`);
    } else {
      throw new Error(response?.error || "Content extraction failed");
    }
  } catch (err) {
    // Clean up tab if still open
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
    console.warn(`[KnoYoo] Failed to import video ${url}:`, err);
    await enqueue({ url, title: url, content: "", source_type: "video" });
  }
}

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, 30000);

    function listener(id: number, changeInfo: chrome.tabs.TabChangeInfo) {
      if (id === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        // Give content script + SPA (YouTube) time to fully render
        setTimeout(resolve, 4000);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
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
