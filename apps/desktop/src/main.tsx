import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import QuickSearchApp from "./QuickSearchApp";
import "./styles/index.css";

// Two windows share the same webview bundle. Branch on window label so the
// overlay renders a stripped-down QuickSearchApp rather than the full shell.
// Label matches QUICK_SEARCH_WINDOW in src-tauri/src/main.rs.
const isQuickSearch = (() => {
  try {
    return getCurrentWindow().label === "quick-search";
  } catch {
    // Dev fallback (running bare Vite without Tauri context).
    return false;
  }
})();

// Tag <html> so index.css can strip the body background for the overlay
// window. Without this the theme's solid `--color-bg` covers the Tauri
// window's transparency and the rounded corners render behind a rectangle.
if (isQuickSearch) {
  document.documentElement.classList.add("window-quick-search");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isQuickSearch ? <QuickSearchApp /> : <App />}</React.StrictMode>,
);
