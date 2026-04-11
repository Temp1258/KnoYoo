import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router";
import AppShell from "./components/Layout/AppShell";
import { SkeletonCard } from "./components/ui/Skeleton";

const ClipsPage = lazy(() => import("./pages/ClipsPage"));

const fallback = (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    {Array.from({ length: 6 }, (_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
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
