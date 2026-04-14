import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router";
import AppShell from "./components/Layout/AppShell";
import ClipsPage from "./pages/ClipsPage";
import { SkeletonCard } from "./components/ui/Skeleton";

const DiscoverPage = lazy(() => import("./pages/DiscoverPage"));
const CollectionsPage = lazy(() => import("./pages/CollectionsPage"));
const CollectionDetailPage = lazy(() => import("./pages/CollectionDetailPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const TrashPage = lazy(() => import("./pages/TrashPage"));

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
        element: <ClipsPage />,
      },
      {
        path: "discover",
        element: (
          <Suspense fallback={fallback}>
            <DiscoverPage />
          </Suspense>
        ),
      },
      {
        path: "collections",
        element: (
          <Suspense fallback={fallback}>
            <CollectionsPage />
          </Suspense>
        ),
      },
      {
        path: "collections/:id",
        element: (
          <Suspense fallback={fallback}>
            <CollectionDetailPage />
          </Suspense>
        ),
      },
      {
        path: "settings",
        element: (
          <Suspense fallback={fallback}>
            <SettingsPage />
          </Suspense>
        ),
      },
      {
        path: "trash",
        element: (
          <Suspense fallback={fallback}>
            <TrashPage />
          </Suspense>
        ),
      },
    ],
  },
]);
