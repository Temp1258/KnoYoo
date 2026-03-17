import { createBrowserRouter } from "react-router";
import AppShell from "./components/Layout/AppShell";
import HomePage from "./pages/HomePage";
import MindMapPage from "./MindMapPage";
import GrowthPage from "./pages/GrowthPage";
import OnboardingPage from "./pages/OnboardingPage";

const router = createBrowserRouter([
  {
    path: "/onboarding",
    element: <OnboardingPage />,
  },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "mindmap", element: <MindMapPage /> },
      { path: "growth", element: <GrowthPage /> },
    ],
  },
]);

export default router;
