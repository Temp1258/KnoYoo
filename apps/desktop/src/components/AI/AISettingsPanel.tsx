import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAIConfig } from "../../hooks/useAIConfig";
import Card from "../ui/Card";
import Input from "../ui/Input";
import Button from "../ui/Button";

const QUICK_PRESETS = [
  { label: "DeepSeek", provider: "deepseek", api_base: "https://api.deepseek.com", model: "deepseek-chat", region: "cn" },
  { label: "SiliconCloud", provider: "silicon", api_base: "https://api.siliconflow.cn", model: "deepseek-ai/DeepSeek-V3", region: "cn" },
  { label: "通义千问", provider: "dashscope", api_base: "https://dashscope.aliyuncs.com/compatible-mode", model: "qwen-plus", region: "cn" },
  { label: "智谱 GLM", provider: "zhipu", api_base: "https://open.bigmodel.cn/api/paas", model: "glm-4-flash", region: "cn" },
  { label: "Moonshot", provider: "moonshot", api_base: "https://api.moonshot.cn", model: "moonshot-v1-8k", region: "cn" },
  { label: "Ollama (本地)", provider: "ollama", api_base: "http://localhost:11434", model: "llama3", region: "cn" },
  { label: "OpenAI", provider: "openai", api_base: "https://api.openai.com", model: "gpt-4o-mini", region: "intl" },
  { label: "Anthropic", provider: "anthropic", api_base: "https://api.anthropic.com", model: "claude-sonnet-4-20250514", region: "intl" },
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
        <div className="text-[12px] text-text-tertiary mb-2">国内可用</div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PRESETS.filter((p) => p.region === "cn").map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className={`px-3 py-1.5 text-[12px] whitespace-nowrap rounded-md border transition-colors cursor-pointer ${
                aiCfg.provider === p.provider
                  ? "border-accent bg-accent/10 text-accent font-medium"
                  : "border-border text-text-secondary hover:border-accent/30 hover:bg-bg-tertiary"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="text-[12px] text-text-tertiary mt-2 mb-1">海外服务（需科学上网）</div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PRESETS.filter((p) => p.region === "intl").map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className={`px-3 py-1.5 text-[12px] whitespace-nowrap rounded-md border transition-colors cursor-pointer ${
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
            <option value="deepseek">DeepSeek</option>
            <option value="silicon">SiliconCloud</option>
            <option value="dashscope">通义千问</option>
            <option value="zhipu">智谱 GLM</option>
            <option value="moonshot">Moonshot / Kimi</option>
            <option value="ollama">Ollama（本地）</option>
            <option value="openai">OpenAI（需科学上网）</option>
            <option value="anthropic">Anthropic（需科学上网）</option>
          </select>

          <span className="text-text-secondary">API Base</span>
          <Input
            placeholder="https://api.openai.com 或兼容地址"
            value={aiCfg.api_base || ""}
            onChange={(e) => setAiCfg({ ...aiCfg, api_base: e.target.value })}
          />

          <span className="text-text-secondary">Model</span>
          <Input
            placeholder="deepseek-chat / qwen-plus / glm-4-flash"
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
