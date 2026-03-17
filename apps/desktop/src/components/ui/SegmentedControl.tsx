interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: Props<T>) {
  return (
    <div className={`inline-flex bg-bg-tertiary rounded-md p-0.5 gap-0.5 ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 text-[12px] font-medium rounded-md transition-all duration-200 cursor-pointer select-none ${
            value === opt.value
              ? "bg-bg-secondary text-text shadow-xs"
              : "text-text-secondary hover:text-text"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
