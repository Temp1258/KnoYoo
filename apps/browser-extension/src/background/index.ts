/**
 * Background service worker.
 * Handles communication between content scripts, popup, and the desktop app.
 * Manages offline queue for clips when desktop is not running.
 */

import { ping, sendClip, type ClipPayload } from "../utils/api";

// ── Offline queue ────────────────────────────────────────────────────────

interface QueuedClip extends ClipPayload {
  queuedAt: number;
}

async function getQueue(): Promise<QueuedClip[]> {
  const result = await chrome.storage.local.get("clip_queue");
  return result.clip_queue || [];
}

async function setQueue(queue: QueuedClip[]): Promise<void> {
  await chrome.storage.local.set({ clip_queue: queue });
}

async function enqueue(clip: ClipPayload): Promise<void> {
  const queue = await getQueue();
  queue.push({ ...clip, queuedAt: Date.now() });
  await setQueue(queue);
}

async function flushQueue(): Promise<number> {
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
