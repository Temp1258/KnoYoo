import { useState, useRef, useEffect } from "react";
import { ChevronDown, X } from "lucide-react";

type Props = {
  options: string[];
  value: string | null;
  onChange: (val: string | null) => void;
  placeholder?: string;
};

export default function Combobox({ options, value, onChange, placeholder = "选择..." }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 h-7 px-2.5 text-[11px] rounded-lg border border-border bg-bg hover:border-accent/30 transition-colors cursor-pointer"
      >
        <span className={value ? "text-text" : "text-text-tertiary"}>{value || placeholder}</span>
        {value ? (
          <X
            size={10}
            className="text-text-tertiary hover:text-text"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
              setOpen(false);
            }}
          />
        ) : (
          <ChevronDown size={10} className="text-text-tertiary" />
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-48 max-h-52 bg-bg-secondary border border-border rounded-lg shadow-md z-20 flex flex-col overflow-hidden">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            autoFocus
            className="w-full px-2.5 py-1.5 text-[11px] bg-bg-tertiary border-b border-border focus:outline-none placeholder:text-text-tertiary"
          />
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-[11px] text-text-tertiary">无匹配项</div>
            )}
            {filtered.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                  setSearch("");
                }}
                className={`w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-bg-tertiary cursor-pointer transition-colors ${
                  opt === value ? "text-accent font-medium bg-accent/5" : "text-text"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
