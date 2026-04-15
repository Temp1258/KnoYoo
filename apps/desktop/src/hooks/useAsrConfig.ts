import { useCallback, useState } from "react";
import { tauriInvoke } from "./useTauriInvoke";
import type { AsrFullConfig, AsrProviderState, AsrSetConfig } from "../types";

const EMPTY_PROVIDER_STATE: AsrProviderState = {
  configured: false,
  api_base: "",
  model: "",
  key_hint: "",
};

const EMPTY_CFG: AsrFullConfig = {
  asr_provider: "",
  asr_language: "",
  asr_api_base: "",
  asr_model: "",
  providers: {},
};

/** Mirror of `useAIConfig` for the ASR pipeline. The state shape diverges
 *  enough (provider id namespace, language field) that one shared hook
 *  would be more confusing than two parallel ones. */
export function useAsrConfig() {
  const [asrCfg, setAsrCfg] = useState<AsrFullConfig>(EMPTY_CFG);
  const [asrMsg, setAsrMsg] = useState("");

  const loadConfig = useCallback(async () => {
    try {
      const c = await tauriInvoke<AsrFullConfig>("get_asr_config");
      setAsrCfg(c ?? EMPTY_CFG);
    } catch (err: unknown) {
      setAsrMsg(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const saveConfig = useCallback(
    async (payload: AsrSetConfig) => {
      try {
        await tauriInvoke("set_asr_config", { cfg: payload });
        setAsrMsg("已保存");
        await loadConfig();
      } catch (err: unknown) {
        setAsrMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [loadConfig],
  );

  /** Convenience: state for a specific provider (zero state if unknown). */
  const stateFor = useCallback(
    (providerKey: string): AsrProviderState =>
      asrCfg.providers[providerKey] ?? EMPTY_PROVIDER_STATE,
    [asrCfg.providers],
  );

  return {
    asrCfg,
    setAsrCfg,
    asrMsg,
    setAsrMsg,
    loadConfig,
    saveConfig,
    stateFor,
  };
}
