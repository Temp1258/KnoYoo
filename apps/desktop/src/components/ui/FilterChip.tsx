import { X } from "lucide-react";

type Props = {
  label: string;
  onDismiss: () => void;
};

export default function FilterChip({ label, onDismiss }: Props) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px]">
      {label}
      <button onClick={onDismiss} className="hover:text-danger cursor-pointer transition-colors">
        <X size={10} />
      </button>
    </span>
  );
}
