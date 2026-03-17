import { useState, useEffect } from "react";
import { ArrowRight, Sparkles, Network, CalendarCheck, MessageCircle } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Button from "../ui/Button";

const TOUR_STEPS = [
  {
    icon: Sparkles,
    title: "欢迎来到 KnoYoo",
    body: "你的 AI 职业成长教练已就绪。让我快速介绍一下核心功能。",
    color: "text-accent",
    bg: "bg-accent/10",
  },
  {
    icon: CalendarCheck,
    title: "计划 — 你的每周行动",
    body: "左侧导航第一个图标。这里管理你的周/季度学习任务，AI 可以帮你自动生成计划。",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: Network,
    title: "技能树 — 可视化你的能力",
    body: "第二个图标。你的技能以树状图展示，节点会随学习进度变色（灰→黄→绿）。",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
  },
  {
    icon: Sparkles,
    title: "教练 — AI 伴你成长",
    body: "第三个图标。查看学习连续天数、技能雷达图，获取 AI 教练的个性化周报和建议。",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
  {
    icon: MessageCircle,
    title: "AI 对话 — 随时提问",
    body: "右下角的蓝色圆按钮。AI 教练了解你的所有学习数据，可以给出针对性建议。",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
  },
];

export default function ProductTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show tour only if not seen before
    tauriInvoke<string | null>("get_career_goal")
      .then(() => {
        const seen = localStorage.getItem("knoyoo-tour-seen");
        if (!seen) setVisible(true);
      })
      .catch(console.error);
  }, []);

  if (!visible) return null;

  const current = TOUR_STEPS[step];
  const Icon = current.icon;
  const isLast = step === TOUR_STEPS.length - 1;

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem("knoyoo-tour-seen", "1");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-bg-secondary rounded-2xl shadow-lg border border-border max-w-md w-full mx-4 overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-bg-tertiary">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${((step + 1) / TOUR_STEPS.length) * 100}%` }}
          />
        </div>

        <div className="p-6">
          {/* Icon */}
          <div className={`w-14 h-14 rounded-2xl ${current.bg} flex items-center justify-center mb-4`}>
            <Icon size={28} className={current.color} />
          </div>

          {/* Content */}
          <h2 className="text-[20px] font-bold text-text mb-2">{current.title}</h2>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-6">{current.body}</p>

          {/* Step indicator */}
          <div className="flex items-center gap-1.5 mb-4">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-6 bg-accent" : i < step ? "w-1.5 bg-accent/40" : "w-1.5 bg-border"
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={dismiss}
              className="text-[13px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
            >
              跳过引导
            </button>
            <div className="flex gap-2">
              {step > 0 && (
                <Button size="sm" onClick={() => setStep((s) => s - 1)}>
                  上一步
                </Button>
              )}
              {isLast ? (
                <Button size="sm" variant="primary" onClick={dismiss}>
                  开始使用
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => setStep((s) => s + 1)}>
                  下一步 <ArrowRight size={14} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
