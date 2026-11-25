import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Proxy dev sang FastAPI gateway chạy local; base './' để build ra dist
// mở được từ đường dẫn con (FastAPI mount StaticFiles).
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/admin/api": "http://127.0.0.1:8000",
      "/upload": "http://127.0.0.1:8000",
      "/mcp": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
});
