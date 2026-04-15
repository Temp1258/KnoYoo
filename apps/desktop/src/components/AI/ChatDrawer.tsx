import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle,
  X,
  Send,
  Lightbulb,
  RotateCcw,
  Plus,
  ChevronDown,
  Trash2,
  FileText,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { ChatMessage, AiChatResponse, ChatSession, WebClip } from "../../types";

type Suggestion = {
  suggestion_type: string;
  title: string;
  description: string;
};

type ReferencedClips = Record<number, { id: number; title: string }>;

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}个月前`;
  return `${Math.floor(months / 12)}年前`;
}

export default function ChatDrawer() {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // Chat session state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [showSessionList, setShowSessionList] = useState(false);

  // Referenced clips per assistant message index
  const [referencedClips, setReferencedClips] = useState<Record<number, number[]>>({});
  const [clipDetails, setClipDetails] = useState<ReferencedClips>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs, sending]);

  // Close session dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sessionListRef.current && !sessionListRef.current.contains(e.target as Node)) {
        setShowSessionList(false);
      }
    }
    if (showSessionList) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSessionList]);

  // Load sessions and suggestions on drawer open
  useEffect(() => {
    if (!chatOpen) return;
    tauriInvoke<ChatSession[]>("list_chat_sessions").then(setSessions).catch(console.error);
    if (chatMsgs.length === 0) {
      tauriInvoke<Suggestion[]>("ai_suggest_actions").then(setSuggestions).catch(console.error);
    }
  }, [chatOpen, chatMsgs.length]);

  // Fetch clip details for referenced IDs
  const fetchClipDetails = useCallback(
    async (ids: number[]) => {
      const missing = ids.filter((id) => !clipDetails[id]);
      if (missing.length === 0) return;
      try {
        const clips = await tauriInvoke<WebClip[]>("list_web_clips", {
          page: 1,
          pageSize: 100,
        });
        const map: ReferencedClips = { ...clipDetails };
        for (const clip of clips) {
          if (missing.includes(clip.id)) {
            map[clip.id] = { id: clip.id, title: clip.title };
          }
        }
        // Fill any still-missing IDs with fallback
        for (const id of missing) {
          if (!map[id]) {
            map[id] = { id, title: `知识片段 #${id}` };
          }
        }
        setClipDetails(map);
      } catch {
        const map: ReferencedClips = { ...clipDetails };
        for (const id of missing) {
          map[id] = { id, title: `知识片段 #${id}` };
        }
        setClipDetails(map);
      }
    },
    [clipDetails],
  );

  // Persist messages to current session
  const saveToSession = useCallback(async (sessionId: number, messages: ChatMessage[]) => {
    try {
      await tauriInvoke("update_chat_session", {
        id: sessionId,
        messages,
      });
    } catch (e) {
      console.error("Failed to save session:", e);
    }
  }, []);

  function startNewSession() {
    setChatMsgs([]);
    setCurrentSessionId(null);
    setReferencedClips({});
    setShowSessionList(false);
  }

  function loadSession(session: ChatSession) {
    setChatMsgs(session.messages);
    setCurrentSessionId(session.id);
    setReferencedClips({});
    setShowSessionList(false);
  }

  async function deleteSession(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await tauriInvoke("delete_chat_session", { id });
      setSessions((s) => s.filter((sess) => sess.id !== id));
      if (currentSessionId === id) startNewSession();
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  }

  async function sendChat(retryContent?: string) {
    const text = retryContent || chatInput.trim();
    if (!text || sending) return;

    // Build message list — for retry, replace the last error message
    let allMessages: ChatMessage[];
    if (retryContent) {
      // Remove the trailing error assistant message, keep the user message
      const trimmed = chatMsgs.filter((m, i) => !(i === chatMsgs.length - 1 && m.error));
      allMessages = trimmed;
    } else {
      allMessages = [
        ...chatMsgs,
        { role: "user" as const, content: text, timestamp: new Date().toISOString() },
      ];
    }

    setChatMsgs(allMessages);
    if (!retryContent) setChatInput("");
    setSending(true);

    // Create session on first message if needed
    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const title = text.length > 30 ? text.slice(0, 30) + "…" : text;
        const session = await tauriInvoke<ChatSession>("create_chat_session", { title });
        sessionId = session.id;
        setCurrentSessionId(session.id);
        setSessions((s) => [session, ...s]);
      } catch (e) {
        console.error("Failed to create session:", e);
      }
    }

    try {
      const reply = await tauriInvoke<AiChatResponse>("ai_chat_with_context", {
        messages: allMessages,
      });

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: reply.content || "（空）",
        timestamp: new Date().toISOString(),
      };

      const newMsgs = [...allMessages, assistantMsg];
      setChatMsgs(newMsgs);

      // Track referenced clips
      if (reply.referenced_clip_ids?.length > 0) {
        const msgIdx = newMsgs.length - 1;
        setReferencedClips((prev) => ({ ...prev, [msgIdx]: reply.referenced_clip_ids }));
        fetchClipDetails(reply.referenced_clip_ids);
      }

      // Persist to session
      if (sessionId) saveToSession(sessionId, newMsgs);
    } catch (err: unknown) {
      const errorMessage =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : "请求失败，请检查 AI 设置。";

      const errorMsg: ChatMessage = {
        role: "assistant",
        content: errorMessage,
        timestamp: new Date().toISOString(),
        error: true,
      };

      const newMsgs = [...allMessages, errorMsg];
      setChatMsgs(newMsgs);

      if (sessionId) saveToSession(sessionId, newMsgs);
    } finally {
      setSending(false);
    }
  }

  function handleRetry() {
    // Find the last user message to retry
    const lastUserMsg = [...chatMsgs].reverse().find((m) => m.role === "user");
    if (lastUserMsg) sendChat(lastUserMsg.content);
  }

  return (
    <>
      {/* Trigger button */}
      {!chatOpen && (
        <button
          className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-accent text-white shadow-lg flex items-center justify-center cursor-pointer hover:bg-accent-hover transition-colors z-40"
          onClick={() => setChatOpen(true)}
        >
          <MessageCircle size={20} />
        </button>
      )}

      {/* Backdrop */}
      {chatOpen && (
        <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setChatOpen(false)} />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-[380px] bg-bg-secondary border-l border-border shadow-lg z-50 flex flex-col transition-transform duration-300 ${
          chatOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-text">AI 知识助手</span>
            {/* Session selector */}
            <div className="relative" ref={sessionListRef}>
              <button
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] text-text-tertiary hover:text-text hover:bg-bg-tertiary transition-colors cursor-pointer"
                onClick={() => setShowSessionList((v) => !v)}
              >
                <ChevronDown size={12} />
              </button>
              {showSessionList && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-bg-secondary border border-border rounded-lg shadow-lg overflow-hidden z-10">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-accent hover:bg-bg-tertiary transition-colors cursor-pointer"
                    onClick={startNewSession}
                  >
                    <Plus size={12} />
                    新对话
                  </button>
                  {sessions.length > 0 && (
                    <div className="border-t border-border max-h-60 overflow-y-auto">
                      {sessions.map((s) => (
                        <div
                          key={s.id}
                          className={`flex items-center justify-between px-3 py-2 text-[12px] hover:bg-bg-tertiary transition-colors cursor-pointer group ${
                            s.id === currentSessionId
                              ? "bg-bg-tertiary text-text"
                              : "text-text-secondary"
                          }`}
                          onClick={() => loadSession(s)}
                        >
                          <span className="truncate flex-1 mr-2">{s.title}</span>
                          <button
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-tertiary hover:text-red-500 transition-all cursor-pointer"
                            onClick={(e) => deleteSession(s.id, e)}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="p-1 rounded-md text-text-tertiary hover:text-text hover:bg-bg-tertiary transition-colors cursor-pointer"
              onClick={startNewSession}
              title="新对话"
            >
              <Plus size={16} />
            </button>
            <button
              className="p-1 rounded-md text-text-tertiary hover:text-text hover:bg-bg-tertiary transition-colors cursor-pointer"
              onClick={() => setChatOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {chatMsgs.length === 0 && (
            <div className="text-center py-6">
              <div className="text-[13px] text-text-tertiary mb-4">
                向 AI 助手提问，它会优先基于你的智库内容回答
              </div>
              {suggestions.length > 0 && (
                <div className="space-y-2">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setChatInput(s.title)}
                      className="w-full text-left p-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/10 hover:border-yellow-500/20 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 text-[12px] font-medium text-yellow-600">
                        <Lightbulb size={12} />
                        {s.title}
                      </div>
                      <div className="text-[11px] text-text-tertiary mt-0.5">{s.description}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {chatMsgs.map((m, i) => (
            <div
              key={i}
              className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-xl text-[13px] leading-relaxed ${
                  m.role === "user"
                    ? "bg-accent text-white rounded-br-sm"
                    : m.error
                      ? "bg-red-500/10 text-red-600 border border-red-500/20 rounded-bl-sm"
                      : "bg-bg-tertiary text-text rounded-bl-sm"
                }`}
              >
                {m.role === "assistant" ? (
                  m.error ? (
                    <div className="flex items-start gap-2">
                      <span className="flex-1">{m.content}</span>
                      <button
                        onClick={handleRetry}
                        disabled={sending}
                        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw size={11} />
                        重试
                      </button>
                    </div>
                  ) : (
                    <div className="prose-chat">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                  )
                ) : (
                  m.content
                )}
              </div>

              {/* Referenced clips */}
              {m.role === "assistant" && !m.error && referencedClips[i]?.length > 0 && (
                <div className="max-w-[85%] mt-1.5 px-2 py-1.5 rounded-lg bg-bg-tertiary/60 border border-border/50">
                  <div className="flex items-center gap-1 text-[11px] text-text-tertiary mb-1">
                    <FileText size={10} />
                    引用来源
                  </div>
                  <div className="space-y-0.5">
                    {referencedClips[i].map((clipId) => (
                      <div key={clipId} className="text-[11px] text-text-secondary truncate pl-3">
                        {clipDetails[clipId]?.title || `知识片段 #${clipId}`}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timestamp */}
              {m.timestamp && (
                <span className="text-[10px] text-text-tertiary mt-1 px-1">
                  {formatRelativeTime(new Date(m.timestamp))}
                </span>
              )}
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="bg-bg-tertiary text-text-secondary px-3 py-2 rounded-xl text-[13px] rounded-bl-sm">
                思考中...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border px-4 py-3 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              className="flex-1 px-3 py-2 text-[13px] bg-bg-tertiary text-text border-none rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-accent/30 placeholder:text-text-tertiary"
              placeholder="输入消息..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  sendChat();
                }
              }}
            />
            <button
              className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center cursor-pointer hover:bg-accent-hover transition-colors disabled:opacity-50 shrink-0"
              onClick={() => sendChat()}
              disabled={sending || !chatInput.trim()}
            >
              <Send size={14} />
            </button>
          </div>
          <div className="text-[11px] text-text-tertiary mt-1.5 text-right">Ctrl+Enter 发送</div>
        </div>
      </div>
    </>
  );
}
