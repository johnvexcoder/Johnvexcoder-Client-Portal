import { z } from "zod";
import { catalog } from "../features/packages/catalog";
export const deploymentInput = z
  .object({
    workerName: z.string().regex(/^[a-z][a-z0-9-]{2,50}$/),
    databaseId: z
      .uuid()
      .refine(
        (v) => !/^([01])\1{7}-/.test(v),
        "Use the actual Cloudflare database ID, not a local placeholder.",
      ),
    portalUrl: z.url().refine((v) => {
      const u = new URL(v);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        u.pathname === "/" &&
        !u.search &&
        !u.hash
      );
    }, "Use the HTTPS portal origin only."),
    ownerEmail: z.email().transform((v) => v.trim().toLowerCase()),
  })
  .strict();
export function deploymentConfig(input: z.infer<typeof deploymentInput>) {
  return {
    $schema: "node_modules/wrangler/config-schema.json",
    name: input.workerName,
    main: "src/worker/index.ts",
    compatibility_date: "2026-10-23",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    assets: {
      directory: "./dist/client",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"],
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: "johnvexcoder-client-portal",
        database_id: input.databaseId,
        migrations_dir: "src/db/migrations",
      },
    ],
    vars: {
      APP_ENV: "production",
      BETTER_AUTH_URL: new URL(input.portalUrl).origin,
    },
  };
}
const quote = (value: string | number) =>
  typeof value === "number"
    ? String(value)
    : "'" + value.replaceAll("'", "''") + "'";
/** Contains hashes and catalog data only; no plaintext password or application secret. */
export function bootstrapStatements(input: {
  ownerId: string;
  accountId: string;
  ownerEmail: string;
  passwordHash: string;
  createdAt: number;
}) {
  const now = quote(input.createdAt),
    owner = quote(input.ownerId),
    email = quote(input.ownerEmail),
    statements: string[] = [];
  for (const pkg of catalog) {
    statements.push(
      `INSERT INTO package_definitions(id,category,name,price_php,price_note) VALUES(${[pkg.id, pkg.category, pkg.name, pkg.pricePhp].map(quote).join(",")},${pkg.priceNote ? quote(pkg.priceNote) : "NULL"}) ON CONFLICT(id) DO NOTHING`,
    );
    statements.push(
      `INSERT INTO package_versions(id,definition_id,version,config,created_at) VALUES(${quote(pkg.id + ":1")},${quote(pkg.id)},1,${quote(JSON.stringify(pkg))},${now}) ON CONFLICT(id) DO NOTHING`,
    );
  }
  // Same-file retries cannot reset an existing credential or create a second owner.
  statements.push(
    `INSERT INTO user(id,name,email,email_verified,created_at,updated_at,role,two_factor_enabled) SELECT ${owner},'Portal owner',${email},0,${now},${now},'admin',0 WHERE NOT EXISTS(SELECT 1 FROM user WHERE role='admin') ON CONFLICT(id) DO NOTHING`,
  );
  statements.push(
    `INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) SELECT ${quote(input.accountId)},${owner},'credential',${owner},${quote(input.passwordHash)},${now},${now} WHERE EXISTS(SELECT 1 FROM user WHERE id=${owner} AND role='admin' AND email=${email}) ON CONFLICT(provider_id,account_id) DO NOTHING`,
  );
  statements.push(
    `INSERT INTO audit_events(id,actor_id,action,target_id,created_at) SELECT ${quote("bootstrap:" + input.ownerId)},${owner},'owner.offline_bootstrapped',${owner},${now} WHERE EXISTS(SELECT 1 FROM user WHERE id=${owner} AND role='admin' AND email=${email}) ON CONFLICT(id) DO NOTHING`,
  );
  return statements;
}
