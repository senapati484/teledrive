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
            // Split CodeMirror into its own large chunk (970KB+ raw) so it is only loaded when needed
            if (id.includes("node_modules/@codemirror") || id.includes("node_modules/@lezer")) {
              return "codemirror-vendor";
            }
          },
        },
      },
      // Raise the warning threshold since telegram MTProto client is ~1.5MB
      chunkSizeWarningLimit: 2500,
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || "127.0.0.1",
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
