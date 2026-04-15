import { BookUp } from "lucide-react";

export default function BookDropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-bg/80 backdrop-blur-sm animate-fade-in pointer-events-none"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-4 px-16 py-14 rounded-2xl border-2 border-dashed border-accent bg-bg-secondary/90 shadow-lg">
        <div className="w-16 h-16 rounded-2xl bg-accent-light flex items-center justify-center">
          <BookUp size={32} className="text-accent" strokeWidth={1.6} />
        </div>
        <div className="text-[16px] font-semibold text-text">松开以添加到书籍</div>
        <div className="text-[12px] text-text-tertiary">支持 EPUB、PDF</div>
      </div>
    </div>
  );
}
