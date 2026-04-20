import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, AlertCircle, CheckCircle2, RefreshCw, FileText, Mic } from "lucide-react";
import { useAIConfig } from "../../hooks/useAIConfig";
import { useAsrConfig } from "../../hooks/useAsrConfig";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Card from "../ui/Card";
import Input from "../ui/Input";
import Button from "../ui/Button";
import { LOGICAL_PROVIDERS, type LogicalProvider } from "./providerCatalog";

type OllamaStatus = { running: boolean; models: string[] };

/**
 * Unified API 配置 tab.
 *
 * Layout (top → bottom):
 *   1. Pipeline summary: single glance "do I have AI configured? do I
 *      have ASR configured? which providers?"
 *   2. Provider grid: all logical providers, grouped by region. Tiles
 *      carry capability badges (文本 / 转录) so the user sees upfront
 *      which role(s) each provider can fill.
 *   3. Expanded editor for the clicked provider: one API-key input per
 *      service (even dual-role providers share a single key — the same
 *      SiliconFlow / OpenAI key works for both chat and audio APIs).
 */
export default function ApiConfigPanel() {
  const ai = useAIConfig();
  const asr = useAsrConfig();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Initial load + react to "config changed" events from sibling
  // components (e.g. the reset card) so tile dots refresh without
  // requiring a tab switch.
  useEffect(() => {
    ai.loadConfig();
    asr.loadConfig();
    const onChange = () => {
      ai.loadConfig();
      asr.loadConfig();
    };
    window.addEventListener("knoyoo-ai-config-changed", onChange);
    return () => window.removeEventListener("knoyoo-ai-config-changed", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-select the provider that's currently active in either pipeline
  // so the editor area isn't empty on first visit.
  useEffect(() => {
    if (selectedId) return;
    const fromAi = LOGICAL_PROVIDERS.find((p) => p.ai?.providerKey === ai.aiCfg.provider);
    const fromAsr = LOGICAL_PROVIDERS.find((p) => p.asr?.providerKey === asr.asrCfg.asr_provider);
    const pick = fromAi ?? fromAsr;
    if (pick) setSelectedId(pick.id);
  }, [ai.aiCfg.provider, asr.asrCfg.asr_provider, selectedId]);

  const selected = useMemo(
    () => LOGICAL_PROVIDERS.find((p) => p.id === selectedId) ?? null,
    [selectedId],
  );

  return (
    <Card>
      <PipelineSummary ai={ai} asr={asr} />

      <div className="space-y-3 mt-5">
        <ProviderGroup
          title="国内可用"
          providers={LOGICAL_PROVIDERS.filter((p) => p.region === "cn")}
          selectedId={selectedId}
          onPick={setSelectedId}
          aiStateFor={ai.stateFor}
          asrStateFor={asr.stateFor}
        />
        <ProviderGroup
          title="海外服务（需科学上网）"
          providers={LOGICAL_PROVIDERS.filter((p) => p.region === "intl")}
          selectedId={selectedId}
          onPick={setSelectedId}
          aiStateFor={ai.stateFor}
          asrStateFor={asr.stateFor}
        />
      </div>

      {selected && (
        <div className="mt-5 pt-5 border-t border-border">
          <ProviderEditor provider={selected} ai={ai} asr={asr} />
        </div>
      )}

      <div className="mt-5 pt-3 border-t border-border">
        <div className="flex items-start gap-2 text-[11px] text-text-tertiary leading-relaxed">
          <ShieldCheck size={12} className="text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
          <div>
            API Key 加密保存在系统钥匙串{" "}
            <span className="text-text-secondary">
              (macOS Keychain / Windows Credential Manager)
            </span>
            ，永不进入本地数据库，也不会出现在备份文件里。界面只显示是否已配置和尾号 4 位。
          </div>
        </div>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────
// Pipeline summary — the "at a glance" status bar
// ──────────────────────────────────────────────────────────────────

function PipelineSummary({
  ai,
  asr,
}: {
  ai: ReturnType<typeof useAIConfig>;
  asr: ReturnType<typeof useAsrConfig>;
}) {
  const aiActive = ai.aiCfg.provider;
  const aiConfigured = !!aiActive && ai.stateFor(aiActive).configured;
  const aiLabel = aiActive
    ? (LOGICAL_PROVIDERS.find((p) => p.ai?.providerKey === aiActive)?.label ?? aiActive)
    : "";
  const aiHint = aiActive ? ai.stateFor(aiActive).key_hint : "";

  const asrActive = asr.asrCfg.asr_provider;
  const asrConfigured = !!asrActive && asr.stateFor(asrActive).configured;
  const asrLabel = asrActive
    ? (LOGICAL_PROVIDERS.find((p) => p.asr?.providerKey === asrActive)?.label ?? asrActive)
    : "";
  const asrHint = asrActive ? asr.stateFor(asrActive).key_hint : "";

  return (
    <div className="rounded-lg bg-bg-tertiary/40 border border-border p-3">
      <div className="text-[11px] text-text-tertiary uppercase tracking-wide mb-2">当前状态</div>
      <div className="grid grid-cols-2 gap-3">
        <PipelineStatusLine
          icon={<FileText size={14} className="text-text-tertiary shrink-0" />}
          label="AI 文本"
          sublabel="摘要 · 标签 · 助手 · 语义搜索"
          configured={aiConfigured}
          providerLabel={aiLabel}
          keyHint={aiHint}
        />
        <PipelineStatusLine
          icon={<Mic size={14} className="text-text-tertiary shrink-0" />}
          label="视频转录"
          sublabel="YouTube / Bilibili 无字幕兜底"
          configured={asrConfigured}
          providerLabel={asrLabel}
          keyHint={asrHint}
        />
      </div>
    </div>
  );
}

function PipelineStatusLine({
  icon,
  label,
  sublabel,
  configured,
  providerLabel,
  keyHint,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  configured: boolean;
  providerLabel: string;
  keyHint: string;
}) {
  return (
    <div className="flex items-start gap-2">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-text">{label}</span>
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              configured ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span
            className={`text-[12px] ${
              configured ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"
            }`}
          >
            {configured ? "已配置" : "未配置"}
          </span>
        </div>
        <div className="text-[11px] text-text-tertiary mt-0.5 truncate">
          {configured ? (
            <>
              {providerLabel}
              {keyHint && (
                <>
                  {" · 尾号 "}
                  <span className="font-mono text-text-secondary">{keyHint}</span>
                </>
              )}
            </>
          ) : (
            sublabel
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Tile grid
// ──────────────────────────────────────────────────────────────────

interface ProviderGroupProps {
  title: string;
  providers: LogicalProvider[];
  selectedId: string | null;
  onPick: (id: string) => void;
  aiStateFor: ReturnType<typeof useAIConfig>["stateFor"];
  asrStateFor: ReturnType<typeof useAsrConfig>["stateFor"];
}

function ProviderGroup({
  title,
  providers,
  selectedId,
  onPick,
  aiStateFor,
  asrStateFor,
}: ProviderGroupProps) {
  return (
    <div>
      <div className="text-[12px] text-text-tertiary mb-2">{title}</div>
      <div className="grid grid-cols-3 gap-2">
        {providers.map((p) => (
          <ProviderTile
            key={p.id}
            provider={p}
            selected={p.id === selectedId}
            onClick={() => onPick(p.id)}
            aiState={p.ai ? aiStateFor(p.ai.providerKey) : null}
            asrState={p.asr ? asrStateFor(p.asr.providerKey) : null}
          />
        ))}
      </div>
    </div>
  );
}

interface ProviderTileProps {
  provider: LogicalProvider;
  selected: boolean;
  onClick: () => void;
  aiState: { configured: boolean; key_hint: string } | null;
  asrState: { configured: boolean; key_hint: string } | null;
}

function ProviderTile({ provider, selected, onClick, aiState, asrState }: ProviderTileProps) {
  const anyConfigured = (aiState?.configured ?? false) || (asrState?.configured ?? false);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
        selected
          ? "border-accent bg-accent/10"
          : "border-border hover:border-accent/30 hover:bg-bg-tertiary"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`text-[13px] font-medium ${selected ? "text-accent" : "text-text"}`}>
          {provider.label}
        </span>
        {anyConfigured && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-green-500 ml-auto shrink-0"
            aria-label="已配置"
          />
        )}
      </div>

      {/* Capability badges — visually distinct colours so the user
          can scan which providers support which pipeline. */}
      <div className="flex items-center gap-1 mb-1.5">
        {aiState && <RoleBadge kind="text" />}
        {asrState && <RoleBadge kind="asr" />}
      </div>

      <div className="text-[11px] text-text-tertiary">{provider.tagline}</div>

      {/* Per-role hint tails, shown only when configured. The global
          dot above tells "something is configured"; this shows which. */}
      {(aiState?.configured || asrState?.configured) && (
        <div className="mt-1.5 space-y-0.5">
          {aiState?.configured && aiState.key_hint && (
            <TileHintLine kind="text" keyHint={aiState.key_hint} />
          )}
          {asrState?.configured && asrState.key_hint && (
            <TileHintLine kind="asr" keyHint={asrState.key_hint} />
          )}
        </div>
      )}
    </button>
  );
}

function RoleBadge({ kind }: { kind: "text" | "asr" }) {
  const conf =
    kind === "text"
      ? {
          label: "文本",
          className: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
        }
      : {
          label: "转录",
          className: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
        };
  return (
    <span
      className={`inline-flex items-center text-[10px] px-1.5 py-0 rounded border ${conf.className}`}
    >
      {conf.label}
    </span>
  );
}

function TileHintLine({ kind, keyHint }: { kind: "text" | "asr"; keyHint: string }) {
  const prefix = kind === "text" ? "文本" : "转录";
  return (
    <div className="text-[10px] text-text-tertiary">
      {prefix}：尾号 <span className="font-mono text-text-secondary">{keyHint}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Unified editor (handles single-role AND dual-role providers)
// ──────────────────────────────────────────────────────────────────

interface EditorProps {
  provider: LogicalProvider;
  ai: ReturnType<typeof useAIConfig>;
  asr: ReturnType<typeof useAsrConfig>;
}

function ProviderEditor({ provider, ai, asr }: EditorProps) {
  const aiState = provider.ai ? ai.stateFor(provider.ai.providerKey) : null;
  const asrState = provider.asr ? asr.stateFor(provider.asr.providerKey) : null;

  const [newKey, setNewKey] = useState("");
  // Unified language (only relevant when ASR role is present).
  const [language, setLanguage] = useState(asr.asrCfg.asr_language);
  // Auto-split chunk length for long-audio transcription. Shared across
  // all ASR providers — shown here for convenience (alongside language)
  // since this is where the user configures ASR behaviour.
  const [chunkSeconds, setChunkSeconds] = useState(asr.asrCfg.asr_chunk_seconds);
  // For Ollama only.
  const [model, setModel] = useState(
    provider.ai ? ai.stateFor(provider.ai.providerKey).model || provider.ai.model : "",
  );
  // "warn" tone = red text but for an intentional action (e.g. a
  // successful clear) rather than a failure. Same colour family as
  // "err" but kept as a distinct kind so the reader of this code knows
  // which case is which.
  const [feedback, setFeedback] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(
    null,
  );
  const [working, setWorking] = useState(false);

  // Provider switch: wipe draft + feedback. Feedback clear is gated to
  // ONLY this case — if we also reacted to configured-state changes
  // here, a successful save/clear would flicker its own success toast
  // away the instant the backend reload flipped `configured`.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setNewKey("");
      setFeedback(null);
    });
    return () => cancelAnimationFrame(id);
  }, [provider.id]);

  // Reseed model + language when the backend-held state refreshes
  // (after save / clear / sync). Touches ONLY those fields — keeps the
  // feedback message intact so the user can read "已从钥匙串中清除此
  // Key" / "已同步" without it vanishing mid-blink.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setLanguage(asr.asrCfg.asr_language);
      setChunkSeconds(asr.asrCfg.asr_chunk_seconds);
      if (provider.ai) {
        setModel(ai.stateFor(provider.ai.providerKey).model || provider.ai.model);
      }
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    asr.asrCfg.asr_language,
    asr.asrCfg.asr_chunk_seconds,
    aiState?.configured,
    asrState?.configured,
  ]);

  // Ollama local-model discovery.
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const refreshOllama = useCallback(async () => {
    setOllamaLoading(true);
    try {
      setOllama(await tauriInvoke<OllamaStatus>("detect_ollama"));
    } catch {
      setOllama({ running: false, models: [] });
    } finally {
      setOllamaLoading(false);
    }
  }, []);
  useEffect(() => {
    if (provider.ai?.providerKey === "ollama") refreshOllama();
  }, [provider.ai?.providerKey, refreshOllama]);

  const hasBoth = !!provider.ai && !!provider.asr;
  const isOllama = provider.ai?.providerKey === "ollama";

  /** Fan-out save. For dual-role providers we write the same key to
   *  both AI and ASR slots — users think "one service, one key", and
   *  for SiliconFlow/OpenAI that's actually how the provider works
   *  (a single account-level API key works for both endpoints). */
  const handleSave = async () => {
    if (!newKey.trim() && (!provider.ai || !provider.asr)) {
      // For single-role providers with no key typed, saving is only
      // meaningful if the user also wants to change model/language.
      // For non-Ollama single-role, there's literally nothing to save.
    }
    setWorking(true);
    setFeedback(null);
    try {
      if (provider.ai) {
        const payload: Parameters<typeof ai.saveConfig>[0] = {
          provider: provider.ai.providerKey,
          api_base: provider.ai.api_base,
          model: isOllama ? model : provider.ai.model,
        };
        if (newKey.trim()) payload.api_key = newKey.trim();
        await ai.saveConfig(payload);
      }
      if (provider.asr) {
        // Clamp client-side so a typo can't push past the backend's
        // 60–900s validation and surface as a cryptic error toast.
        const clampedChunk = Math.max(60, Math.min(900, Math.round(chunkSeconds) || 300));
        const payload: Parameters<typeof asr.saveConfig>[0] = {
          asr_provider: provider.asr.providerKey,
          asr_language: language,
          asr_api_base: provider.asr.api_base,
          asr_model: provider.asr.model,
          asr_chunk_seconds: clampedChunk,
        };
        if (newKey.trim()) payload.asr_api_key = newKey.trim();
        await asr.saveConfig(payload);
      }
      setNewKey("");
      setFeedback({ kind: "ok", text: "已保存" });
    } catch (e) {
      setFeedback({ kind: "err", text: String(e) });
    } finally {
      setWorking(false);
    }
  };

  /** One-click clear. Immediately writes an empty key to every role
   *  the provider supports, removing the entry from the OS keychain
   *  (or app_kv in dev). The old two-step "clear + save" dance was
   *  unnecessary friction for a destructive-but-recoverable action. */
  const handleClear = async () => {
    setWorking(true);
    setFeedback(null);
    try {
      if (provider.ai) {
        await ai.saveConfig({
          provider: provider.ai.providerKey,
          api_key: "",
        });
      }
      if (provider.asr) {
        await asr.saveConfig({
          asr_provider: provider.asr.providerKey,
          asr_api_key: "",
        });
      }
      setNewKey("");
      // Red tone on deletion: it's a destructive action, "this is gone
      // now". Green would read as "nice, saved!" which isn't right
      // when the saved state is "nothing".
      setFeedback({ kind: "warn", text: "已从系统钥匙串中清除此 Key" });
    } catch (e) {
      setFeedback({ kind: "err", text: String(e) });
    } finally {
      setWorking(false);
    }
  };

  const handleTestAi = async () => {
    if (!provider.ai) return;
    setFeedback(null);
    const payload: Parameters<typeof ai.smokeTest>[0] = {
      provider: provider.ai.providerKey,
      api_base: provider.ai.api_base,
      model: isOllama ? model : provider.ai.model,
    };
    if (newKey.trim()) payload.api_key = newKey.trim();
    await ai.smokeTest(payload);
  };

  // One-click sync for dual-role providers whose two sides drifted out
  // of sync — typically from a pre-Round-12 save that only wrote to
  // one slot. Reads the configured slot's key via the backend and
  // mirrors it to the empty slot. No re-pasting required.
  const handleSync = async () => {
    if (!hasBoth || !provider.ai || !provider.asr) return;
    setWorking(true);
    setFeedback(null);
    try {
      const msg = await tauriInvoke<string>("sync_dual_role_key", {
        aiProvider: provider.ai.providerKey,
        asrProvider: provider.asr.providerKey,
      });
      // Refresh both hooks so the status lines reflect the new state.
      await Promise.all([ai.loadConfig(), asr.loadConfig()]);
      setFeedback({ kind: "ok", text: msg });
    } catch (e) {
      setFeedback({ kind: "err", text: String(e) });
    } finally {
      setWorking(false);
    }
  };

  // Detect the "dual-role but out of sync" state that triggers the
  // sync affordance. We only show the call-to-action when exactly one
  // side is configured — both or neither configured need no button.
  const needsSync = hasBoth && (aiState?.configured ?? false) !== (asrState?.configured ?? false);

  const anyConfigured = (aiState?.configured ?? false) || (asrState?.configured ?? false);

  return (
    <div className="space-y-4">
      {/* Header — provider name + capability tags + signup hint */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-semibold text-text">{provider.label}</span>
          {provider.ai && <RoleBadge kind="text" />}
          {provider.asr && <RoleBadge kind="asr" />}
        </div>
        <div className="text-[12px] text-text-tertiary mt-0.5">注册：{provider.signupHint}</div>
      </div>

      {/* Role status lines — always show both when dual-role so the
          user sees which side is configured. */}
      <div className="rounded-lg bg-bg-tertiary/40 border border-border p-3 space-y-1.5">
        {provider.ai && aiState && (
          <RoleStatusRow kind="text" configured={aiState.configured} keyHint={aiState.key_hint} />
        )}
        {provider.asr && asrState && (
          <RoleStatusRow kind="asr" configured={asrState.configured} keyHint={asrState.key_hint} />
        )}

        {/* Dual-role reconciliation helper. Shown only when the two
            sides disagree — hidden for fresh providers (both empty)
            and fully configured ones (both set). */}
        {needsSync && (
          <div className="mt-2 pt-2 border-t border-border/60 flex items-center gap-2 flex-wrap text-[12px]">
            <span className="text-text-tertiary">
              同一把 {provider.label} Key 可同时用于文本和转录。
            </span>
            <button
              onClick={handleSync}
              disabled={working}
              className="px-2.5 py-0.5 rounded-md bg-accent/10 text-accent hover:bg-accent/15 transition-colors cursor-pointer disabled:opacity-50 text-[11px]"
            >
              一键同步已保存的 Key
            </button>
          </div>
        )}
      </div>

      {/* Single key input — same key is used for both AI and ASR when
          the provider does both (SiliconFlow / OpenAI: one account key
          works across their chat and audio endpoints). */}
      <div>
        <div className="text-[12px] text-text-tertiary mb-1">
          API Key
          {hasBoth && (
            <span className="ml-2 text-[11px] text-text-tertiary">
              (保存后会同时用于 AI 文本和视频转录)
            </span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <Input
            type="password"
            placeholder={anyConfigured ? "已保存（输入新值即可替换）" : "粘贴你的 API Key"}
            value={newKey}
            onChange={(e) => {
              setNewKey(e.target.value);
              setFeedback(null);
            }}
            className="font-mono w-72"
            autoComplete="off"
            spellCheck={false}
          />
          {anyConfigured && (
            <Button
              variant="ghost"
              size="sm"
              disabled={working}
              onClick={handleClear}
              title={
                hasBoth ? "立即从钥匙串删除此 Key（同时清除文本与转录）" : "立即从钥匙串删除此 Key"
              }
            >
              清除
            </Button>
          )}
        </div>
        {newKey && anyConfigured && (
          <div className="text-[11px] text-accent mt-1">将使用新输入的 Key 覆盖已保存的值</div>
        )}
      </div>

      {/* Ollama model picker */}
      {isOllama && (
        <OllamaModelPicker
          model={model}
          onChange={setModel}
          ollama={ollama}
          loading={ollamaLoading}
          onRefresh={refreshOllama}
        />
      )}

      {/* ASR language + long-audio chunk length (only shown if provider
          has ASR role). Both fields are global across providers — we
          surface them here so the user doesn't have to hunt in a
          separate settings section. */}
      {provider.asr && (
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-center text-[13px]">
          <span className="text-text-secondary">转录语言</span>
          <select
            className="w-72 h-8 px-3 text-[13px] bg-bg-secondary text-text border border-border rounded-md focus:outline-none focus:border-accent"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="">自动识别</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
          </select>

          <span className="text-text-secondary">分片时长</span>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={60}
              max={900}
              step={30}
              value={chunkSeconds}
              onChange={(e) => setChunkSeconds(Number(e.target.value))}
              className="w-28 font-mono"
            />
            <span className="text-[11px] text-text-tertiary">
              秒 · 超过此时长的音频自动分片转录（60–900）
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Button variant="primary" onClick={handleSave} disabled={working}>
          {working ? "处理中…" : "保存"}
        </Button>
        {provider.ai && (
          <Button onClick={handleTestAi} disabled={working}>
            测试连接
          </Button>
        )}
        {feedback && (
          <span
            className={`inline-flex items-center gap-1 text-[12px] ${
              feedback.kind === "ok" ? "text-green-600 dark:text-green-400" : "text-red-500"
            }`}
          >
            {feedback.kind === "ok" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {feedback.text}
          </span>
        )}
        {/* The render logic above treats warn and err identically —
            both map to red + AlertCircle — so no extra branch needed. */}
        {/* Passive aiMsg surface — only show when it differs from our
            own feedback so the two channels don't stomp each other. */}
        {!feedback && ai.aiMsg && ai.aiMsg !== "已保存" && (
          <span className="text-[12px] text-text-tertiary">{ai.aiMsg}</span>
        )}
      </div>
    </div>
  );
}

function RoleStatusRow({
  kind,
  configured,
  keyHint,
}: {
  kind: "text" | "asr";
  configured: boolean;
  keyHint: string;
}) {
  const label = kind === "text" ? "AI 文本" : "视频转录";
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <RoleBadge kind={kind} />
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          configured ? "bg-green-500" : "bg-red-500"
        }`}
      />
      <span className="text-text-secondary">{label}</span>
      <span className={configured ? "text-green-700 dark:text-green-400" : "text-text-tertiary"}>
        {configured ? "已配置" : "尚未配置"}
      </span>
      {configured && keyHint && (
        <span className="text-text-tertiary">
          · 尾号 <span className="font-mono text-text-secondary">{keyHint}</span>
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Ollama local-model picker
// ──────────────────────────────────────────────────────────────────

function OllamaModelPicker({
  model,
  onChange,
  ollama,
  loading,
  onRefresh,
}: {
  model: string;
  onChange: (m: string) => void;
  ollama: OllamaStatus | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] text-text-tertiary">本地模型</span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary cursor-pointer disabled:opacity-50"
          title="重新扫描已下载的 Ollama 模型"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          刷新
        </button>
      </div>
      {ollama && !ollama.running ? (
        <div className="text-[12px] text-yellow-700 dark:text-yellow-500">
          未检测到本地 Ollama（默认 11434 端口）。先启动{" "}
          <code className="font-mono">ollama serve</code> 再刷新。
        </div>
      ) : ollama && ollama.models.length === 0 ? (
        <div className="text-[12px] text-text-tertiary">
          Ollama 已运行，但未发现已下载的模型。运行{" "}
          <code className="font-mono">ollama pull llama3</code> 等先拉取一个。
        </div>
      ) : (
        <select
          className="w-72 h-8 px-3 text-[13px] bg-bg-secondary text-text border border-border rounded-md focus:outline-none focus:border-accent"
          value={model}
          onChange={(e) => onChange(e.target.value)}
        >
          {model && !ollama?.models.includes(model) && (
            <option value={model}>{model}（未在本地）</option>
          )}
          {!model && <option value="">选择一个模型…</option>}
          {ollama?.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
