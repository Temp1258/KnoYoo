import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAIConfig } from "../../hooks/useAIConfig";
import Card from "../ui/Card";
import Input from "../ui/Input";
import Button from "../ui/Button";

const QUICK_PRESETS = [
  { label: "DeepSeek", provider: "deepseek", api_base: "https://api.deepseek.com", model: "deepseek-chat" },
  { label: "OpenAI", provider: "openai", api_base: "https://api.openai.com", model: "gpt-4o-mini" },
  { label: "SiliconCloud", provider: "silicon", api_base: "https://api.siliconflow.cn", model: "deepseek-ai/DeepSeek-V3" },
  { label: "Ollama (本地)", provider: "ollama", api_base: "http://localhost:11434", model: "llama3" },
];

export default function AISettingsPanel() {
  const { aiCfg, setAiCfg, aiMsg, saveConfig, smokeTest } = useAIConfig();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const applyPreset = (preset: typeof QUICK_PRESETS[0]) => {
    setAiCfg({
      ...aiCfg,
      provider: preset.provider,
      api_base: preset.api_base,
      model: preset.model,
    });
  };

  return (
    <Card>
      {/* Quick setup */}
      <div className="mb-3">
        <div className="text-[12px] text-text-tertiary mb-2">快速配置</div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className={`px-3 py-1.5 text-[12px] rounded-md border transition-colors cursor-pointer ${
                aiCfg.provider === p.provider
                  ? "border-accent bg-accent/10 text-accent font-medium"
                  : "border-border text-text-secondary hover:border-accent/30 hover:bg-bg-tertiary"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* API Key - always visible since it's the only required user input */}
      <div className="mb-3">
        <div className="text-[12px] text-text-tertiary mb-1">API Key</div>
        <Input
          placeholder="sk-... (填入你的密钥即可开始使用)"
          value={aiCfg.api_key || ""}
          onChange={(e) => setAiCfg({ ...aiCfg, api_key: e.target.value })}
          className="font-mono"
        />
      </div>

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1 text-[12px] text-text-tertiary hover:text-text-secondary transition-colors mb-2 cursor-pointer"
      >
        {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        高级设置
      </button>

      {showAdvanced && (
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 items-center text-[13px] mb-3 pl-2 border-l-2 border-border">
          <span className="text-text-secondary">Provider</span>
          <select
            className="h-8 px-3 text-[13px] bg-bg-secondary text-text border border-border rounded-md focus:outline-none focus:border-accent"
            value={aiCfg.provider || ""}
            onChange={(e) => setAiCfg({ ...aiCfg, provider: e.target.value })}
          >
            <option value="">（未设置）</option>
            <option value="openai">OpenAI / 兼容</option>
            <option value="deepseek">DeepSeek</option>
            <option value="silicon">SiliconCloud</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">Ollama（本地）</option>
          </select>

          <span className="text-text-secondary">API Base</span>
          <Input
            placeholder="https://api.openai.com 或兼容地址"
            value={aiCfg.api_base || ""}
            onChange={(e) => setAiCfg({ ...aiCfg, api_base: e.target.value })}
          />

          <span className="text-text-secondary">Model</span>
          <Input
            placeholder="gpt-4o-mini / deepseek-chat"
            value={aiCfg.model || ""}
            onChange={(e) => setAiCfg({ ...aiCfg, model: e.target.value })}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={saveConfig}>
          保存
        </Button>
        <Button onClick={smokeTest}>测试连接</Button>
        {aiMsg && <span className="text-[12px] text-text-secondary ml-2">{aiMsg}</span>}
      </div>
    </Card>
  );
}
