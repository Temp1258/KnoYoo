import { useState, useEffect, useRef, useMemo } from "react";
import {
  ArrowLeft,
  ExternalLink,
  Star,
  Tag,
  X,
  Pencil,
  RefreshCw,
  Check,
  Plus,
  Minus,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  BookOpen,
  BookOpenCheck,
  NotebookPen,
  Trash2,
  Download,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { WebClip, ClipNote } from "../../types";
import { formatClipDomain, isSafeUrl } from "../../utils/url";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Button from "../ui/Button";
import TranscribeProgress from "./TranscribeProgress";
import { useExport } from "../../hooks/useExport";
import { useToast } from "../common/toast-context";

type Props = {
  clip: WebClip;
  onBack: () => void;
  onStar: (id: number) => void;
  onUpdate?: (clip: WebClip) => void;
  compact?: boolean;
};

type Heading = { level: number; text: string; id: string };

function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  const regex = /^(#{1,3})\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, "-")
      .replace(/^-|-$/g, "");
    headings.push({ level: match[1].length, text, id });
  }
  return headings;
}

const DEFAULT_FONT_SIZE = 14;
const FONT_SIZE_KEY = "knoyoo-clip-font-size";

function formatDuration(sec: number): string {
  if (!sec || sec < 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Rust backend writes `subtitle` / `asr:openai` / ... — format for humans. */
function formatTranscriptionSource(source: string): string {
  if (source === "subtitle") return "字幕";
  if (source.startsWith("asr:")) {
    const id = source.slice(4);
    const label =
      id === "openai"
        ? "OpenAI"
        : id === "deepgram"
          ? "Deepgram"
          : id === "siliconflow"
            ? "SiliconFlow"
            : id;
    return `ASR · ${label}`;
  }
  return source;
}

export default function ClipDetail({ clip, onBack, onStar, onUpdate, compact }: Props) {
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(clip.summary);
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState<string[]>(clip.tags);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);

  // Reading progress. We write the bar's width directly via ref + rAF
  // instead of setState to avoid re-rendering the whole detail view (which
  // includes a potentially huge ReactMarkdown tree) on every scroll event.
  // Scroll handlers that setState cause noticeable jank on long articles.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Font size
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem(FONT_SIZE_KEY);
    return saved ? Number(saved) : DEFAULT_FONT_SIZE;
  });

  // Content view toggle: readable (AI-cleaned) / raw dump / translated
  // (AI-produced Chinese Markdown). Each mode is hidden when the backing
  // field is empty, so the toggle only offers what actually exists.
  //
  // Per-clip state reset is handled by the parent passing `key={clip.id}`
  // (see ClipsPage) — a new clip remounts the component, so useState's
  // initializer picks the right default without needing an effect.
  const hasRaw = !!clip.raw_content;
  const hasTranslated = !!clip.translated_content;
  const [viewMode, setViewMode] = useState<"readable" | "raw" | "translated">(
    hasTranslated ? "translated" : "readable",
  );

  const displayedContent =
    viewMode === "raw" && hasRaw
      ? clip.raw_content
      : viewMode === "translated" && hasTranslated
        ? (clip.translated_content ?? "")
        : clip.content;

  // TOC
  const [tocExpanded, setTocExpanded] = useState(false);
  const headings = useMemo(() => extractHeadings(displayedContent), [displayedContent]);

  // Export
  const { exportClip } = useExport();
  const { showToast } = useToast();

  // Related clips
  const [relatedClips, setRelatedClips] = useState<WebClip[]>([]);

  // User notes
  const [note, setNote] = useState<ClipNote | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  // Find nearest scrollable ancestor and drive progress bar directly via
  // ref/rAF — no React state, no re-render on scroll.
  useEffect(() => {
    const findScrollParent = (el: HTMLElement | null): HTMLElement | null => {
      if (!el) return null;
      const parent = el.parentElement;
      if (!parent) return null;
      const style = getComputedStyle(parent);
      if (
        parent.scrollHeight > parent.clientHeight &&
        (style.overflowY === "auto" || style.overflowY === "scroll")
      ) {
        return parent;
      }
      return findScrollParent(parent);
    };
    const container = findScrollParent(scrollRef.current);
    if (!container) return;

    const update = () => {
      rafIdRef.current = null;
      const bar = progressBarRef.current;
      if (!bar) return;
      const scrollable = container.scrollHeight - container.clientHeight;
      const pct = scrollable > 0 ? (container.scrollTop / scrollable) * 100 : 0;
      bar.style.width = `${pct}%`;
    };
    const onScroll = () => {
      // Coalesce scroll events into one rAF-aligned DOM write.
      if (rafIdRef.current != null) return;
      rafIdRef.current = requestAnimationFrame(update);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    update(); // initial paint
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [clip.id]);

  useEffect(() => {
    localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
  }, [fontSize]);

  // Auto-mark as read (fire-and-forget, no stale concern)
  useEffect(() => {
    if (!clip.is_read) {
      tauriInvoke("mark_clip_read", { id: clip.id }).catch(console.error);
    }
  }, [clip.id, clip.is_read]);

  // Load related clips + user note with stale-guard
  useEffect(() => {
    let stale = false;
    tauriInvoke<WebClip[]>("find_related_clips", { clipId: clip.id, limit: 5 })
      .then((r) => {
        if (!stale) setRelatedClips(r);
      })
      .catch(console.error);

    tauriInvoke<ClipNote | null>("get_clip_note", { clipId: clip.id })
      .then((n) => {
        if (!stale) setNote(n);
      })
      .catch(console.error);

    return () => {
      stale = true;
    };
  }, [clip.id]);

  // Poll while the AI pipeline is still working. "In-flight" means either:
  //   • transcription pipeline active (video clips only), OR
  //   • summary is still empty on a non-video clip.
  // Video clips get a longer cap (10 min) because transcription runs much
  // longer than a web article's stage 2/3 cleanup.
  const videoActive = (() => {
    const s = clip.transcription_status;
    return s === "pending" || s === "downloading" || s === "transcribing" || s === "cleaning";
  })();
  const articleActive = !videoActive && !clip.summary && clip.source_type !== "video";
  // Hold onUpdate in a ref so the polling useEffect below doesn't reset its
  // 4s interval every time the parent re-renders (which happens on every
  // keystroke, hover, etc). Without this, the interval got torn down and
  // rebuilt multiple times per second, missing status transitions and
  // looking like a stuck "transcoding" UI even after the backend finished.
  //
  // Ref assignment goes in an effect (not directly in render) to satisfy
  // the react-hooks/refs rule — this effect runs after every render, so by
  // the time any polling tick reads `onUpdateRef.current` the ref is
  // guaranteed up to date.
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });
  useEffect(() => {
    if (!videoActive && !articleActive) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const fresh = await tauriInvoke<WebClip>("get_clip", { id: clip.id });
        if (cancelled) return;
        const stillActive =
          fresh.transcription_status === "pending" ||
          fresh.transcription_status === "downloading" ||
          fresh.transcription_status === "transcribing" ||
          fresh.transcription_status === "cleaning" ||
          (!fresh.summary && fresh.source_type !== "video");
        // Always notify parent on change so failed/completed states render.
        if (fresh.updated_at !== clip.updated_at) {
          onUpdateRef.current?.(fresh);
        }
        if (!stillActive) clearInterval(interval);
      } catch {
        // transient — next tick retries
      }
    }, 4000);
    const cap = videoActive ? 600_000 : 60_000;
    const stopTimer = setTimeout(() => clearInterval(interval), cap);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(stopTimer);
    };
  }, [clip.id, clip.updated_at, videoActive, articleActive]);

  const domain = formatClipDomain(clip.url);

  const saveSummary = async () => {
    setSaving(true);
    try {
      const updated = await tauriInvoke<WebClip>("update_web_clip", {
        id: clip.id,
        summary: summaryDraft,
      });
      onUpdate?.(updated);
      setEditingSummary(false);
    } catch (e) {
      console.error("Save summary failed:", e);
    }
    setSaving(false);
  };

  const saveTags = async () => {
    setSaving(true);
    try {
      const updated = await tauriInvoke<WebClip>("update_web_clip", {
        id: clip.id,
        tags: tagsDraft,
      });
      onUpdate?.(updated);
      setEditingTags(false);
    } catch (e) {
      console.error("Save tags failed:", e);
    }
    setSaving(false);
  };

  const resetToAI = async () => {
    setSaving(true);
    try {
      await tauriInvoke("ai_auto_tag_clip", { id: clip.id });
      // Reload clip data
      const clips = await tauriInvoke<WebClip[]>("search_web_clips", {
        q: clip.title.slice(0, 20),
      });
      const updated = clips.find((c) => c.id === clip.id);
      if (updated) onUpdate?.(updated);
    } catch (e) {
      console.error("AI retag failed:", e);
    }
    setSaving(false);
  };

  // AI translation trigger. Calls the backend `ai_translate_clip` command,
  // which detects the source language and writes a Chinese Markdown
  // translation to `translated_content`. The backend is idempotent —
  // re-running overwrites the prior translation, so this doubles as both
  // "生成译文" (first time) and "重新翻译" (retry / refresh).
  const [translating, setTranslating] = useState(false);
  const handleRetranslate = async () => {
    if (translating) return;
    setTranslating(true);
    try {
      await tauriInvoke("ai_translate_clip", { id: clip.id });
      const fresh = await tauriInvoke<WebClip>("get_clip", { id: clip.id });
      onUpdate?.(fresh);
      if (fresh.translated_content) {
        const from = fresh.source_language ? ` ${fresh.source_language.toUpperCase()} →` : "";
        showToast(`已生成${from} 中文译文`, "success");
      } else if (fresh.source_language === "zh") {
        showToast("检测为简体中文，已跳过翻译", "info");
      } else {
        showToast("AI 未返回有效译文，请稍后重试", "error");
      }
    } catch (e) {
      showToast(`翻译失败：${String(e)}`, "error");
    } finally {
      setTranslating(false);
    }
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (tag && !tagsDraft.includes(tag)) {
      setTagsDraft([...tagsDraft, tag]);
      setNewTag("");
    }
  };

  return (
    <div ref={scrollRef}>
      {/* Reading progress bar — width set imperatively via ref to avoid
          re-rendering ReactMarkdown on every scroll tick. */}
      <div
        ref={progressBarRef}
        className="sticky top-0 left-0 h-0.5 bg-accent z-20"
        style={{ width: "0%" }}
      />

      {/* Sticky back button bar */}
      <div className="sticky top-0.5 z-10 bg-bg/80 backdrop-blur-sm -mx-6 px-6 py-3 mb-2 border-b border-transparent [&:not(:first-child)]:border-border">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onBack}>
            {compact ? <X size={14} /> : <ArrowLeft size={14} />}
            {compact ? "关闭" : "返回列表"}
          </Button>
          <div className="flex items-center gap-2">
            {/* Font size controls */}
            <div className="flex items-center gap-0.5 border border-border rounded-md px-1">
              <button
                onClick={() => setFontSize((s) => Math.max(12, s - 1))}
                className="p-0.5 text-text-tertiary hover:text-text cursor-pointer"
                title="缩小字号"
              >
                <Minus size={12} />
              </button>
              <span className="text-[10px] text-text-tertiary w-5 text-center">{fontSize}</span>
              <button
                onClick={() => setFontSize((s) => Math.min(20, s + 1))}
                className="p-0.5 text-text-tertiary hover:text-text cursor-pointer"
                title="放大字号"
              >
                <Plus size={12} />
              </button>
              {fontSize !== DEFAULT_FONT_SIZE && (
                <button
                  onClick={() => setFontSize(DEFAULT_FONT_SIZE)}
                  className="p-0.5 text-text-tertiary hover:text-text cursor-pointer"
                  title="重置字号"
                >
                  <RotateCcw size={10} />
                </button>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const isRead = await tauriInvoke<boolean>("toggle_read_clip", { id: clip.id });
                onUpdate?.({ ...clip, is_read: isRead });
              }}
            >
              {clip.is_read ? <BookOpen size={14} /> : <BookOpenCheck size={14} />}
              {clip.is_read ? "标记未读" : "已读"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onStar(clip.id)}>
              <Star
                size={14}
                fill={clip.is_starred ? "currentColor" : "none"}
                className={clip.is_starred ? "text-yellow-500" : ""}
              />
              {clip.is_starred ? "已星标" : "星标"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportClip(clip.id, clip.title)}
              title="导出为 Markdown"
            >
              <Download size={14} />
            </Button>
            {isSafeUrl(clip.url) ? (
              <a href={clip.url} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="sm">
                  <ExternalLink size={14} />
                  打开原文
                </Button>
              </a>
            ) : (
              <Button variant="ghost" size="sm" disabled title="链接格式无效，无法打开">
                <ExternalLink size={14} />
                打开原文
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Title */}
      <h1 className="text-[22px] font-bold text-text mb-2">
        {clip.title || (videoActive ? "正在获取视频标题…" : "无标题")}
      </h1>

      {/* Meta */}
      <div className="flex items-center gap-3 text-[12px] text-text-tertiary mb-4 flex-wrap">
        <span>{domain}</span>
        <span>{new Date(clip.created_at).toLocaleDateString("zh-CN")}</span>
        <span className="px-1.5 py-0.5 rounded bg-bg-tertiary text-[11px]">{clip.source_type}</span>
        {clip.source_type === "video" && !!clip.audio_duration_sec && (
          <span className="text-[11px]">{formatDuration(clip.audio_duration_sec)}</span>
        )}
        {clip.transcription_source && (
          <span className="px-1.5 py-0.5 rounded bg-bg-tertiary text-[11px]" title="转录来源">
            {formatTranscriptionSource(clip.transcription_source)}
          </span>
        )}
      </div>

      {/* Transcription progress / failure card (video clips only) */}
      <TranscribeProgress
        clip={clip}
        onRetryStarted={async () => {
          // Immediate visual update — flip status to pending so the card
          // swaps to the progress variant without waiting for the next poll.
          onUpdate?.({
            ...clip,
            transcription_status: "pending",
            transcription_error: "",
          });
        }}
      />

      {/* Tags (editable) */}
      <div className="mb-4">
        {editingTags ? (
          <div className="p-3 rounded-xl bg-bg-secondary border border-border">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tagsDraft.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/8 text-accent text-[12px]"
                >
                  {tag}
                  <button
                    onClick={() => setTagsDraft(tagsDraft.filter((t) => t !== tag))}
                    className="hover:text-danger cursor-pointer"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 items-center mb-2">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
                placeholder="输入新标签..."
                className="flex-1 h-7 px-2 text-[12px] bg-bg-tertiary border border-border rounded-md focus:outline-none focus:border-accent"
              />
              <button
                onClick={addTag}
                className="p-1 text-accent hover:bg-accent/10 rounded cursor-pointer"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={saveTags} disabled={saving}>
                <Check size={12} /> 保存
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setTagsDraft(clip.tags);
                  setEditingTags(false);
                }}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="group/tags flex flex-wrap gap-1.5 items-center">
            {clip.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/8 text-accent text-[12px]"
              >
                <Tag size={11} />
                {tag}
              </span>
            ))}
            <button
              onClick={() => {
                setTagsDraft(clip.tags);
                setEditingTags(true);
              }}
              className="p-1 rounded-md text-text-tertiary hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer opacity-0 group-hover/tags:opacity-100"
              title="编辑标签"
            >
              <Pencil size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Summary (editable) */}
      <div className="p-4 rounded-xl bg-accent/5 border border-accent/10 mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] font-medium text-accent">AI 摘要</div>
          <div className="flex items-center gap-1">
            {!editingSummary && (
              <>
                <button
                  onClick={() => {
                    setSummaryDraft(clip.summary);
                    setEditingSummary(true);
                  }}
                  className="p-1 rounded-md text-text-tertiary hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                  title="编辑摘要"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={resetToAI}
                  disabled={saving}
                  className="p-1 rounded-md text-text-tertiary hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                  title="重新 AI 生成"
                >
                  <RefreshCw size={11} className={saving ? "animate-spin" : ""} />
                </button>
              </>
            )}
          </div>
        </div>
        {editingSummary ? (
          <div>
            <textarea
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
              className="w-full h-24 px-3 py-2 text-[13px] bg-bg-secondary border border-border rounded-lg resize-y focus:outline-none focus:border-accent leading-relaxed"
            />
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="primary" onClick={saveSummary} disabled={saving}>
                <Check size={12} /> 保存
              </Button>
              <Button size="sm" onClick={() => setEditingSummary(false)}>
                取消
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-text leading-relaxed m-0">
            {clip.summary || "（暂无摘要，点击编辑或 AI 生成）"}
          </p>
        )}
      </div>

      {/* User Notes */}
      <div className="mb-6">
        {editingNote ? (
          <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/10">
            <div className="text-[11px] font-medium text-green-600 mb-2 flex items-center gap-1">
              <NotebookPen size={12} />
              我的笔记
            </div>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="写下你的理解、想法或笔记..."
              className="w-full h-28 px-3 py-2 text-[13px] bg-bg-secondary border border-border rounded-lg resize-y focus:outline-none focus:border-accent leading-relaxed"
            />
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  setSaving(true);
                  try {
                    const saved = await tauriInvoke<ClipNote>("save_clip_note", {
                      clipId: clip.id,
                      content: noteDraft,
                    });
                    setNote(saved);
                    setEditingNote(false);
                  } catch (e) {
                    console.error("Save note failed:", e);
                  }
                  setSaving(false);
                }}
                disabled={saving}
              >
                <Check size={12} /> 保存
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditingNote(false);
                  setNoteDraft(note?.content || "");
                }}
              >
                取消
              </Button>
            </div>
          </div>
        ) : note?.content ? (
          <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/10">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-medium text-green-600 flex items-center gap-1">
                <NotebookPen size={12} />
                我的笔记
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setNoteDraft(note.content);
                    setEditingNote(true);
                  }}
                  className="p-1 rounded-md text-text-tertiary hover:text-green-600 hover:bg-green-500/10 transition-colors cursor-pointer"
                  title="编辑笔记"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={async () => {
                    try {
                      await tauriInvoke("delete_clip_note", { clipId: clip.id });
                      setNote(null);
                    } catch (e) {
                      // Without this catch, a failed delete still flipped
                      // setNote(null) — UI lied about success and the note
                      // reappeared on next open.
                      showToast(`删除笔记失败：${String(e)}`, "error");
                    }
                  }}
                  className="p-1 rounded-md text-text-tertiary hover:text-danger hover:bg-danger-light transition-colors cursor-pointer"
                  title="删除笔记"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
            <p className="text-[13px] text-text leading-relaxed m-0 whitespace-pre-wrap">
              {note.content}
            </p>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNoteDraft("");
              setEditingNote(true);
            }}
            className="text-green-600"
          >
            <NotebookPen size={14} />
            添加笔记
          </Button>
        )}
      </div>

      {/* TOC */}
      {headings.length >= 3 && (
        <div className="mb-4 rounded-xl bg-bg-secondary border border-border">
          <button
            onClick={() => setTocExpanded(!tocExpanded)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] font-medium text-text-secondary cursor-pointer"
          >
            目录 ({headings.length})
            {tocExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {tocExpanded && (
            <div className="px-4 pb-3 space-y-1">
              {headings.map((h) => (
                <a
                  key={h.id}
                  href={`#${h.id}`}
                  className="block text-[12px] text-text-tertiary hover:text-accent transition-colors"
                  style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  {h.text}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content view toggle + translate action. Shown whenever any
          alternate view exists (raw dump / existing translation) or the
          clip has enough content to translate (≥ 50 chars — matches the
          backend threshold, so an empty/thin clip doesn't offer an
          action that would immediately no-op). */}
      {(hasRaw || hasTranslated || (clip.content?.trim().length ?? 0) >= 50) && (
        <div className="flex items-center gap-1 mb-3 text-[12px]">
          <button
            onClick={() => setViewMode("readable")}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              viewMode === "readable"
                ? "bg-accent/10 text-accent font-medium"
                : "text-text-tertiary hover:text-text"
            }`}
          >
            可读版
          </button>
          {hasRaw && (
            <button
              onClick={() => setViewMode("raw")}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                viewMode === "raw"
                  ? "bg-accent/10 text-accent font-medium"
                  : "text-text-tertiary hover:text-text"
              }`}
              title="未经 AI 清洗的原始抓取文本"
            >
              原始
            </button>
          )}
          {hasTranslated && (
            <button
              onClick={() => setViewMode("translated")}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                viewMode === "translated"
                  ? "bg-accent/10 text-accent font-medium"
                  : "text-text-tertiary hover:text-text"
              }`}
              title={`AI 翻译 · 源语言 ${clip.source_language?.toUpperCase() || "未知"}`}
            >
              中文译文
              {clip.source_language && clip.source_language !== "zh" && (
                <span className="ml-1 text-[10px] opacity-70 font-mono">
                  {clip.source_language.toUpperCase()}
                </span>
              )}
            </button>
          )}
          {!clip.summary && (
            <span className="ml-2 text-[11px] text-text-tertiary italic">AI 正在清洗和总结…</span>
          )}
          {(clip.content?.trim().length ?? 0) >= 50 && (
            <button
              onClick={handleRetranslate}
              disabled={translating}
              className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-text-tertiary hover:text-accent hover:bg-bg-tertiary transition-colors cursor-pointer disabled:opacity-50"
              title={
                hasTranslated ? "用 AI 重新翻译（覆盖当前译文）" : "AI 检测语言并翻译为简体中文"
              }
            >
              <RotateCcw size={11} className={translating ? "animate-spin" : ""} />
              {translating ? "翻译中…" : hasTranslated ? "重新翻译" : "AI 翻译"}
            </button>
          )}
        </div>
      )}

      {/* Content (Markdown) */}
      <div className="prose-clip" style={{ fontSize: `${fontSize}px` }}>
        {displayedContent ? (
          viewMode === "raw" ? (
            // Raw dump is plain text — render as <pre> to preserve all
            // whitespace and avoid Markdown misinterpreting stray symbols.
            <pre className="whitespace-pre-wrap break-words text-text-secondary font-sans leading-relaxed">
              {displayedContent}
            </pre>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => {
                  const text = String(children);
                  const id = text
                    .toLowerCase()
                    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
                    .replace(/^-|-$/g, "");
                  return <h1 id={id}>{children}</h1>;
                },
                h2: ({ children }) => {
                  const text = String(children);
                  const id = text
                    .toLowerCase()
                    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
                    .replace(/^-|-$/g, "");
                  return <h2 id={id}>{children}</h2>;
                },
                h3: ({ children }) => {
                  const text = String(children);
                  const id = text
                    .toLowerCase()
                    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
                    .replace(/^-|-$/g, "");
                  return <h3 id={id}>{children}</h3>;
                },
              }}
            >
              {displayedContent}
            </ReactMarkdown>
          )
        ) : (
          <p className="text-text-tertiary">（无正文内容）</p>
        )}
      </div>

      {/* Related Clips */}
      {relatedClips.length > 0 && (
        <div className="mt-6 pt-4 border-t border-border">
          <div className="text-[12px] font-medium text-text-secondary mb-2">相关收藏</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {relatedClips.map((rc) => (
              <button
                key={rc.id}
                onClick={() => onUpdate?.(rc)}
                className="shrink-0 w-[200px] text-left p-2.5 rounded-lg bg-bg-secondary border border-border hover:border-accent/20 transition-colors cursor-pointer"
              >
                <div className="text-[12px] font-medium text-text line-clamp-1">{rc.title}</div>
                <div className="text-[11px] text-text-tertiary line-clamp-1 mt-0.5">
                  {rc.summary}
                </div>
                {rc.tags.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {rc.tags.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="text-[10px] text-accent bg-accent/8 px-1.5 py-0.5 rounded-full"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
