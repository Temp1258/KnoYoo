import { useState } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Badge from "../ui/Badge";
import type { ChatMessage } from "../../types";

interface Props {
  selectedNoteId?: number | null;
}

export default function ChatDrawer({ selectedNoteId }: Props) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);

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
        selectedNoteId: selectedNoteId ?? null,
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

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-[380px] bg-bg-secondary border-l border-border shadow-lg z-50 flex flex-col transition-transform duration-300 ${
          chatOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-[14px] font-semibold text-text">KnoYoo AI</span>
          <button
            className="p-1 rounded-md text-text-tertiary hover:text-text hover:bg-bg-tertiary transition-colors cursor-pointer"
            onClick={() => setChatOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Context indicator */}
          {chatMsgs.length === 0 && (
            <div className="flex justify-center">
              <Badge variant="accent">{selectedNoteId ? "已关联笔记上下文" : "全局上下文"}</Badge>
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
                {m.content}
              </div>
            </div>
          ))}

          {chatMsgs.length === 0 && (
            <div className="text-[13px] text-text-tertiary text-center py-8">开始提问吧~</div>
          )}

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
