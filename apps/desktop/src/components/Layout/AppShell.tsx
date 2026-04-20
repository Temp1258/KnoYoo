import { Outlet } from "react-router";
import NavSidebar from "./NavSidebar";
import ChatDrawer from "../AI/ChatDrawer";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { useQuickSearchNavigation } from "../../hooks/useQuickSearchNavigation";

export default function AppShell() {
  useQuickSearchNavigation();
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Navigation Sidebar */}
      <NavSidebar />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      {/* AI Chat Drawer */}
      <ChatDrawer />
    </div>
  );
}
