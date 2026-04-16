import { useState, useCallback } from "react";
import { X } from "lucide-react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { ToastContext, type ToastAction, type ToastItem, type ToastType } from "./toast-context";

let nextId = 1;

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
  const [promptState, setPromptState] = useState<{
    message: string;
    value: string;
    resolve: (v: string | null) => void;
  } | null>(null);

  const showToast = useCallback(
    (message: string, type: ToastType = "success", action?: ToastAction) => {
      nextId = (nextId + 1) % Number.MAX_SAFE_INTEGER || 1;
      const id = nextId;
      setToasts((prev) => [...prev, { id, message, type, action }]);
      const duration = action ? 5000 : type === "error" ? 5000 : 3000;
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    },
    [],
  );

  const showConfirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ message, resolve });
    });
  }, []);

  const showPrompt = useCallback((message: string, defaultValue = ""): Promise<string | null> => {
    return new Promise((resolve) => {
      setPromptState({ message, value: defaultValue, resolve });
    });
  }, []);

  const handleConfirm = (result: boolean) => {
    confirmState?.resolve(result);
    setConfirmState(null);
  };

  const handlePromptSubmit = () => {
    promptState?.resolve(promptState.value);
    setPromptState(null);
  };

  const handlePromptCancel = () => {
    promptState?.resolve(null);
    setPromptState(null);
  };

  return (
    <ToastContext.Provider value={{ showToast, showConfirm, showPrompt }}>
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
            {t.action && (
              <button
                className="shrink-0 text-[12px] text-accent font-medium hover:underline cursor-pointer"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
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

      {/* Prompt dialog */}
      {promptState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-bg-secondary rounded-xl shadow-lg border border-border w-full max-w-sm mx-4 p-5">
            <p className="text-[14px] text-text m-0 mb-3 whitespace-pre-wrap">
              {promptState.message}
            </p>
            <Input
              value={promptState.value}
              onChange={(e) =>
                setPromptState((prev) => (prev ? { ...prev, value: e.target.value } : null))
              }
              onKeyDown={(e) => e.key === "Enter" && handlePromptSubmit()}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button onClick={handlePromptCancel}>取消</Button>
              <Button variant="primary" onClick={handlePromptSubmit}>
                确认
              </Button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
