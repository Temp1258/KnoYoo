import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  "inline-flex items-center justify-center gap-1.5 font-medium rounded-md transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none";

const variants: Record<Variant, string> = {
  default: "bg-bg-secondary text-text border border-border hover:bg-bg-tertiary active:bg-border",
  primary: "bg-accent text-white hover:bg-accent-hover active:bg-accent border-none",
  ghost: "bg-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text border-none",
  danger: "bg-transparent text-danger hover:bg-danger-light border border-danger/30",
};

const sizes: Record<Size, string> = {
  sm: "px-2.5 py-1 text-[12px] h-7",
  md: "px-3 py-1.5 text-[13px] h-8",
};

export default function Button({
  variant = "default",
  size = "md",
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
