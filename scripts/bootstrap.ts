import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { createAuth } from "../src/features/auth/auth";
import { localPlatform } from "./local";
import { user, session, auditEvents } from "../src/db/schema";
import { seedCatalog } from "../src/db/seed";
let vars = "";
try {
  vars = await readFile(".dev.vars", "utf8");
} catch {
  /* First local run. */
}
if (!/^BETTER_AUTH_SECRET=.+/m.test(vars)) {
  await writeFile(
    ".dev.vars",
    vars + `\nBETTER_AUTH_SECRET=${randomBytes(48).toString("hex")}\n`,
    { mode: 0o600 },
  );
}
const { proxy, env } = await localPlatform();
try {
  const db = drizzle(env.DB);
  if (await db.select().from(user).where(eq(user.role, "admin")).get())
    throw new Error("An owner already exists. Bootstrap cannot be run twice.");
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const prompt = createInterface({
    input: process.stdin,
    output,
    terminal: !!process.stdin.isTTY,
  });
  const email = (
    await prompt.question("Local owner email (synthetic .test only): ")
  )
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.test$/.test(email))
    throw new Error("Use a synthetic .test email for this development build.");
  process.stdout.write("Owner password (16+ characters, hidden): ");
  muted = true;
  const password = await prompt.question("");
  muted = false;
  process.stdout.write("\n");
  prompt.close();
  if (password.length < 16) throw new Error("Use at least 16 characters.");
  const created = await createAuth(env, true).api.signUpEmail({
    body: { email, password, name: "Portal owner" },
  });
  await db
    .update(user)
    .set({ role: "admin" })
    .where(eq(user.id, created.user.id));
  await db.delete(session).where(eq(session.userId, created.user.id));
  await seedCatalog(env.DB);
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    actorId: created.user.id,
    action: "owner.bootstrapped",
    targetId: created.user.id,
    createdAt: new Date(),
  });
  console.log(
    "Local owner created. Sign in, then enroll and verify your authenticator before provisioning test clients.",
  );
} finally {
  await proxy.dispose();
}
