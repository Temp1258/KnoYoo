import { RouterProvider } from "react-router";
import { ToastProvider } from "./components/common/Toast";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import router from "./router";

// Console bridge for debugging
declare global {
  interface Window {
    __TAURI__?: Record<string, unknown>;
    tauriInvoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  }
}
import { invoke } from "@tauri-apps/api/core";
window.tauriInvoke = (cmd, args) => invoke(cmd, args);

export default function App() {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </ToastProvider>
  );
}
