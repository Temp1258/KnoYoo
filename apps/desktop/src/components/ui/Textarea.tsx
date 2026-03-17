import type { TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

export default function Textarea({ className = "", ...rest }: Props) {
  return (
    <textarea
      className={`w-full px-3 py-2 text-[13px] bg-bg-secondary text-text border border-border rounded-md transition-colors duration-200 placeholder:text-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-50 resize-y leading-relaxed ${className}`}
      {...rest}
    />
  );
}
