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
    } catch (e: any) {
      setAiMsg(String(e));
    }
  }, []);

  const saveConfig = useCallback(async () => {
    try {
      await tauriInvoke("set_ai_config", { cfg: aiCfg });
      setAiMsg("已保存");
    } catch (e: any) {
      setAiMsg(String(e));
    }
  }, [aiCfg]);

  const smokeTest = useCallback(async () => {
    try {
      const r = await tauriInvoke<string>("ai_smoketest");
      setAiMsg(r);
      return r;
    } catch (e: any) {
      setAiMsg(String(e));
      return String(e);
    }
  }, []);

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
