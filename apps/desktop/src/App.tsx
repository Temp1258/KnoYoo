import { RouterProvider } from "react-router";
import { ToastProvider } from "./components/common/Toast";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import router from "./router";

export default function App() {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </ToastProvider>
  );
}
