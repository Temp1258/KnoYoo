import { Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import AppShell from "./components/Layout/AppShell";
import ClipsPage from "./pages/ClipsPage";
import HomePage from "./pages/HomePage";
import { SkeletonCard } from "./components/ui/Skeleton";
import {
  DiscoverPage,
  SettingsPage,
  TrashPage,
  BooksPage,
  MediaPage,
  AchievementsPage,
} from "./lazyPages";

const fallback = (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    {Array.from({ length: 6 }, (_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);

// HomePage and ClipsPage import eagerly — they're the main entry surfaces,
// not worth the code-split dance. The rest lazy-load so a first launch
// that opens straight onto the Home route only pulls the bundles it needs.
export default createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "clips", element: <ClipsPage /> },
      {
        path: "books",
        element: (
          <Suspense fallback={fallback}>
            <BooksPage />
          </Suspense>
        ),
      },
      {
        path: "media",
        element: (
          <Suspense fallback={fallback}>
            <MediaPage />
          </Suspense>
        ),
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
        path: "achievements",
        element: (
          <Suspense fallback={fallback}>
            <AchievementsPage />
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
      // Catch-all: old routes (e.g. the retired /collections) or typos fall
      // back to the homepage rather than rendering a blank screen.
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
