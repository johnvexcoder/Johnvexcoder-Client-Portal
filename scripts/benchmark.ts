import { hashPassword, verifyPassword } from "better-auth/crypto";
import { randomBytes } from "node:crypto";
const password = randomBytes(24).toString("hex");
const start = performance.now();
const hash = await hashPassword(password);
const hashed = performance.now();
if (!(await verifyPassword({ hash, password })))
  throw new Error("Hash verification failed.");
console.log(
  JSON.stringify(
    {
      runtime: "Node local, not Workers CPU",
      hashWallMs: Math.round(hashed - start),
      verifyWallMs: Math.round(performance.now() - hashed),
      freeCpuCompatibility: "UNVERIFIED",
      parameters: "Better Auth defaults; unchanged",
    },
    null,
    2,
  ),
);
