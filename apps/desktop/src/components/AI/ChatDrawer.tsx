import { useState, useEffect } from "react";
import { MessageCircle, X, Send, Lightbulb } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { ChatMessage } from "../../types";

type Suggestion = {
  suggestion_type: string;
  title: string;
  description: string;
};

export default function ChatDrawer() {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    if (chatOpen && chatMsgs.length === 0) {
      tauriInvoke<Suggestion[]>("ai_suggest_actions").then(setSuggestions).catch(console.error);
    }
  }, [chatOpen, chatMsgs.length]);

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || sending) return;

    const allMessages: ChatMessage[] = [...chatMsgs, { role: "user", content: text }];

    setChatMsgs(allMessages);
    setChatInput("");
    setSending(true);

    try {
      const reply = await tauriInvoke<string>("ai_chat_with_context", {
        messages: allMessages,
      });
      setChatMsgs((m) => [...m, { role: "assistant", content: reply || "（空）" }]);
    } catch (_e) {
      setChatMsgs((m) => [...m, { role: "assistant", content: "请求失败，请检查 AI 设置。" }]);
    } finally {
      setSending(false);
    }
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

      {/* Backdrop — click anywhere outside drawer to close */}
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
          <span className="text-[14px] font-semibold text-text">AI 知识助手</span>
          <button
            className="p-1 rounded-md text-text-tertiary hover:text-text hover:bg-bg-tertiary transition-colors cursor-pointer"
            onClick={() => setChatOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {chatMsgs.length === 0 && (
            <div className="text-center py-6">
              <div className="text-[13px] text-text-tertiary mb-4">
                向 AI 助手提问，它会优先基于你的知识库内容回答
              </div>
              {suggestions.length > 0 && (
                <div className="space-y-2">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setChatInput(s.title);
                      }}
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
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] px-3 py-2 rounded-xl text-[13px] leading-relaxed ${
                  m.role === "user"
                    ? "bg-accent text-white rounded-br-sm"
                    : "bg-bg-tertiary text-text rounded-bl-sm"
                }`}
              >
                {m.role === "assistant" ? (
                  <div className="prose-chat">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="bg-bg-tertiary text-text-secondary px-3 py-2 rounded-xl text-[13px] rounded-bl-sm">
                思考中...
              </div>
            </div>
          )}
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
              onClick={sendChat}
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
