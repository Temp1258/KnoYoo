import { useState, useRef } from "react";

interface Props {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
}

export default function Tooltip({ content, children, side = "top" }: Props) {
  const [show, setShow] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const enter = () => {
    timeoutRef.current = setTimeout(() => setShow(true), 400);
  };

  const leave = () => {
    clearTimeout(timeoutRef.current);
    setShow(false);
  };

  const pos =
    side === "top"
      ? "bottom-full left-1/2 -translate-x-1/2 mb-1.5"
      : "top-full left-1/2 -translate-x-1/2 mt-1.5";

  return (
    <div className="relative inline-flex" onMouseEnter={enter} onMouseLeave={leave}>
      {children}
      {show && (
        <div
          className={`absolute ${pos} z-50 px-2 py-1 text-[11px] font-medium text-white bg-text rounded-md whitespace-nowrap pointer-events-none shadow-md`}
        >
          {content}
        </div>
      )}
    </div>
  );
}
