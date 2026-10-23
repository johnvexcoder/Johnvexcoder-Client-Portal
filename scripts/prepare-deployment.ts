import { mkdir, writeFile, access, constants } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { hashPassword } from "better-auth/crypto";
import {
  deploymentInput,
  deploymentConfig,
  bootstrapStatements,
} from "../src/lib/deployment";
if (!process.stdin.isTTY)
  throw new Error(
    "Run this interactive helper yourself in a terminal. No remote action is performed.",
  );
for (const file of [
  "wrangler.production.jsonc",
  ".deployment/secrets.env",
  ".deployment/bootstrap.sql",
]) {
  try {
    await access(file, constants.F_OK);
    throw new Error(
      "Setup output already exists: " +
        file +
        ". Preserve it; this helper will not overwrite it.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
process.umask(0o077);
let muted = false;
const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  }),
  prompt = createInterface({ input: process.stdin, output, terminal: true });
try {
  console.log(
    "Offline Cloudflare preparation only. This does not clear release gates or deploy anything.",
  );
  const workerName =
    (
      await prompt.question("Worker name [johnvexcoder-client-portal]: ")
    ).trim() || "johnvexcoder-client-portal";
  const databaseId = (
    await prompt.question("Actual Cloudflare D1 database UUID: ")
  ).trim();
  const portalUrl = (
    await prompt.question(
      "Planned HTTPS portal URL (workers.dev or your domain): ",
    )
  ).trim();
  const ownerEmail = (await prompt.question("Owner login email: ")).trim();
  const input = deploymentInput.parse({
    workerName,
    databaseId,
    portalUrl,
    ownerEmail,
  });
  process.stdout.write("Owner password (16–128 characters; hidden): ");
  muted = true;
  const password = await prompt.question("");
  muted = false;
  process.stdout.write("\nConfirm owner password (hidden): ");
  muted = true;
  const confirmation = await prompt.question("");
  muted = false;
  process.stdout.write("\n");
  if (
    password.length < 16 ||
    password.length > 128 ||
    password !== confirmation
  )
    throw new Error(
      "Passwords must match and contain 16–128 characters. No files were generated.",
    );
  const hash = await hashPassword(password);
  const sql =
    bootstrapStatements({
      ownerId: randomUUID(),
      accountId: randomUUID(),
      ownerEmail: input.ownerEmail,
      passwordHash: hash,
      createdAt: Date.now(),
    }).join(";\n") + ";\n";
  await mkdir(".deployment", { recursive: true, mode: 0o700 });
  await writeFile(
    ".deployment/secrets.env",
    "BETTER_AUTH_SECRET=" + randomBytes(48).toString("hex") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(".deployment/bootstrap.sql", sql, {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(
    "wrangler.production.jsonc",
    JSON.stringify(deploymentConfig(input), null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Prepared wrangler.production.jsonc and private .deployment files. Do not share or commit .deployment. Production APIs remain gated pending release validation. Follow the deployment instructions in README.md.",
  );
} finally {
  muted = false;
  prompt.close();
}
