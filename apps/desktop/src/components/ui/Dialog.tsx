import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export default function Dialog({ open, onClose, title, children, actions }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="bg-bg-secondary rounded-xl shadow-lg border border-border w-full max-w-md mx-4 animate-in">
        {title && (
          <div className="px-5 pt-5 pb-0">
            <h3 className="text-[15px] font-semibold text-text m-0">{title}</h3>
          </div>
        )}
        <div className="px-5 py-4 text-[13px] text-text-secondary">{children}</div>
        {actions && <div className="px-5 pb-4 flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}
