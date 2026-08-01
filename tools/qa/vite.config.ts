// A standalone Vite root for visual QA. Separate from the app's own config so
// the product build is untouched; the aliases and the Tailwind pipeline are
// the app's, so the renderer draws exactly as it does in production.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..", "..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(repo, "client", "src"),
      "@shared": path.resolve(repo, "shared"),
      "@assets": path.resolve(repo, "attached_assets"),
    },
  },
  root: import.meta.dirname,
  server: {
    fs: { allow: [repo, path.resolve(repo, "..", "posy-ai-first-implementation-review")] },
    // The real Express app needs a database this sandbox does not have, so
    // /api is served by mockApi.mjs replaying recorded pipeline events.
    proxy: { "/api": { target: "http://localhost:5200", changeOrigin: true } },
  },
});
