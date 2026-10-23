import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, ne, desc, or, like, sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";
import { createAuth } from "../features/auth/auth";
import * as s from "../db/schema";
import {
  isIdleExpired,
  localOnly,
  randomCredential,
  sha256,
} from "../lib/security";
import { type PackageConfig } from "../features/packages/catalog";
import {
  completion,
  sectionSchema,
  validateFields,
  type FieldAnswer,
} from "../features/questionnaire/schema";
import {
  admin,
  recentAdmin,
  projectContext,
  type Actor,
  type AppEnv,
} from "./context";
import { registerAccountRoutes, registerPublicRecovery } from "./accounts";
import { validateProjectContent } from "../features/questionnaire/content-model";
import { registerManagementRoutes, registerPublicPolicies } from "./management";
import { registerWorkflowRoutes } from "./workflows";
import { guardedBatch } from "./transactions";
import { registerCareRoutes } from "./care";
const app = new Hono<AppEnv>();
app.use(
  "*",
  secureHeaders({
    referrerPolicy: "no-referrer",
    xFrameOptions: "DENY",
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
  }),
);
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!localOnly(c.req.url, c.env.APP_ENV))
    return c.json(
      {
        error:
          "This development build is local only. Free-runtime authentication validation is pending.",
      },
      503,
    );
  await next();
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => c.json({ error: "This request is too large." }, 413),
  }),
);
app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (
      origin !== new URL(c.env.BETTER_AUTH_URL).origin &&
      !(
        localOnly(c.req.url, c.env.APP_ENV) &&
        origin === new URL(c.req.url).origin &&
        new URL(c.req.url).port === new URL(c.env.BETTER_AUTH_URL).port
      )
    )
      return c.json(
        { error: "This action must originate from the portal." },
        403,
      );
  }
  await next();
});
app.get("/api/status", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({
    database: "connected",
    environment: "local",
    authenticationConfigured: !!c.env.BETTER_AUTH_SECRET,
    productionReady: false,
  });
});
registerPublicRecovery(app);
registerPublicPolicies(app);
const authPaths = new Set([
  "sign-in/email",
  "sign-out",
  "get-session",
  "change-password",
  "two-factor/enable",
  "two-factor/verify-totp",
  "two-factor/verify-backup-code",
]);
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const path = c.req.path.replace("/api/auth/", "");
  if (!authPaths.has(path))
    throw new HTTPException(404, { message: "Not found." });
  const auth = createAuth(c.env);
  if (["get-session", "change-password", "two-factor/enable"].includes(path))
    await identify(c);
  const before =
    path === "two-factor/verify-totp"
      ? await auth.api.getSession({ headers: c.req.raw.headers })
      : null;
  if (before) await identify(c);
  const attempt: unknown =
    path === "sign-in/email"
      ? await c.req.raw
          .clone()
          .json()
          .catch(() => ({}))
      : null;
  const response = await auth.handler(c.req.raw);
  if (path === "sign-in/email" && response.status !== 429) {
    const email =
      attempt &&
      typeof attempt === "object" &&
      "email" in attempt &&
      typeof attempt.email === "string"
        ? attempt.email.toLowerCase().slice(0, 254)
        : "";
    const user = await drizzle(c.env.DB)
      .select({ id: s.user.id })
      .from(s.user)
      .where(eq(s.user.email, email))
      .get();
    await drizzle(c.env.DB)
      .insert(s.auditEvents)
      .values({
        id: crypto.randomUUID(),
        actorId: response.ok ? (user?.id ?? null) : null,
        action: response.ok
          ? "auth.password_step_accepted"
          : "auth.password_step_failed",
        targetId: await sha256(email),
        createdAt: new Date(),
      });
  }
  if (
    before &&
    !before.user.twoFactorEnabled &&
    response.ok &&
    path === "two-factor/verify-totp"
  ) {
    const cookies = new Map(
      (c.req.header("Cookie") ?? "")
        .split(";")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => {
          const index = v.indexOf("=");
          return [v.slice(0, index), v.slice(index + 1)];
        }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const i = pair.indexOf("=");
      cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const headers = new Headers(c.req.raw.headers);
    headers.set(
      "Cookie",
      Array.from(cookies, ([k, v]) => `${k}=${v}`).join("; "),
    );
    const verified = await auth.api.getSession({ headers });
    if (!verified?.user.twoFactorEnabled) {
      await drizzle(c.env.DB)
        .delete(s.session)
        .where(eq(s.session.userId, before.user.id));
      throw new HTTPException(401, {
        message: "Please sign in again to complete authenticator setup.",
      });
    }
    const db = drizzle(c.env.DB);
    await db
      .delete(s.session)
      .where(
        and(
          eq(s.session.userId, before.user.id),
          ne(s.session.id, verified.session.id),
        ),
      );
    await db.insert(s.auditEvents).values({
      id: crypto.randomUUID(),
      actorId: before.user.id,
      action: "owner.mfa_enrolled",
      targetId: before.user.id,
      createdAt: new Date(),
    });
  }
  return response;
});
async function identify(c: Context<AppEnv>): Promise<Actor> {
  const auth = createAuth(c.env);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result)
    throw new HTTPException(401, { message: "Please sign in to continue." });
  const db = drizzle(c.env.DB);
  const idle = await db
    .select()
    .from(s.idleSessions)
    .where(eq(s.idleSessions.sessionId, result.session.id))
    .get();
  const last = idle?.lastActivityAt ?? result.session.createdAt;
  if (isIdleExpired(last.getTime(), Date.now())) {
    await db.delete(s.session).where(eq(s.session.id, result.session.id));
    throw new HTTPException(401, {
      message:
        "Your session ended after 10 minutes of inactivity. Please sign in again.",
    });
  }
  if (!idle)
    await db
      .insert(s.idleSessions)
      .values({ sessionId: result.session.id, lastActivityAt: last })
      .onConflictDoNothing();
  let companyId: string | null = null;
  if (result.user.role !== "admin") {
    const member = await db
      .select({ companyId: s.companies.id })
      .from(s.memberships)
      .innerJoin(s.companies, eq(s.memberships.companyId, s.companies.id))
      .where(
        and(
          eq(s.memberships.userId, result.user.id),
          eq(s.memberships.status, "active"),
          eq(s.companies.status, "active"),
        ),
      )
      .get();
    if (!member)
      throw new HTTPException(403, {
        message: "This account is not active. Contact John.",
      });
    companyId = member.companyId;
  }
  const policy = await db
    .select()
    .from(s.accessPolicies)
    .where(eq(s.accessPolicies.userId, result.user.id))
    .get();
  return {
    mustRotate: policy?.mustRotate ?? false,
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    companyId,
    sessionId: result.session.id,
    twoFactorEnabled: !!result.user.twoFactorEnabled,
    lastActivityAt: last.getTime(),
    authenticatedAt: result.session.createdAt.getTime(),
  };
}
app.use("/api/*", async (c, next) => {
  const actor = await identify(c);
  c.set("actor", actor);
  if (
    actor.mustRotate &&
    !["/api/me", "/api/activity", "/api/account/rotate"].includes(c.req.path)
  )
    throw new HTTPException(403, {
      message: "Change your temporary credential before opening the workspace.",
    });
  if (!["GET", "HEAD"].includes(c.req.method)) {
    const now = Date.now();
    const limit = await c.env.DB.prepare(
      "INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN last_request < ? THEN 1 ELSE count + 1 END, last_request = CASE WHEN last_request < ? THEN ? ELSE last_request END RETURNING count",
    )
      .bind(
        `api:${actor.sessionId}`,
        `api:${actor.sessionId}`,
        now,
        now - 60000,
        now - 60000,
        now,
      )
      .first<{ count: number }>();
    if (!limit || limit.count > 60)
      throw new HTTPException(429, {
        message: "Too many changes. Wait a minute and retry.",
      });
  }
  await next();
});
registerAccountRoutes(app);
registerManagementRoutes(app);
registerWorkflowRoutes(app);
registerCareRoutes(app);
app.get("/api/me", (c) => c.json({ user: c.get("actor") }));
app.post("/api/activity", async (c) => {
  await drizzle(c.env.DB)
    .update(s.idleSessions)
    .set({ lastActivityAt: new Date() })
    .where(eq(s.idleSessions.sessionId, c.get("actor").sessionId));
  return c.json({ lastActivityAt: Date.now() });
});
app.get("/api/packages", async (c) => {
  admin(c);
  return c.json({
    packages: await drizzle(c.env.DB).select().from(s.packageVersions),
  });
});
app.get("/api/projects", async (c) => {
  const actor = c.get("actor");
  if (actor.role === "admin") admin(c);
  const db = drizzle(c.env.DB);
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
  const query = (c.req.query("q") ?? "").trim().slice(0, 120),
    status = c.req.query("status") ?? "",
    packageId = (c.req.query("package") ?? "").slice(0, 100);
  if (
    status &&
    !["draft", "pending_approval", "approved", "archived"].includes(status)
  )
    throw new HTTPException(400, { message: "Choose a valid project status." });
  const rows = await db
    .select({
      id: s.projects.id,
      title: s.projects.title,
      type: s.projects.type,
      status: s.projects.status,
      companyName: s.companies.name,
      companyEmail: s.companies.email,
      updatedAt: s.projects.updatedAt,
    })
    .from(s.projects)
    .innerJoin(s.companies, eq(s.projects.companyId, s.companies.id))
    .where(
      and(
        actor.role === "admin"
          ? undefined
          : eq(s.projects.companyId, actor.companyId!),
        query
          ? or(
              like(s.companies.name, "%" + query + "%"),
              like(s.projects.title, "%" + query + "%"),
            )
          : undefined,
        status
          ? eq(
              s.projects.status,
              status as "draft" | "pending_approval" | "approved" | "archived",
            )
          : undefined,
        packageId
          ? sql`EXISTS(SELECT 1 FROM project_package_assignments a WHERE a.project_id=${s.projects.id} AND json_extract(a.snapshot,'$.id')=${packageId})`
          : undefined,
      ),
    )
    .orderBy(desc(s.projects.updatedAt))
    .limit(25)
    .offset(offset);
  return c.json({
    projects: rows,
    nextOffset: rows.length === 25 ? offset + 25 : null,
  });
});
const provisionSchema = z
  .object({
    recoverInterruptedSetup: z.boolean().optional(),
    companyName: z.string().trim().min(2).max(120),
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    projectTitle: z.string().trim().min(2).max(120),
    packageVersionId: z.string().max(100),
    cmsVersionId: z.string().max(100).optional(),
    seoVersionId: z.string().max(100).optional(),
    careVersionId: z.string().max(100).optional(),
    scopeReference: z.string().trim().max(1000).optional(),
  })
  .strict();
app.post("/api/admin/companies", async (c) => {
  const actor = recentAdmin(c);
  const parsed = provisionSchema.safeParse(await c.req.json());
  if (!parsed.success)
    return c.json(
      { error: "Check the company name, email, project and package." },
      400,
    );
  const input = parsed.data;
  if (!input.email.endsWith(".test"))
    return c.json(
      {
        error:
          "This local development build accepts synthetic .test email addresses only.",
      },
      400,
    );
  const db = drizzle(c.env.DB);
  const base = await db
    .select()
    .from(s.packageVersions)
    .where(eq(s.packageVersions.id, input.packageVersionId))
    .get();
  if (!base) return c.json({ error: "Choose a saved package version." }, 400);
  const baseConfig = base.config as PackageConfig;
  if (!["website", "portfolio"].includes(baseConfig.category))
    return c.json({ error: "Choose a website or portfolio package." }, 400);
  const cms = input.cmsVersionId
    ? await db
        .select()
        .from(s.packageVersions)
        .where(eq(s.packageVersions.id, input.cmsVersionId))
        .get()
    : undefined;
  if (
    input.cmsVersionId &&
    (!cms || (cms.config as PackageConfig).category !== "cms")
  )
    return c.json({ error: "Choose a CMS package." }, 400);
  const optional = [];
  for (const [id, category] of [
    [input.seoVersionId, "seo"],
    [input.careVersionId, "care"],
  ] as const) {
    if (!id) continue;
    const selected = await db
      .select()
      .from(s.packageVersions)
      .where(eq(s.packageVersions.id, id))
      .get();
    if (!selected || (selected.config as PackageConfig).category !== category)
      throw new HTTPException(400, {
        message: "Choose a valid optional service package.",
      });
    optional.push(selected);
  }
  const existing = await db
    .select()
    .from(s.user)
    .where(eq(s.user.email, input.email))
    .get();
  if (existing) {
    const membership = await db
      .select()
      .from(s.memberships)
      .where(eq(s.memberships.userId, existing.id))
      .get();
    if (
      !input.recoverInterruptedSetup ||
      existing.role !== "client" ||
      membership ||
      Date.now() - existing.createdAt.getTime() < 3600000
    )
      return c.json(
        {
          error:
            "An account already exists for this email. Only an unused interrupted setup older than one hour can be recovered.",
        },
        409,
      );
  }
  const password = randomCredential();
  const created = existing
    ? { user: { id: existing.id } }
    : await createAuth(c.env, true).api.signUpEmail({
        body: { name: input.companyName, email: input.email, password },
      });
  const recoveredHash = existing ? await hashPassword(password) : null;
  const companyId = crypto.randomUUID(),
    projectId = crypto.randomUUID(),
    now = new Date();
  try {
    await db.batch([
      db.insert(s.companies).values({
        id: companyId,
        name: input.companyName,
        email: input.email,
        createdAt: now,
      }),
      ...(existing
        ? [
            db
              .insert(s.account)
              .values({
                id: crypto.randomUUID(),
                accountId: existing.id,
                providerId: "credential",
                userId: existing.id,
                password: recoveredHash,
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: [s.account.providerId, s.account.accountId],
                set: { password: recoveredHash, updatedAt: now },
              }),
          ]
        : []),
      db.insert(s.memberships).values({ userId: created.user.id, companyId }),
      db
        .insert(s.accessPolicies)
        .values({ userId: created.user.id, mustRotate: true, createdAt: now }),
      db.insert(s.projects).values({
        id: projectId,
        companyId,
        title: input.projectTitle,
        type: baseConfig.category === "portfolio" ? "portfolio" : "business",
        scopeReference: input.scopeReference ?? null,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s.projectControls).values({ projectId }),
      db.insert(s.assignments).values(
        [base, ...(cms ? [cms] : []), ...optional].map((v) => ({
          id: crypto.randomUUID(),
          projectId,
          packageVersionId: v.id,
          category: (v.config as PackageConfig).category,
          snapshot: v.config,
          assignedAt: now,
          reason: "Initial synthetic development assignment",
        })),
      ),
      db.insert(s.auditEvents).values({
        id: crypto.randomUUID(),
        actorId: actor.id,
        companyId,
        action: existing
          ? "company.provisioning_recovered"
          : "company.provisioned",
        targetId: projectId,
        createdAt: now,
      }),
    ]);
  } catch (error) {
    if (!existing)
      await db.delete(s.user).where(eq(s.user.id, created.user.id));
    throw error;
  }
  // Do not send Better Auth's internally created provisioning session to the browser.
  await db.delete(s.session).where(eq(s.session.userId, created.user.id));
  return c.json(
    {
      companyId,
      projectId,
      companyName: input.companyName,
      email: input.email,
      credential: password,
    },
    201,
  );
});
app.get("/api/projects/:id", async (c) => {
  const ctx = await projectContext(c, c.req.param("id"));
  const saved = await drizzle(c.env.DB)
    .select()
    .from(s.drafts)
    .where(eq(s.drafts.projectId, ctx.project.id));
  const answers = Object.fromEntries(
    saved.map((d) => [d.section, d.answers]),
  ) as Record<string, Record<string, FieldAnswer>>;
  return c.json({
    ...ctx,
    drafts: saved,
    completion: completion(ctx.sections, answers),
    approvalAvailable: true,
  });
});
app.put("/api/projects/:id/sections/:section", async (c) => {
  const ctx = await projectContext(c, c.req.param("id"));
  if (ctx.project.status !== "draft")
    return c.json({ error: "This version is read only." }, 409);
  const section = ctx.sections.find((s) => s.id === c.req.param("section"));
  if (!section)
    return c.json(
      { error: "This section is outside your assigned package." },
      403,
    );
  const parsed = sectionSchema.safeParse(await c.req.json());
  if (!parsed.success)
    return c.json({ error: "Check your answers and their statuses." }, 400);
  try {
    validateFields(section, parsed.data.fields, ctx.config);
    const current = await drizzle(c.env.DB)
      .select()
      .from(s.drafts)
      .where(eq(s.drafts.projectId, ctx.project.id));
    const all = Object.fromEntries(
      current.map((d) => [d.section, d.answers]),
    ) as Record<string, Record<string, FieldAnswer>>;
    all[section.id] = parsed.data.fields;
    validateProjectContent(all, ctx.config);
    const editable = ctx.control?.editableSections as string[] | null;
    if (
      ctx.control?.baselineVersion &&
      editable &&
      !editable.includes(section.id)
    )
      return c.json(
        {
          error:
            "Only sections reopened by an approved change request can be edited.",
        },
        403,
      );
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Invalid fields." },
      400,
    );
  }
  const { revision, fields } = parsed.data;
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  statements.push(
    revision === 0
      ? c.env.DB.prepare(
          "INSERT INTO questionnaire_drafts(project_id,section,template_version,answers,revision,updated_at) VALUES(?,?,'1.0.0',?,1,?)",
        ).bind(ctx.project.id, section.id, JSON.stringify(fields), now)
      : c.env.DB.prepare(
          "UPDATE questionnaire_drafts SET answers=?,revision=revision+1,updated_at=? WHERE project_id=? AND section=?",
        ).bind(JSON.stringify(fields), now, ctx.project.id, section.id),
  );
  statements.push(
    c.env.DB.prepare(
      "UPDATE project_controls SET revision=revision+1 WHERE project_id=?",
    ).bind(ctx.project.id),
    c.env.DB.prepare("UPDATE projects SET updated_at=? WHERE id=?").bind(
      now,
      ctx.project.id,
    ),
  );
  try {
    await guardedBatch(
      c.env.DB,
      "EXISTS(SELECT 1 FROM projects p JOIN project_controls pc ON pc.project_id=p.id WHERE p.id=? AND p.status='draft' AND pc.revision=?) AND COALESCE((SELECT revision FROM questionnaire_drafts WHERE project_id=? AND section=?),0)=?",
      [
        ctx.project.id,
        ctx.control?.revision ?? 1,
        ctx.project.id,
        section.id,
        revision,
      ],
      statements,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 409)
      return c.json(
        {
          error:
            "A newer project change was saved. Keep your text and reload the saved version before retrying.",
          conflict: true,
        },
        409,
      );
    throw error;
  }
  return c.json({ revision: revision + 1, savedAt: now });
});

app.notFound((c) => c.json({ error: "Not found." }, 404));
app.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return c.json(
      { error: error.issues[0]?.message ?? "Check your input." },
      400,
    );
  if (error instanceof SyntaxError)
    return c.json({ error: "Invalid request data." }, 400);
  return c.json(
    {
      error:
        "This request could not be completed. Check the local database and retry.",
    },
    503,
  );
});
export default app;
