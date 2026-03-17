import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement>;

export default function Input({ className = "", ...rest }: Props) {
  return (
    <input
      className={`w-full h-8 px-3 text-[13px] bg-bg-secondary text-text border border-border rounded-md transition-colors duration-200 placeholder:text-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}
