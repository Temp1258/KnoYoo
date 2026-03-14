import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { ChatMessage } from "../../types";

interface Props {
  /** Optional context to prepend to AI conversations */
  context?: string;
  contextLabel?: string;
}

export default function ChatDrawer({ context, contextLabel }: Props) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

  async function sendChat() {
    const text = chatInput.trim();
    if (!text) return;

    // If context is provided, prepend it to the first message
    let messages: ChatMessage[] = [...chatMsgs, { role: "user", content: text }];
    if (context && chatMsgs.length === 0) {
      messages = [
        { role: "user", content: `[当前上下文] ${context}\n\n${text}` },
      ];
    } else {
      messages = [...chatMsgs, { role: "user", content: text }];
    }

    setChatMsgs([...chatMsgs, { role: "user", content: text }]);
    setChatInput("");

    try {
      const reply = await tauriInvoke<string>("ai_chat", { messages });
      setChatMsgs((m) => [...m, { role: "assistant", content: reply || "（空）" }]);
    } catch (e) {
      setChatMsgs((m) => [...m, { role: "assistant", content: "请求失败，请检查 AI 设置。" }]);
    }
  }

  return (
    <>
      {!chatOpen && (
        <button className="chat-toggle" onClick={() => setChatOpen(true)}>
          KnoYoo AI
        </button>
      )}
      <div className={chatOpen ? "chat-drawer open" : "chat-drawer"}>
        {chatOpen && (
          <div className="chat-header">
            <span style={{ fontWeight: 600 }}>与 AI 对话</span>
            <button className="collapse-btn" onClick={() => setChatOpen(false)} title="收起聊天">
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
          </div>
        )}
        {!chatOpen && <div className="chat-header-collapsed">与 AI 对话</div>}
        <div className="chat-messages">
          {/* Context indicator */}
          {context && contextLabel && chatMsgs.length === 0 && (
            <div className="chat-context-indicator">
              当前上下文：{contextLabel}
            </div>
          )}
          {chatMsgs.map((m, i) => (
            <div key={i} className="chat-message">
              <div className="chat-role">{m.role === "user" ? "我" : "AI"}</div>
              <div>{m.content}</div>
            </div>
          ))}
          {chatMsgs.length === 0 && !context && (
            <div style={{ color: "#999" }}>开始提问吧~</div>
          )}
        </div>
        <div className="chat-input-area">
          <textarea
            rows={3}
            className="chat-textarea"
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
          <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={sendChat}>
              发送（Ctrl/Cmd+Enter）
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
