import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router";
import AppShell from "./components/Layout/AppShell";

// Route-level code splitting: each page is lazy-loaded
const HomePage = lazy(() => import("./pages/HomePage"));
const MindMapPage = lazy(() => import("./MindMapPage"));
const GrowthPage = lazy(() => import("./pages/GrowthPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const TemplateGalleryPage = lazy(() => import("./pages/TemplateGalleryPage"));
const ClipsPage = lazy(() => import("./pages/ClipsPage"));

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-neutral-400">加载中...</div>
      }
    >
      {children}
    </Suspense>
  );
}

const router = createBrowserRouter([
  {
    path: "/onboarding",
    element: (
      <SuspenseWrapper>
        <OnboardingPage />
      </SuspenseWrapper>
    ),
  },
  {
    element: <AppShell />,
    children: [
      {
        index: true,
        element: (
          <SuspenseWrapper>
            <HomePage />
          </SuspenseWrapper>
        ),
      },
      {
        path: "mindmap",
        element: (
          <SuspenseWrapper>
            <MindMapPage />
          </SuspenseWrapper>
        ),
      },
      {
        path: "growth",
        element: (
          <SuspenseWrapper>
            <GrowthPage />
          </SuspenseWrapper>
        ),
      },
      {
        path: "templates",
        element: (
          <SuspenseWrapper>
            <TemplateGalleryPage />
          </SuspenseWrapper>
        ),
      },
      {
        path: "clips",
        element: (
          <SuspenseWrapper>
            <ClipsPage />
          </SuspenseWrapper>
        ),
      },
    ],
  },
]);

export default router;
