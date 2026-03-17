import { useState, useEffect } from "react";
import { Cpu, X, Check } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Button from "../ui/Button";
import type { OllamaStatus } from "../../types";

export default function OllamaBanner() {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    // Check if AI is already configured
    tauriInvoke<Record<string, string>>("get_ai_config").then((cfg) => {
      if (cfg.api_key && cfg.api_key.trim()) {
        setHasApiKey(true);
        return;
      }
      // Only detect Ollama if no API key is set
      tauriInvoke<OllamaStatus>("detect_ollama").then(setStatus).catch(console.error);
    }).catch(console.error);
  }, []);

  if (hasApiKey || dismissed || configured || !status?.running) return null;

  const handleConfigure = async (model: string) => {
    try {
      await tauriInvoke("auto_configure_ollama", { model });
      setConfigured(true);
    } catch (e) {
      console.error(e);
    }
  };

  if (configured) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-success/10 border border-success/20 mb-4">
        <Check size={16} className="text-success shrink-0" />
        <span className="text-[13px] text-text">Ollama 已自动配置! AI 功能现在可以使用了。</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-500/5 border border-blue-500/15 mb-4">
      <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
        <Cpu size={16} className="text-blue-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text mb-1">
          检测到本地 Ollama 正在运行
        </div>
        <div className="text-[12px] text-text-secondary mb-2">
          无需 API Key，直接使用本地 AI 模型。选择一个模型一键配置：
        </div>
        <div className="flex flex-wrap gap-1.5">
          {status.models.slice(0, 5).map((m) => (
            <Button key={m} size="sm" onClick={() => handleConfigure(m)}>
              {m}
            </Button>
          ))}
          {status.models.length === 0 && (
            <span className="text-[12px] text-text-tertiary">未找到已下载的模型，请先运行 ollama pull llama3</span>
          )}
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 rounded-md text-text-tertiary hover:text-text hover:bg-bg-tertiary transition-colors cursor-pointer shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}
