import "./lib/telegram/buffer-shim";
import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";
import "./index.css";
import { initVault } from "./lib/secure/vault";
import { ErrorBoundary } from "./components/ErrorBoundary";

console.log("main.tsx: Loaded entrypoint script");

// Mount React immediately to prevent blank white screens
const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
  console.log("main.tsx: React root mounted immediately.");
} else {
  console.error("main.tsx: Root element not found in DOM!");
}

// Initialize vault in the background
console.log("main.tsx: Initializing vault in background...");
initVault()
  .then(() => {
    console.log("main.tsx: Vault initialized successfully in background.");
  })
  .catch((err) => {
    console.error("main.tsx: Vault initialization failed in background:", err);
  });

// In production, prevent the default browser context menu on empty window spaces
// while preserving native input interactions, text selection, and Radix menus.
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement | null;
    if (
      target?.closest("input, textarea, [contenteditable='true'], [data-radix-menu-content], [data-radix-context-menu-trigger]") ||
      (window.getSelection()?.toString().length ?? 0) > 0
    ) {
      return;
    }
    e.preventDefault();
  });
}

