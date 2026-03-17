import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Sparkles, ArrowRight, Loader2, Briefcase, Cpu, Check } from "lucide-react";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Card from "../components/ui/Card";
import type { CareerTemplate, OllamaStatus } from "../types";

type Step = "welcome" | "choose" | "custom" | "ai-config" | "loading" | "done";

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [templates, setTemplates] = useState<CareerTemplate[]>([]);
  const [customCareer, setCustomCareer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // AI config state
  const [provider, setProvider] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);

  useEffect(() => {
    tauriInvoke<CareerTemplate[]>("list_career_templates").then(setTemplates).catch(console.error);
    // Load existing AI config
    tauriInvoke<Record<string, string>>("get_ai_config").then((cfg) => {
      if (cfg.provider) setProvider(cfg.provider);
      if (cfg.api_base) setApiBase(cfg.api_base);
      if (cfg.api_key) setApiKey(cfg.api_key);
      if (cfg.model) setModel(cfg.model);
    }).catch(console.error);
    // Detect Ollama
    tauriInvoke<OllamaStatus>("detect_ollama").then(setOllamaStatus).catch(console.error);
  }, []);

  async function applyTemplate(templateId: string) {
    setLoading(true);
    setError("");
    try {
      await tauriInvoke("apply_career_template", { templateId });
      await tauriInvoke("mark_onboarded");
      setStep("done");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function generateCustom() {
    if (!customCareer.trim()) return;
    setLoading(true);
    setError("");
    try {
      await tauriInvoke("ai_generate_career_tree", { career: customCareer.trim() });
      await tauriInvoke("mark_onboarded");
      setStep("done");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveAIConfig() {
    try {
      const cfg: Record<string, string> = {};
      if (provider) cfg.provider = provider;
      if (apiBase) cfg.api_base = apiBase;
      if (apiKey) cfg.api_key = apiKey;
      if (model) cfg.model = model;
      await tauriInvoke("set_ai_config", { cfg });
      setStep("custom");
    } catch (e) {
      setError(String(e));
    }
  }

  function goToApp() {
    navigate("/");
  }

  if (step === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center space-y-4">
          <Loader2 size={48} className="animate-spin text-accent mx-auto" />
          <p className="text-[15px] text-text-secondary">AI 正在为你生成个性化成长路径...</p>
          <p className="text-[12px] text-text-tertiary">这可能需要 10-30 秒</p>
        </div>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center space-y-6 max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto">
            <Sparkles size={32} className="text-success" />
          </div>
          <h1 className="text-[24px] font-bold text-text">一切就绪!</h1>
          <p className="text-[15px] text-text-secondary leading-relaxed">
            你的技能树和首周学习计划已经生成。<br />
            现在开始你的成长之旅吧。
          </p>
          <Button variant="primary" onClick={goToApp}>
            开始使用 <ArrowRight size={16} />
          </Button>
        </div>
      </div>
    );
  }

  if (step === "ai-config") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-6">
        <div className="max-w-lg w-full space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-[24px] font-bold text-text">配置 AI 服务</h1>
            <p className="text-[14px] text-text-secondary">
              自定义职业需要 AI 生成技能树。请先配置你的 AI 服务。
            </p>
          </div>

          <Card padding="lg">
            {/* Ollama quick setup */}
            {ollamaStatus?.running && ollamaStatus.models.length > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/15">
                <div className="flex items-center gap-2 mb-2">
                  <Cpu size={16} className="text-blue-500" />
                  <span className="text-[13px] font-medium text-text">检测到本地 Ollama</span>
                </div>
                <div className="text-[12px] text-text-secondary mb-2">无需 API Key，一键使用本地模型：</div>
                <div className="flex flex-wrap gap-1.5">
                  {ollamaStatus.models.slice(0, 4).map((m) => (
                    <Button
                      key={m}
                      size="sm"
                      variant="primary"
                      onClick={async () => {
                        await tauriInvoke("auto_configure_ollama", { model: m });
                        setApiKey("ollama");
                        setApiBase("http://localhost:11434");
                        setProvider("ollama");
                        setModel(m);
                        setStep("custom");
                      }}
                    >
                      <Check size={12} /> {m}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-[12px] text-text-secondary mb-1 block">Provider</label>
                <select
                  className="w-full h-8 px-3 text-[13px] bg-bg text-text border border-border rounded-md focus:outline-none focus:border-accent"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="">（请选择）</option>
                  <option value="openai">OpenAI / 兼容</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="silicon">SiliconCloud</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="ollama">Ollama（本地）</option>
                </select>
              </div>
              <div>
                <label className="text-[12px] text-text-secondary mb-1 block">API Base URL</label>
                <Input
                  placeholder="https://api.deepseek.com"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[12px] text-text-secondary mb-1 block">API Key</label>
                <Input
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="text-[12px] text-text-secondary mb-1 block">模型</label>
                <Input
                  placeholder="deepseek-chat / gpt-4o-mini"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
            </div>
            {error && <p className="text-[12px] text-danger mt-2">{error}</p>}
            <div className="flex gap-2 mt-4">
              <Button onClick={() => setStep("choose")}>返回</Button>
              <Button variant="primary" onClick={saveAIConfig} disabled={!apiBase || !apiKey}>
                保存并继续
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (step === "custom") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-6">
        <div className="max-w-lg w-full space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-[24px] font-bold text-text">描述你的职业目标</h1>
            <p className="text-[14px] text-text-secondary">
              AI 会根据你的描述生成完整的技能树和首周计划
            </p>
          </div>

          <Card padding="lg">
            <Input
              placeholder="例如：转行做 AI 产品经理 / 成为高级全栈工程师 / 从运营转技术..."
              value={customCareer}
              onChange={(e) => setCustomCareer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && generateCustom()}
            />
            {error && <p className="text-[12px] text-danger mt-2">{error}</p>}
            <div className="flex gap-2 mt-4">
              <Button onClick={() => setStep("choose")}>返回</Button>
              <Button variant="primary" onClick={generateCustom} disabled={!customCareer.trim()}>
                <Sparkles size={14} /> AI 生成技能树
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (step === "choose") {
    return (
      <div className="min-h-screen bg-bg p-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-[24px] font-bold text-text">选择你的职业方向</h1>
            <p className="text-[14px] text-text-secondary">
              选择一个模板快速开始，或自定义你的目标
            </p>
          </div>

          {/* Custom option */}
          <button
            onClick={() => {
              if (!apiKey) {
                setStep("ai-config");
              } else {
                setStep("custom");
              }
            }}
            className="w-full text-left p-4 rounded-xl border-2 border-dashed border-accent/30 bg-accent/5 hover:bg-accent/10 hover:border-accent/50 transition-all cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                <Sparkles size={20} className="text-accent" />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-accent">自定义职业目标</div>
                <div className="text-[12px] text-text-secondary">AI 根据你的描述生成个性化技能树</div>
              </div>
            </div>
          </button>

          {/* Template grid */}
          <div className="grid grid-cols-2 gap-3">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => applyTemplate(tpl.id)}
                className="text-left p-4 rounded-xl border border-border bg-bg-secondary hover:border-accent/50 hover:shadow-sm transition-all cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-bg-tertiary flex items-center justify-center shrink-0 mt-0.5">
                    <Briefcase size={18} className="text-text-secondary" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-text">{tpl.name}</div>
                    <div className="text-[12px] text-text-secondary mt-0.5">{tpl.description}</div>
                    <div className="text-[11px] text-text-tertiary mt-1">
                      {tpl.skills.length} 个核心技能 · {tpl.skills.reduce((a, s) => a + s.children.length, 0)} 个子技能
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {error && <p className="text-[13px] text-danger text-center">{error}</p>}

          <div className="text-center">
            <Button onClick={() => { tauriInvoke("mark_onboarded").then(goToApp); }}>
              跳过，稍后设置
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Welcome step
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center space-y-8 max-w-md px-6">
        {/* Logo */}
        <div className="w-20 h-20 rounded-2xl bg-accent flex items-center justify-center text-white font-bold text-[28px] mx-auto shadow-lg">
          K
        </div>

        <div className="space-y-3">
          <h1 className="text-[28px] font-bold text-text tracking-tight">
            欢迎来到 KnoYoo
          </h1>
          <p className="text-[16px] text-text-secondary leading-relaxed">
            你的 AI 职业成长教练
          </p>
          <p className="text-[14px] text-text-tertiary leading-relaxed">
            告诉我你的职业目标，我会为你规划完整的技能成长路径，<br />
            并每天督促你执行。
          </p>
        </div>

        <div className="space-y-3">
          <Button variant="primary" onClick={() => setStep("choose")}>
            开始规划我的成长 <ArrowRight size={16} />
          </Button>
          <div>
            <button
              onClick={() => { tauriInvoke("mark_onboarded").then(goToApp); }}
              className="text-[13px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
            >
              我是老用户，跳过引导
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
