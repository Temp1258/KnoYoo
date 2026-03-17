import { useAIConfig } from "../../hooks/useAIConfig";
import Card from "../ui/Card";
import Input from "../ui/Input";
import Button from "../ui/Button";

export default function AISettingsPanel() {
  const { aiCfg, setAiCfg, aiMsg, saveConfig, smokeTest } = useAIConfig();

  return (
    <Card>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 items-center text-[13px]">
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
          placeholder="https://api.openai.com/v1 或兼容地址"
          value={aiCfg.api_base || ""}
          onChange={(e) => setAiCfg({ ...aiCfg, api_base: e.target.value })}
        />

        <span className="text-text-secondary">API Key</span>
        <Input
          placeholder="sk-..."
          value={aiCfg.api_key || ""}
          onChange={(e) => setAiCfg({ ...aiCfg, api_key: e.target.value })}
          className="font-mono"
        />

        <span className="text-text-secondary">Model</span>
        <Input
          placeholder="gpt-4o-mini / deepseek-chat / claude-3-5-sonnet"
          value={aiCfg.model || ""}
          onChange={(e) => setAiCfg({ ...aiCfg, model: e.target.value })}
        />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button variant="primary" onClick={saveConfig}>
          保存
        </Button>
        <Button onClick={smokeTest}>冒烟自检</Button>
        {aiMsg && <span className="text-[12px] text-text-secondary ml-2">{aiMsg}</span>}
      </div>
    </Card>
  );
}
