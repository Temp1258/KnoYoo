import { useState } from "react";
import { Chrome, ArrowRight, X, Sparkles, Shield } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Button from "../ui/Button";
import KnoYooLogo from "../Layout/KnoYooLogo";

type Props = {
  onComplete: () => void;
};

export default function OnboardingFlow({ onComplete }: Props) {
  const [step, setStep] = useState(0);

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
      description: "你的本地优先个人智库",
      content: (
        <div className="flex flex-col items-center py-6">
          <KnoYooLogo size={80} className="rounded-2xl mb-4" />
          <p className="text-[14px] text-text-secondary text-center max-w-sm leading-relaxed">
            KnoYoo 帮你将浏览器中有价值的内容变成可搜索、可关联的个人智库。 AI
            自动整理摘要和标签，让你快速找到需要的知识。
          </p>
          <div className="flex items-center gap-2 mt-6 px-4 py-2.5 rounded-xl bg-green-500/5 border border-green-500/15">
            <Shield size={14} className="text-green-600 shrink-0" />
            <span className="text-[12px] text-green-700">
              所有数据 100% 存储在本地设备，永远不会上传到云端
            </span>
          </div>
        </div>
      ),
    },
    {
      title: "安装浏览器扩展",
      description: "一键保存任何网页到智库",
      content: (
        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-bg-tertiary">
            <Chrome size={20} className="text-accent shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] text-text font-medium m-0">Chrome / Edge 扩展</p>
              <p className="text-[12px] text-text-secondary mt-1 m-0 leading-relaxed">
                安装扩展后，浏览任何网页时点击扩展图标即可一键保存。
                扩展会自动连接桌面端，无需手动配置。
              </p>
              <div className="mt-3 p-3 rounded-lg bg-bg-secondary text-[12px] text-text-secondary leading-relaxed">
                <p className="m-0 font-medium text-text mb-1.5">安装步骤：</p>
                <ol className="list-decimal pl-4 space-y-1 m-0">
                  <li>
                    打开{" "}
                    <code className="bg-bg-tertiary px-1 py-0.5 rounded text-[11px]">
                      chrome://extensions
                    </code>
                  </li>
                  <li>开启"开发者模式"</li>
                  <li>点击"加载已解压的扩展程序"</li>
                  <li>
                    选择{" "}
                    <code className="bg-bg-tertiary px-1 py-0.5 rounded text-[11px]">
                      apps/browser-extension/dist
                    </code>
                  </li>
                </ol>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-text-tertiary text-center">
            正式版本将发布到 Chrome Web Store，届时可一键安装
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
            <Sparkles size={14} />
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
