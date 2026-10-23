import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
process.umask(0o077);
await mkdir("backups", { recursive: true, mode: 0o700 });
const name = `backups/portal-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
const child = spawnSync(
  "node",
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "export",
    "DB",
    "--local",
    `--output=${name}`,
  ],
  { stdio: "inherit" },
);
process.exitCode = child.status ?? 1;
