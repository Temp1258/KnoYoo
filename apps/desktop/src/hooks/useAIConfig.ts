import { useCallback, useState } from "react";
import { tauriInvoke } from "./useTauriInvoke";
import type { AiFullConfig, AiProviderState, AiSetConfig } from "../types";

const EMPTY_PROVIDER_STATE: AiProviderState = {
  configured: false,
  api_base: "",
  model: "",
  key_hint: "",
};

const EMPTY_CFG: AiFullConfig = {
  provider: "",
  api_base: "",
  model: "",
  providers: {},
};

export function useAIConfig() {
  const [aiCfg, setAiCfg] = useState<AiFullConfig>(EMPTY_CFG);
  const [aiMsg, setAiMsg] = useState("");

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await tauriInvoke<AiFullConfig>("get_ai_config");
      setAiCfg(cfg ?? EMPTY_CFG);
    } catch (err: unknown) {
      setAiMsg(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Apply a partial update and reload. Callers pass the fields they
   *  want to write — anything omitted is left untouched on the backend. */
  const saveConfig = useCallback(
    async (payload: AiSetConfig) => {
      try {
        await tauriInvoke("set_ai_config", { cfg: payload });
        setAiMsg("已保存");
        // Notify other components (banner, settings watchers, etc).
        window.dispatchEvent(new CustomEvent("knoyoo-ai-config-changed"));
        await loadConfig();
      } catch (err: unknown) {
        setAiMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [loadConfig],
  );

  /** Smoketest the AI provider with the given form values, WITHOUT
   *  saving them first. The backend uses `payload` directly for the
   *  live API call — this avoids the "save then read" keychain
   *  round-trip that cost the user multiple OS prompts per click.
   *
   *  Returns "ok" on success, or a Chinese error string the UI can
   *  render directly. */
  const smokeTest = useCallback(async (payload: AiSetConfig): Promise<string> => {
    setAiMsg("测试中...");
    try {
      const r = await tauriInvoke<string>("ai_smoketest", { cfg: payload });
      if (r.startsWith("ok:")) {
        setAiMsg(`连接成功 (${r.slice(3)})`);
        return "ok";
      }
      setAiMsg(r);
      return r;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiMsg(msg);
      return msg;
    }
  }, []);

  /** Convenience accessor for the active provider's state. Returns the
   *  zero state when no provider is picked — saves callers from
   *  `?.` chains at every use site. */
  const active: AiProviderState =
    (aiCfg.provider && aiCfg.providers[aiCfg.provider]) || EMPTY_PROVIDER_STATE;

  /** State for an arbitrary provider id (not necessarily the active one).
   *  Used by the unified API config tile grid to render every provider's
   *  configured-ness without changing what's "selected". */
  const stateFor = useCallback(
    (providerKey: string): AiProviderState => aiCfg.providers[providerKey] ?? EMPTY_PROVIDER_STATE,
    [aiCfg.providers],
  );

  return {
    aiCfg,
    setAiCfg,
    active,
    stateFor,
    aiMsg,
    setAiMsg,
    loadConfig,
    saveConfig,
    smokeTest,
  };
}
