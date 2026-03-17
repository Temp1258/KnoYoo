import type { HTMLAttributes } from "react";

type Variant = "default" | "accent" | "success" | "danger";

interface Props extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  default: "bg-bg-tertiary text-text-secondary",
  accent: "bg-accent-light text-accent",
  success: "bg-success-light text-success",
  danger: "bg-danger-light text-danger",
};

export default function Badge({ variant = "default", className = "", children, ...rest }: Props) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
