import { useState, useCallback, createContext, useContext } from "react";

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
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span>{t.message}</span>
            <button
              className="toast-close"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
      {/* Confirm modal */}
      {confirmState && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>{confirmState.message}</p>
            <div className="confirm-actions">
              <button className="btn primary" onClick={() => handleConfirm(true)}>
                确认
              </button>
              <button className="btn" onClick={() => handleConfirm(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
