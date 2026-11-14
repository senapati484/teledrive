import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    // CRITICAL: protocolRoot must be set so the polyfill's Buffer class is
    // a singleton across ALL chunks. Vite's chunk-splitting creates separate
    // module instances — GramJS's internal `instanceof Buffer` check then
    // fails on Windows WebView2 because it gets a Buffer from a different
    // polyfill instance than the one it bundled. Keeping all polyfill and
    // telegram modules in the same chunk fixes this.
    nodePolyfills({
      include: ["buffer", "events", "stream", "util", "crypto", "path", "os", "process"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      // Protocolimports: ensure the Buffer global shim is applied first,
      // before any module that imports it. This prevents the "dual Buffer"
      // problem on Windows WebView2.
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      buffer: path.resolve(import.meta.dirname, "node_modules/buffer"),
      "node:buffer": path.resolve(import.meta.dirname, "node_modules/buffer"),
    },
  },

  build: {
    rollupOptions: {
      output: {
          manualChunks(id: string) {
            // Bundle ALL CodeMirror + Lezer + Highlight.js packages into one vendor chunk.
            // This includes @codemirror/lang-* language packs and highlight.js which are
            // statically imported so they are resolved at build time and never need a
            // dynamic import() at runtime.
            // (Dynamic imports were the root cause of missing syntax highlighting
            // in the installed Tauri app — asset:// protocol + CSP 'script-src self'
            // blocks late chunk loading.)
            if (
              id.includes("node_modules/@codemirror") ||
              id.includes("node_modules/@lezer") ||
              id.includes("node_modules/highlight.js")
            ) {
              return "codemirror-vendor";
            }
          },
        },
      },
      // Raise the warning threshold since telegram MTProto client is ~1.5MB
      chunkSizeWarningLimit: 2500,
    },

    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react-router-dom",
        "zustand",
        "i18next",
        "react-i18next",
        "i18next-browser-languagedetector",
        "lucide-react",
        "sonner",
        "radix-ui",
        "next-themes",
        "telegram",
        "buffer",
        "fflate",
        "dompurify",
        "highlight.js",
        "marked",
        "qrcode",
        "@tauri-apps/api/core",
        "@tauri-apps/api/app",
        "@tauri-apps/api/event",
        "@tauri-apps/plugin-opener",
        "@tauri-apps/plugin-dialog",
        "@tauri-apps/plugin-fs",
        // CodeMirror core + all language packs (statically imported — must be pre-bundled)
        "@codemirror/view",
        "@codemirror/state",
        "@codemirror/commands",
        "@codemirror/language",
        "@codemirror/search",
        "@codemirror/autocomplete",
        "@codemirror/theme-one-dark",
        "@codemirror/lang-python",
        "@codemirror/lang-javascript",
        "@codemirror/lang-html",
        "@codemirror/lang-css",
        "@codemirror/lang-json",
        "@codemirror/lang-xml",
        "@codemirror/lang-rust",
        "@codemirror/lang-go",
        "@codemirror/lang-cpp",
        "@codemirror/lang-java",
        "@codemirror/lang-sql",
        "@codemirror/lang-markdown",
      ],
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || "localhost",
      hmr: host
        ? {
          protocol: "ws",
          host,
          port: 1421,
        }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
  }));
