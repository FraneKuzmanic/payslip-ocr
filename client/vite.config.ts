import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The repository keeps a single .env at its root. Vite would otherwise look only in client/,
  // so every VITE_ variable would silently read as undefined.
  envDir: fileURLToPath(new URL("..", import.meta.url)),
  server: {
    // Same-origin /api in development, so CORS never fires locally.
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});
