import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    cloudflare(
      mode === "e2e"
        ? {
            configPath: "wrangler.e2e.jsonc",
            persistState: { path: ".wrangler/e2e" },
          }
        : process.env.PORTAL_DEPLOY_CONFIG
          ? { configPath: process.env.PORTAL_DEPLOY_CONFIG }
          : {},
    ),
  ],
  server: { port: mode === "e2e" ? 5174 : 5173, strictPort: true },
}));
