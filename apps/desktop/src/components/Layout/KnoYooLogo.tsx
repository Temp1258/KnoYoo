type Props = {
  size?: number;
  className?: string;
};

// Inline SVG mark — colors are bound to theme CSS variables so the logo
// recolors automatically across all 9 themes (accent square + bg-colored
// interior shapes keep contrast on every palette).
export default function KnoYooLogo({ size = 40, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="KnoYoo"
    >
      <rect width="40" height="40" rx="9" fill="var(--color-accent)" />

      {/* Book body */}
      <rect x="8" y="10.5" width="14" height="19" rx="1.75" fill="var(--color-bg)" />
      {/* Text lines on the cover */}
      <line
        x1="11.5"
        y1="15.5"
        x2="18.5"
        y2="15.5"
        stroke="var(--color-accent)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="11.5"
        y1="18.5"
        x2="18.5"
        y2="18.5"
        stroke="var(--color-accent)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="11.5"
        y1="21.5"
        x2="16.5"
        y2="21.5"
        stroke="var(--color-accent)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      {/* Magnifying lens — overlaps bottom-right of the book */}
      <circle
        cx="24.5"
        cy="24.5"
        r="5.5"
        fill="var(--color-accent)"
        stroke="var(--color-bg)"
        strokeWidth="2.2"
      />
      {/* Handle */}
      <line
        x1="28.6"
        y1="28.6"
        x2="31.5"
        y2="31.5"
        stroke="var(--color-bg)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
