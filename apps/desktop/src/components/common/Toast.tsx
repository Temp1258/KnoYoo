import { useState, useCallback, createContext, useContext } from "react";
import { X } from "lucide-react";
import Button from "../ui/Button";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  showConfirm: (message: string) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  showConfirm: () => Promise.resolve(false),
});

export const useToast = () => useContext(ToastContext);

let nextId = 0;

const typeStyles: Record<ToastType, string> = {
  success: "border-success/30 bg-bg-secondary",
  error: "border-danger/30 bg-bg-secondary",
  info: "border-border bg-bg-secondary",
};

const dotStyles: Record<ToastType, string> = {
  success: "bg-success",
  error: "bg-danger",
  info: "bg-accent",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{
    message: string;
    resolve: (v: boolean) => void;
  } | null>(null);

  const showToast = useCallback((message: string, type: ToastType = "success") => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    const duration = type === "error" ? 5000 : 3000;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const showConfirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ message, resolve });
    });
  }, []);

  const handleConfirm = (result: boolean) => {
    confirmState?.resolve(result);
    setConfirmState(null);
  };

  return (
    <ToastContext.Provider value={{ showToast, showConfirm }}>
      {children}

      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-lg border shadow-md text-[13px] text-text min-w-[240px] max-w-[360px] ${typeStyles[t.type]}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotStyles[t.type]}`} />
            <span className="flex-1">{t.message}</span>
            <button
              className="shrink-0 text-text-tertiary hover:text-text transition-colors cursor-pointer"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Confirm dialog */}
      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-bg-secondary rounded-xl shadow-lg border border-border w-full max-w-sm mx-4 p-5">
            <p className="text-[14px] text-text m-0 mb-4 whitespace-pre-wrap">
              {confirmState.message}
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => handleConfirm(false)}>取消</Button>
              <Button variant="primary" onClick={() => handleConfirm(true)}>
                确认
              </Button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
