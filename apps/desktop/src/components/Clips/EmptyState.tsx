import { Download, Copy, Check, Sparkles, BookOpen } from "lucide-react";
import { useState } from "react";
import Button from "../ui/Button";

type Props = {
  onLoadDemo: () => void;
  onCopyToken: () => void;
  tokenCopied: boolean;
};

function Step({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 p-4 rounded-xl bg-bg-secondary border border-border">
      <div className="w-7 h-7 rounded-full bg-accent/10 text-accent text-[13px] font-semibold flex items-center justify-center shrink-0">
        {number}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-text mb-0.5">{title}</div>
        <div className="text-[12px] text-text-tertiary mb-2">{description}</div>
        {children}
      </div>
    </div>
  );
}

export default function EmptyState({ onLoadDemo, onCopyToken, tokenCopied }: Props) {
  const [demoLoading, setDemoLoading] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center py-12 max-w-md mx-auto">
      <div className="mb-6 relative">
        <BookOpen size={56} strokeWidth={1} className="text-text-tertiary opacity-30" />
        <Sparkles size={20} className="absolute -top-1 -right-2 text-accent opacity-60" />
      </div>

      <h2 className="text-[20px] font-bold text-text mb-1">开始构建你的知识库</h2>
      <p className="text-[13px] text-text-tertiary mb-6">三步开始，一键收藏有价值的网页内容</p>

      <div className="w-full space-y-3 mb-6">
        <Step
          number={1}
          title="安装浏览器插件"
          description="从项目中加载 browser-extension 目录作为 Chrome 插件"
        >
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline"
          >
            <Download size={12} />
            查看安装说明
          </a>
        </Step>

        <Step
          number={2}
          title="配置连接 Token"
          description="复制 Token 粘贴到浏览器插件的设置中，建立连接"
        >
          <Button variant="ghost" size="sm" onClick={onCopyToken}>
            {tokenCopied ? <Check size={12} /> : <Copy size={12} />}
            {tokenCopied ? "已复制" : "复制 Token"}
          </Button>
        </Step>

        <Step
          number={3}
          title="保存第一个��藏"
          description="浏���网页时点击插件图标或页面右上角的浮窗，一键收藏"
        />
      </div>

      <div className="w-full border-t border-border pt-4">
        <button
          onClick={async () => {
            setDemoLoading(true);
            await onLoadDemo();
            setDemoLoading(false);
          }}
          disabled={demoLoading}
          className="w-full py-2.5 rounded-xl bg-bg-secondary border border-border hover:border-accent/20 text-[13px] text-text-secondary flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <Sparkles size={14} className={demoLoading ? "animate-pulse" : ""} />
          {demoLoading ? "加载中..." : "先看看效果：加载示例数据"}
        </button>
      </div>
    </div>
  );
}
