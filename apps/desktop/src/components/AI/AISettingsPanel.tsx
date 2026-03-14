import { useAIConfig } from "../../hooks/useAIConfig";

export default function AISettingsPanel() {
  const { aiCfg, setAiCfg, aiMsg, saveConfig, smokeTest } = useAIConfig();

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div className="ai-settings-grid">
        <div>Provider</div>
        <select value={aiCfg.provider || ""} onChange={(e) => setAiCfg({ ...aiCfg, provider: e.target.value })}>
          <option value="">（未设置）</option>
          <option value="openai">OpenAI / 兼容</option>
          <option value="deepseek">DeepSeek</option>
          <option value="silicon">SiliconCloud</option>
          <option value="anthropic">Anthropic</option>
          <option value="ollama">Ollama（本地）</option>
        </select>
        <div>API Base</div>
        <input
          className="input"
          placeholder="https://api.openai.com/v1 或兼容地址"
          value={aiCfg.api_base || ""}
          onChange={(e) => setAiCfg({ ...aiCfg, api_base: e.target.value })}
        />
        <div>API Key</div>
        <input
          className="input"
          placeholder="sk-..."
          value={aiCfg.api_key || ""}
          onChange={(e) => setAiCfg({ ...aiCfg, api_key: e.target.value })}
          style={{ fontFamily: "monospace" }}
        />
        <div>Model</div>
        <input
          className="input"
          placeholder="如 gpt-4o-mini / deepseek-chat / claude-3-5-sonnet 等"
          value={aiCfg.model || ""}
          onChange={(e) => setAiCfg({ ...aiCfg, model: e.target.value })}
        />
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button className="btn primary" onClick={saveConfig}>保存</button>
        <button className="btn" onClick={smokeTest}>冒烟自检</button>
      </div>
      {aiMsg && <div className="ai-msg">{aiMsg}</div>}
    </div>
  );
}
