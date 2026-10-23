import { readFileSync } from "node:fs";
const report = JSON.parse(
  readFileSync(new URL("../docs/release-status.json", import.meta.url), "utf8"),
);
console.log("Recorded release status: " + report.updated);
console.log("Local verification: " + report.localVerification);
const open = report.gates.filter((gate) => gate.status !== "verified");
for (const gate of open) console.log("- " + gate.name + ": " + gate.reason);
console.log(
  open.length
    ? "PRODUCTION RELEASE BLOCKED. This command does not deploy or change the runtime gate."
    : "Recorded gates verified. Rerun all checks and obtain deployment authorization; this command does not deploy.",
);
process.exitCode = open.length ? 1 : 0;
