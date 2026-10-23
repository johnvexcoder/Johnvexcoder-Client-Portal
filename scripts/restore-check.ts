import { mkdtemp, readdir, chmod } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { canonical } from "../src/lib/security";
import { getPlatformProxy } from "wrangler";
import type { Env } from "../src/features/auth/auth";
const input = process.argv[2];
if (!input) throw new Error("Pass a local SQL backup inside backups/.");
const file = resolve(input);
if (!file.startsWith(resolve("backups") + "/") || !file.endsWith(".sql"))
  throw new Error(
    "Only SQL files inside this project’s backups folder are accepted.",
  );
await chmod(file, 0o600);
const directory = await mkdtemp(".wrangler/restore-check-");
const child = spawnSync(
  "node",
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    directory,
    "--file",
    file,
    "--json",
  ],
  { encoding: "utf8" },
);
if (child.status !== 0)
  throw new Error("The local SQL import failed; inspect the backup.");
const restored = await getPlatformProxy<Env>({
  configPath: "wrangler.jsonc",
  persist: { path: `${directory}/v3` },
});
const original = await getPlatformProxy<Env>({
  configPath: "wrangler.jsonc",
  persist: { path: ".wrangler/state/v3" },
});
try {
  const tableQuery =
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name";
  const sourceTables = (
    await original.env.DB.prepare(tableQuery).all<{ name: string }>()
  ).results;
  const restoredTables = (
    await restored.env.DB.prepare(tableQuery).all<{ name: string }>()
  ).results;
  if (canonical(sourceTables) !== canonical(restoredTables))
    throw new Error("Restored table inventory differs from source.");
  let totalRows = 0;
  for (const { name } of sourceTables) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
      throw new Error("Unexpected application table name.");
    const query = `SELECT * FROM "${name}"`;
    const source = (await original.env.DB.prepare(query).all()).results,
      restoredRows = (await restored.env.DB.prepare(query).all()).results;
    const digest = (rows: unknown[]) =>
      createHash("sha256")
        .update(rows.map(canonical).sort().join("\n"))
        .digest("hex");
    if (
      source.length !== restoredRows.length ||
      digest(source) !== digest(restoredRows)
    )
      throw new Error(
        "Restored records differ in " +
          name +
          ". Keep the source idle during backup verification.",
      );
    totalRows += source.length;
  }
  const sourceTriggers = await original.env.DB.prepare(
    "SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name",
  ).all();
  const restoredTriggers = await restored.env.DB.prepare(
    "SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name",
  ).all();
  if (canonical(sourceTriggers.results) !== canonical(restoredTriggers.results))
    throw new Error("Immutable record triggers were not restored.");
  const integrity = spawnSync(
    "python3",
    [
      "-c",
      "import pathlib,sqlite3,sys; files=[p for p in pathlib.Path(sys.argv[1]).rglob('*.sqlite') if p.name!='metadata.sqlite']; assert len(files)==1; c=sqlite3.connect('file:'+str(files[0])+'?mode=ro',uri=True); assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'; print('ok')",
      `${directory}/v3/d1`,
    ],
    { encoding: "utf8" },
  );
  if (integrity.status !== 0)
    throw new Error("The restored SQLite integrity check did not pass.");
  console.log(
    JSON.stringify(
      {
        backup: relative(process.cwd(), file),
        restoredDirectory: directory,
        verifiedTables: sourceTables.length,
        verifiedRows: totalRows,
        exactApplicationDataMatch: true,
        immutableTriggersMatch: true,
        sqliteIntegrity: "ok",
        fullAccountRecovery:
          "All saved auth rows match; interactive MFA recovery still requires rehearsal",
      },
      null,
      2,
    ),
  );
  const files = await readdir("backups");
  console.log(
    `Local backup files retained: ${files.length}. Rehearsal data retained for owner inspection.`,
  );
} finally {
  await restored.dispose();
  await original.dispose();
}
