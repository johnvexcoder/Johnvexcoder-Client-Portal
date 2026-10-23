import { localPlatform } from "./local";
import { maintenance } from "../src/lib/maintenance";
if (process.argv.slice(2).some((a) => a !== "--apply"))
  throw new Error(
    "Use no arguments for a dry run, or --apply for expired security-record cleanup.",
  );
const { proxy, env } = await localPlatform();
try {
  console.log(
    JSON.stringify(
      await maintenance(env.DB, process.argv.includes("--apply")),
      null,
      2,
    ),
  );
} finally {
  await proxy.dispose();
}
