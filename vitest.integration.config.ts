import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readFileSync, readdirSync } from "node:fs";
const migrations = readdirSync("src/db/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`src/db/migrations/${f}`, "utf8"));
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "wrangler.jsonc" },
      miniflare: {
        bindings: {
          BETTER_AUTH_SECRET:
            "integration-only-ephemeral-secret-not-a-production-key",
          MIGRATION_SQL: JSON.stringify(migrations),
          BETTER_AUTH_URL: "http://localhost:5173",
        },
      },
    }),
  ],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
