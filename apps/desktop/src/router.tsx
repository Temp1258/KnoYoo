import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router";
import AppShell from "./components/Layout/AppShell";

const ClipsPage = lazy(() => import("./pages/ClipsPage"));

const fallback = (
  <div className="flex h-full items-center justify-center text-neutral-400">加载中...</div>
);

export default createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={fallback}>
            <ClipsPage key="home" />
          </Suspense>
        ),
      },
      {
        path: "starred",
        element: (
          <Suspense fallback={fallback}>
            <ClipsPage key="starred" starredMode />
          </Suspense>
        ),
      },
    ],
  },
]);
