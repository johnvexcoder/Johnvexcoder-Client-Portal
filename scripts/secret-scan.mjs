import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);
const blocked = files.filter((p) =>
  /(^|\/)(\.dev\.vars|\.env)$|\.(sqlite|db)$|^backups\//.test(p),
);
const suspicious = files
  .filter((p) => !p.includes("secret-scan"))
  .filter((p) => {
    const text = readFileSync(p, "utf8");
    return /(?:BETTER_AUTH_SECRET\s*=\s*[A-Za-z0-9+/]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16})/.test(
      text,
    );
  });
if (blocked.length || suspicious.length) {
  console.error("Potential secret files:", [...blocked, ...suspicious]);
  process.exitCode = 1;
} else
  console.log(
    `Scanned ${files.length} non-ignored project files; no known secret patterns found. This is a heuristic, not a security guarantee.`,
  );

if (existsSync(".dev.vars") && existsSync("dist/client")) {
  const values = readFileSync(".dev.vars", "utf8")
    .split("\n")
    .map((line) =>
      line.startsWith("BETTER_AUTH_SECRET=")
        ? line.slice(line.indexOf("=") + 1).trim()
        : "",
    )
    .filter(Boolean);
  const artifacts = readdirSync("dist/client", {
    recursive: true,
    withFileTypes: true,
  }).filter((entry) => entry.isFile());
  for (const entry of artifacts) {
    const path = `${entry.parentPath}/${entry.name}`;
    const content = readFileSync(path, "utf8");
    if (values.some((value) => content.includes(value))) {
      console.error(
        "A local secret appeared in a public build artifact:",
        path,
      );
      process.exitCode = 1;
    }
  }
  if (!process.exitCode)
    console.log(
      "Public browser build contains no configured application secret. Worker preview .dev.vars stays ignored and private.",
    );
}
