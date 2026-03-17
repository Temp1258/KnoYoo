import type { HTMLAttributes } from "react";

interface Props extends HTMLAttributes<HTMLDivElement> {
  padding?: "sm" | "md" | "lg";
}

const paddings = {
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export default function Card({ padding = "md", className = "", children, ...rest }: Props) {
  return (
    <div
      className={`bg-bg-secondary rounded-lg border border-border shadow-xs ${paddings[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
