import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const config = process.env.PORTAL_DEPLOY_CONFIG ?? "wrangler.production.jsonc";
if (!existsSync(config))
  throw new Error("Run npm run deployment:prepare first.");
const result = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build"],
  {
    stdio: "inherit",
    env: { ...process.env, PORTAL_DEPLOY_CONFIG: config },
  },
);
process.exitCode = result.status ?? 1;
