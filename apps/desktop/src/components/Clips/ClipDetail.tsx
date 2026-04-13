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
  FolderPlus,
  Download,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { WebClip, ClipNote } from "../../types";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Button from "../ui/Button";
import AddToCollectionDialog from "../Collections/AddToCollectionDialog";
import { useExport } from "../../hooks/useExport";

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

export default function ClipDetail({ clip, onBack, onStar, onUpdate, compact }: Props) {
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(clip.summary);
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState<string[]>(clip.tags);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);

  // Reading progress
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Font size
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem(FONT_SIZE_KEY);
    return saved ? Number(saved) : DEFAULT_FONT_SIZE;
  });

  // TOC
  const [tocExpanded, setTocExpanded] = useState(false);
  const headings = useMemo(() => extractHeadings(clip.content), [clip.content]);

  // Export
  const { exportClip } = useExport();

  // Collections dialog
  const [showCollections, setShowCollections] = useState(false);

  // Related clips
  const [relatedClips, setRelatedClips] = useState<WebClip[]>([]);

  // User notes
  const [note, setNote] = useState<ClipNote | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  // Find nearest scrollable ancestor and track progress
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
    const onScroll = () => {
      const scrollable = container.scrollHeight - container.clientHeight;
      setProgress(scrollable > 0 ? (container.scrollTop / scrollable) * 100 : 0);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // initial calculation
    return () => container.removeEventListener("scroll", onScroll);
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

  const domain = (() => {
    try {
      return new URL(clip.url).hostname.replace("www.", "");
    } catch {
      return clip.url;
    }
  })();

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

  const addTag = () => {
    const tag = newTag.trim();
    if (tag && !tagsDraft.includes(tag)) {
      setTagsDraft([...tagsDraft, tag]);
      setNewTag("");
    }
  };

  return (
    <div ref={scrollRef}>
      {/* Reading progress bar */}
      <div
        className="sticky top-0 left-0 h-0.5 bg-accent z-20 transition-all duration-75"
        style={{ width: `${progress}%` }}
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
            <Button variant="ghost" size="sm" onClick={() => setShowCollections(true)}>
              <FolderPlus size={14} />
            </Button>
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
            <a href={clip.url} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm">
                <ExternalLink size={14} />
                打开原文
              </Button>
            </a>
          </div>
        </div>
      </div>

      {/* Title */}
      <h1 className="text-[22px] font-bold text-text mb-2">{clip.title || "无标题"}</h1>

      {/* Meta */}
      <div className="flex items-center gap-3 text-[12px] text-text-tertiary mb-4">
        <span>{domain}</span>
        <span>{new Date(clip.created_at).toLocaleDateString("zh-CN")}</span>
        <span className="px-1.5 py-0.5 rounded bg-bg-tertiary text-[11px]">{clip.source_type}</span>
      </div>

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
                    await tauriInvoke("delete_clip_note", { clipId: clip.id });
                    setNote(null);
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

      {/* Content (Markdown) */}
      <div className="prose-clip" style={{ fontSize: `${fontSize}px` }}>
        {clip.content ? (
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
            {clip.content}
          </ReactMarkdown>
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

      {/* Add to Collection Dialog */}
      <AddToCollectionDialog
        open={showCollections}
        clipId={clip.id}
        onClose={() => setShowCollections(false)}
      />
    </div>
  );
}
