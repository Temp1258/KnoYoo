import { createContext, useContext } from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

export interface ToastContextValue {
  showToast: (message: string, type?: ToastType, action?: ToastAction) => void;
  showConfirm: (message: string) => Promise<boolean>;
  showPrompt: (message: string, defaultValue?: string) => Promise<string | null>;
}

export const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  showConfirm: () => Promise.resolve(false),
  showPrompt: () => Promise.resolve(null),
});

export const useToast = () => useContext(ToastContext);
