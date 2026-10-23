import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
let vars = "";
try {
  vars = await readFile(".dev.vars", "utf8");
} catch {
  /* First local run. */
}
if (!/^BETTER_AUTH_SECRET=.+/m.test(vars))
  await writeFile(
    ".dev.vars",
    vars + `\nBETTER_AUTH_SECRET=${randomBytes(48).toString("hex")}\n`,
    { mode: 0o600 },
  );
