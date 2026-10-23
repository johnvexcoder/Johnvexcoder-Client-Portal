import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: { executablePath: process.env.PORTAL_CHROMIUM_PATH },
  },
  webServer: {
    command:
      "tsx scripts/prepare-local.ts && wrangler d1 migrations apply DB --local --config wrangler.e2e.jsonc --persist-to .wrangler/e2e && vite --mode e2e --host 127.0.0.1",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: "list",
});
