import { useState, useCallback } from "react";
import { tauriInvoke } from "./useTauriInvoke";
import type { AIConfig } from "../types";

export function useAIConfig() {
  const [aiCfg, setAiCfg] = useState<AIConfig>({});
  const [aiMsg, setAiMsg] = useState("");

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await tauriInvoke<AIConfig>("get_ai_config");
      setAiCfg(cfg || {});
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setAiMsg(message);
    }
  }, []);

  const saveConfig = useCallback(async () => {
    try {
      await tauriInvoke("set_ai_config", { cfg: aiCfg });
      setAiMsg("已保存");
      // Notify other components that AI config changed
      window.dispatchEvent(new CustomEvent("knoyoo-ai-config-changed"));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setAiMsg(message);
    }
  }, [aiCfg]);

  const smokeTest = useCallback(async () => {
    setAiMsg("测试中...");
    try {
      // Save current config first, then test
      await tauriInvoke("set_ai_config", { cfg: aiCfg });
      const r = await tauriInvoke<string>("ai_smoketest");
      if (r.startsWith("ok:")) {
        const endpoint = r.slice(3);
        setAiMsg(`连接成功 (${endpoint})`);
        return "ok";
      }
      setAiMsg(r);
      return r;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setAiMsg(message);
      return message;
    }
  }, [aiCfg]);

  return {
    aiCfg,
    setAiCfg,
    aiMsg,
    setAiMsg,
    loadConfig,
    saveConfig,
    smokeTest,
  };
}
