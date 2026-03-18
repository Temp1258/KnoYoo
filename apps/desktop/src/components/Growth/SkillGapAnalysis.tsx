import { useState } from "react";
import { TrendingUp, Loader2 } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import Card from "../ui/Card";
import Button from "../ui/Button";

export default function SkillGapAnalysis() {
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    setLoading(true);
    try {
      const r = await tauriInvoke<string>("ai_skill_gap_analysis");
      setReport(r);
    } catch (e) {
      setReport(`分析失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[17px] font-semibold m-0">技能差距分析</h3>
          <p className="text-[12px] text-text-tertiary m-0 mt-0.5">
            AI 分析你的学习数据，推荐下一步应该重点提升的技能
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={analyze} disabled={loading}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <TrendingUp size={13} />}
          {loading ? "分析中..." : "获取建议"}
        </Button>
      </div>
      {report ? (
        <div className="prose prose-sm max-w-none text-[13px] text-text leading-relaxed bg-bg-tertiary rounded-lg p-4">
          {report.split("\n").map((line, i) => {
            if (line.startsWith("## "))
              return <h4 key={i} className="text-[15px] font-semibold mt-3 mb-1 first:mt-0">{line.replace("## ", "")}</h4>;
            if (line.startsWith("### "))
              return <h5 key={i} className="text-[14px] font-semibold mt-2 mb-1">{line.replace("### ", "")}</h5>;
            if (line.startsWith("- ") || line.startsWith("* "))
              return <li key={i} className="ml-4 mb-0.5">{line.replace(/^[-*] /, "")}</li>;
            if (line.startsWith("**") && line.endsWith("**"))
              return <p key={i} className="font-semibold my-1">{line.replace(/\*\*/g, "")}</p>;
            if (line.startsWith("> "))
              return <blockquote key={i} className="border-l-2 border-accent pl-3 my-2 text-text-secondary italic">{line.replace("> ", "")}</blockquote>;
            if (line.trim() === "") return <br key={i} />;
            return <p key={i} className="my-0.5">{line}</p>;
          })}
        </div>
      ) : (
        <div className="text-[13px] text-text-tertiary py-8 text-center bg-bg-tertiary rounded-lg">
          点击"获取建议"，AI 教练会分析你的技能差距并推荐学习重点
        </div>
      )}
    </Card>
  );
}
