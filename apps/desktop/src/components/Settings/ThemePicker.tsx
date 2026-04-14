import { Check } from "lucide-react";
import { useTheme, THEMES, type ThemeMeta } from "../../hooks/useTheme";

function ThemePreview({ p }: { p: ThemeMeta["preview"] }) {
  return (
    <div
      className="w-full h-[92px] rounded-lg overflow-hidden flex border"
      style={{ background: p.bg, borderColor: p.border }}
    >
      {/* mini sidebar */}
      <div
        className="w-[18px] shrink-0 flex flex-col items-center gap-1.5 py-2 border-r"
        style={{ background: p.surface, borderColor: p.border }}
      >
        <div className="w-[8px] h-[8px] rounded-[2px]" style={{ background: p.accent }} />
        <div
          className="w-[8px] h-[8px] rounded-[2px]"
          style={{ background: p.textSecondary, opacity: 0.5 }}
        />
        <div
          className="w-[8px] h-[8px] rounded-[2px]"
          style={{ background: p.textSecondary, opacity: 0.5 }}
        />
      </div>
      {/* main */}
      <div className="flex-1 p-2 flex flex-col gap-1.5">
        <div
          className="rounded px-1.5 py-1 flex flex-col gap-1 border"
          style={{ background: p.surface, borderColor: p.border }}
        >
          <div
            className="h-[5px] w-2/3 rounded-full"
            style={{ background: p.text, opacity: 0.85 }}
          />
          <div
            className="h-[3px] w-full rounded-full"
            style={{ background: p.textSecondary, opacity: 0.55 }}
          />
          <div
            className="h-[3px] w-4/5 rounded-full"
            style={{ background: p.textSecondary, opacity: 0.55 }}
          />
        </div>
        <div className="flex items-center gap-1">
          <div className="h-[10px] w-[22px] rounded" style={{ background: p.accent }} />
          <div
            className="h-[10px] w-[14px] rounded border"
            style={{ background: p.surface, borderColor: p.border }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ThemePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {THEMES.map((t) => {
        const selected = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            className={`group relative flex flex-col gap-2 p-2.5 rounded-xl bg-bg-secondary border transition-all cursor-pointer text-left ${
              selected
                ? "border-accent ring-2 ring-accent/25"
                : "border-border hover:border-accent/40"
            }`}
            aria-pressed={selected}
            aria-label={`切换到${t.label}主题`}
          >
            <ThemePreview p={t.preview} />
            <div className="flex items-start justify-between gap-2 px-0.5">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-text truncate">{t.label}</div>
                <div className="text-[11px] text-text-tertiary truncate">{t.description}</div>
              </div>
              {selected && (
                <div className="shrink-0 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                  <Check size={10} strokeWidth={3} className="text-white" />
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
