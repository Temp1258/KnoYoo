import { useState } from "react";
import { Copy, Check, Sparkles, ArrowRight, X } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Button from "../ui/Button";
import AISettingsPanel from "../AI/AISettingsPanel";

type Props = {
  serverToken: string;
  onComplete: () => void;
};

export default function OnboardingFlow({ serverToken, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [tokenCopied, setTokenCopied] = useState(false);

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(serverToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  const handleSkip = async () => {
    await tauriInvoke("set_onboarding_complete").catch(console.error);
    onComplete();
  };

  const handleFinish = async () => {
    await tauriInvoke("set_onboarding_complete").catch(console.error);
    onComplete();
  };

  const steps = [
    {
      title: "欢迎使用 KnoYoo",
      description: "你的个人知识库，一键收藏、AI 自动整理、智能检索",
      content: (
        <div className="flex flex-col items-center py-8">
          <img src="/logo.png" alt="KnoYoo" className="w-20 h-20 rounded-2xl mb-4" />
          <p className="text-[14px] text-text-secondary text-center max-w-sm">
            KnoYoo 帮你将浏览器中有价值的内容变成可搜索、可关联的个人知识库。
          </p>
        </div>
      ),
    },
    {
      title: "安装浏览器插件",
      description: "从项目目录加载 Chrome 插件",
      content: (
        <div className="space-y-3 py-4">
          <div className="p-4 rounded-xl bg-bg-tertiary text-[13px] text-text-secondary leading-relaxed">
            <ol className="list-decimal pl-4 space-y-2 m-0">
              <li>
                打开 Chrome，访问{" "}
                <code className="bg-bg-secondary px-1.5 py-0.5 rounded text-[12px]">
                  chrome://extensions
                </code>
              </li>
              <li>开启右上角的"开发者模式"</li>
              <li>点击"加载已解压的扩展程序"</li>
              <li>
                选择项目中的{" "}
                <code className="bg-bg-secondary px-1.5 py-0.5 rounded text-[12px]">
                  apps/browser-extension/dist
                </code>{" "}
                目录
              </li>
            </ol>
          </div>
        </div>
      ),
    },
    {
      title: "配置连接 Token",
      description: "复制 Token 到插件设置中建立连接",
      content: (
        <div className="flex flex-col items-center py-6 gap-4">
          <div className="px-4 py-3 rounded-xl bg-bg-tertiary text-[13px] font-mono text-text break-all max-w-sm text-center">
            {serverToken || "加载中..."}
          </div>
          <Button variant="primary" size="sm" onClick={handleCopyToken}>
            {tokenCopied ? <Check size={14} /> : <Copy size={14} />}
            {tokenCopied ? "已复制" : "复制 Token"}
          </Button>
          <p className="text-[12px] text-text-tertiary text-center">
            在浏览器插件弹窗中展开"连接设置"，粘贴此 Token
          </p>
        </div>
      ),
    },
    {
      title: "配置 AI（可选）",
      description: "配置 AI 后收藏内容会自动生成摘要和标签",
      content: (
        <div className="max-h-64 overflow-y-auto">
          <AISettingsPanel />
        </div>
      ),
    },
    {
      title: "准备就绪",
      description: "现在开始收藏你的第一个网页吧",
      content: (
        <div className="flex flex-col items-center py-8">
          <Sparkles size={48} className="text-accent mb-4" />
          <p className="text-[14px] text-text-secondary text-center max-w-sm">
            浏览网页时，点击浏览器插件图标或页面右上角的浮窗即可一键收藏。收藏的内容会自动出现在你的知识库中。
          </p>
        </div>
      ),
    },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="max-w-lg mx-auto py-8">
      {/* Progress */}
      <div className="flex gap-1.5 mb-6">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`flex-1 h-1 rounded-full transition-colors ${
              i <= step ? "bg-accent" : "bg-bg-tertiary"
            }`}
          />
        ))}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h2 className="text-[22px] font-bold text-text m-0">{current.title}</h2>
          <p className="text-[13px] text-text-tertiary mt-1 m-0">{current.description}</p>
        </div>
        <button
          onClick={handleSkip}
          className="p-1 text-text-tertiary hover:text-text cursor-pointer transition-colors"
          title="跳过设置"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="my-4">{current.content}</div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          上一步
        </Button>
        {isLast ? (
          <Button variant="primary" onClick={handleFinish}>
            开始使用
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setStep((s) => s + 1)}>
            下一步 <ArrowRight size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}
