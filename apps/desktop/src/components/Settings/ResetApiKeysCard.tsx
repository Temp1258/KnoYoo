import { useState } from "react";
import { KeyRound, AlertCircle, CheckCircle2 } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";

/**
 * Subtle escape hatch for users whose OS keychain ACL drifted out of
 * sync — classic cause is running a dev build whose binary signature
 * changes across rebuilds, so macOS keeps reprompting even after the
 * user clicked "Always Allow". A single click here deletes every
 * KnoYoo keychain entry (and its `*_configured__*` / `*_key_hint__*`
 * mirrors in app_kv); the user then re-enters the few keys they
 * actually use, which rebuilds the ACL cleanly.
 */
export default function ResetApiKeysCard() {
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [working, setWorking] = useState(false);

  const runReset = async () => {
    setWorking(true);
    setMsg(null);
    try {
      const count = await tauriInvoke<number>("reset_api_keys");
      setMsg({ kind: "ok", text: `已清除 ${count} 条密钥，请重新输入你需要的` });
      setConfirming(false);
      // Signal dependent UI (banners, panels) to reload their state.
      window.dispatchEvent(new CustomEvent("knoyoo-ai-config-changed"));
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    } finally {
      setWorking(false);
    }
  };

  return (
    <section>
      <h2 className="text-[15px] font-semibold text-text mb-1">重置密钥</h2>
      <p className="text-[12px] text-text-tertiary mb-3">
        如果系统钥匙串反复弹窗、或想换一批全新的密钥，可以一次清空所有已保存的 AI / ASR Key。
      </p>

      <div className="p-4 rounded-xl bg-bg-secondary border border-border">
        <div className="flex items-start gap-2.5">
          <KeyRound size={14} className="text-text-tertiary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-text">清除所有已保存的 API Key</div>
            <div className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">
              会从系统钥匙串删除 KnoYoo
              存的全部密钥，本地数据库保留。之后在上面面板重新输入你要用的即可。
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {!confirming ? (
            <button
              onClick={() => {
                setConfirming(true);
                setMsg(null);
              }}
              className="px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:border-danger/40 hover:text-danger transition-colors cursor-pointer"
            >
              清除所有密钥…
            </button>
          ) : (
            <>
              <button
                onClick={runReset}
                disabled={working}
                className="px-3 py-1.5 rounded-md bg-danger text-white text-[12px] font-medium hover:bg-danger/90 transition-colors cursor-pointer disabled:opacity-50"
              >
                {working ? "清除中…" : "确认清除"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={working}
                className="px-3 py-1.5 rounded-md text-[12px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
              >
                取消
              </button>
            </>
          )}

          {msg && (
            <span
              className={`inline-flex items-center gap-1 text-[12px] ${
                msg.kind === "ok" ? "text-green-600 dark:text-green-400" : "text-red-500"
              }`}
            >
              {msg.kind === "ok" && <CheckCircle2 size={12} />}
              {msg.kind === "err" && <AlertCircle size={12} />}
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
