import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "./context";
import { admin, recentAdmin, projectContext } from "./context";
import * as s from "../db/schema";
import {
  defaultSettings,
  settingsSchema,
  setupGaps,
  type Settings,
} from "../features/admin-settings";
import { safeExternalLink } from "../lib/security";
import type { PackageConfig } from "../features/packages/catalog";
import { guardedBatch, auditStatement } from "./transactions";
export async function settingsFor(db: D1Database) {
  const row = await drizzle(db)
    .select()
    .from(s.portalSettings)
    .where(eq(s.portalSettings.id, "portal"))
    .get();
  return {
    revision: row?.revision ?? 0,
    value: row
      ? { ...defaultSettings, ...(row.value as Settings) }
      : defaultSettings,
  };
}
export function registerPublicPolicies(app: Hono<AppEnv>) {
  app.get("/api/policies", async (c) => {
    const { value } = await settingsFor(c.env.DB),
      published = value.policiesPublished;
    return c.json({
      published,
      privacy: {
        text: published ? value.privacyNoticeText : "",
        version: published ? value.privacyNoticeVersion : "",
      },
      terms: {
        text: published ? value.portalTermsText : "",
        version: published ? value.portalTermsVersion : "",
      },
      supportEmail: published ? value.supportEmail : "",
    });
  });
}
export function registerManagementRoutes(app: Hono<AppEnv>) {
  app.get("/api/help", async (c) => {
    const { value } = await settingsFor(c.env.DB);
    const active = await c.env.DB.prepare(
      "SELECT MAX(i.last_activity_at) AS activity FROM idle_sessions i JOIN session s ON s.id=i.session_id JOIN user u ON u.id=s.user_id WHERE u.role='admin' AND u.two_factor_enabled=1 AND s.expires_at>?",
    )
      .bind(Date.now())
      .first<{ activity: number | null }>();
    return c.json({
      supportEmail: value.supportEmail,
      supportPhone: value.supportPhone,
      facebook: value.facebook,
      whatsapp: value.whatsapp,
      portfolio: value.portfolio,
      online:
        !value.appearOffline &&
        !!active?.activity &&
        Date.now() - active.activity < 300000,
    });
  });
  app.get("/api/admin/settings", async (c) => {
    admin(c);
    const settings = await settingsFor(c.env.DB);
    return c.json({ ...settings, gaps: setupGaps(settings.value) });
  });
  app.put("/api/admin/settings", async (c) => {
    const actor = recentAdmin(c);
    const { revision, value } = z
      .object({ revision: z.number().int().min(0), value: settingsSchema })
      .strict()
      .parse(await c.req.json());
    const current = await settingsFor(c.env.DB);
    if (current.revision !== revision)
      throw new HTTPException(409, {
        message: "Settings changed in another session.",
      });
    const statements: D1PreparedStatement[] = [];
    const now = Date.now();
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO portal_settings(id,revision,value,updated_at) VALUES('portal',?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=excluded.value,updated_at=excluded.updated_at",
      ).bind(revision + 1, JSON.stringify(value), now),
    );
    // Publishing a CMS cap creates an immutable future version, never changing old assignments.
    for (const [id, cap] of Object.entries(value.cmsCaps)) {
      if (cap === current.value.cmsCaps[id as keyof Settings["cmsCaps"]])
        continue;
      const versions = await drizzle(c.env.DB)
        .select()
        .from(s.packageVersions)
        .where(eq(s.packageVersions.definitionId, id))
        .orderBy(desc(s.packageVersions.version))
        .limit(1);
      const latest = versions[0];
      if (latest)
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO package_versions(id,definition_id,version,config,created_at) VALUES(?,?,?,?,?)",
          ).bind(
            `${id}:${latest.version + 1}`,
            id,
            latest.version + 1,
            JSON.stringify({
              ...(latest.config as PackageConfig),
              editableSections: cap,
            }),
            now,
          ),
        );
    }
    statements.push(
      auditStatement(c.env.DB, actor.id, null, "settings.versioned", "portal"),
    );
    await guardedBatch(
      c.env.DB,
      "COALESCE((SELECT revision FROM portal_settings WHERE id='portal'),0)=?",
      [revision],
      statements,
    );
    return c.json({ revision: revision + 1, value, gaps: setupGaps(value) });
  });
  app.get("/api/admin/summary", async (c) => {
    admin(c);
    const now = Date.now();
    const counts = await c.env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM companies WHERE status='active') AS active_companies,(SELECT COUNT(*) FROM projects WHERE status='draft') AS collecting,(SELECT COUNT(*) FROM projects WHERE status='pending_approval') AS submitted,(SELECT COUNT(*) FROM inbox_items WHERE visibility='shared' AND admin_read_at IS NULL) AS unread,(SELECT COUNT(*) FROM inbox_items WHERE status NOT IN('done','rejected') AND created_at<?) AS aging,(SELECT COUNT(*) FROM reset_requests WHERE status='new') AS recovery_requests",
    )
      .bind(now - 7 * 86400000)
      .first();
    const care = await c.env.DB.prepare(
      "SELECT p.id,p.title,c.name AS company,pc.launch_at FROM project_controls pc JOIN projects p ON p.id=pc.project_id JOIN companies c ON c.id=p.company_id WHERE pc.launch_at IS NOT NULL ORDER BY pc.launch_at LIMIT 100",
    ).all();
    return c.json({ counts, care: care.results });
  });
  app.get("/api/admin/companies/:id", async (c) => {
    admin(c);
    const db = drizzle(c.env.DB);
    const company = await db
      .select()
      .from(s.companies)
      .where(eq(s.companies.id, c.req.param("id")))
      .get();
    if (!company)
      throw new HTTPException(404, { message: "Company not found." });
    return c.json({
      company,
      memberships: await db
        .select({ userId: s.memberships.userId, status: s.memberships.status })
        .from(s.memberships)
        .where(eq(s.memberships.companyId, company.id)),
      projects: await db
        .select()
        .from(s.projects)
        .where(eq(s.projects.companyId, company.id))
        .limit(50),
    });
  });
  const manual = z
    .object({
      approved: z.literal(true),
      reference: z.string().trim().min(5).max(2000),
      maxPages: z.number().int().min(1).max(100),
      inquiry: z.boolean(),
      reservation: z.boolean(),
      booking: z.boolean(),
    })
    .strict();
  app.put("/api/admin/projects/:id/control", async (c) => {
    const actor = recentAdmin(c);
    const ctx = await projectContext(c, c.req.param("id"));
    const input = z
      .object({
        revision: z.number().int().min(1),
        manualScope: manual.nullable(),
        scopeReference: z.string().trim().min(1).max(1000),
        launchAt: z.string().datetime().nullable(),
        testUrl: z.string().max(2048),
        approverName: z.string().trim().max(200),
        approverEmail: z.union([z.literal(""), z.email()]),
        approverMethod: z.string().trim().max(2000),
        approverVerified: z.boolean(),
        requestId: z.string().max(100).optional(),
        reason: z.string().trim().min(5).max(2000).optional(),
      })
      .strict()
      .parse(await c.req.json());
    if (input.testUrl) safeExternalLink(input.testUrl);
    if (
      input.approverVerified &&
      (!input.approverName || !input.approverEmail || !input.approverMethod)
    )
      throw new HTTPException(400, {
        message:
          "Record the authorized approver and independent verification method.",
      });
    const scopeChanged =
      JSON.stringify(input.manualScope) !==
        JSON.stringify(ctx.control?.manualScope) ||
      input.scopeReference !== ctx.project.scopeReference;
    const amendments: D1PreparedStatement[] = [];
    if (ctx.control?.baselineVersion && scopeChanged) {
      const upgrade = input.requestId
        ? await drizzle(c.env.DB)
            .select()
            .from(s.inboxItems)
            .where(eq(s.inboxItems.id, input.requestId))
            .get()
        : null;
      if (
        ctx.project.status !== "draft" ||
        !upgrade ||
        upgrade.projectId !== ctx.project.id ||
        upgrade.kind !== "change" ||
        upgrade.classification !== "upgrade" ||
        upgrade.status !== "approved" ||
        upgrade.baselineVersion !== ctx.control.baselineVersion ||
        !input.reason
      )
        throw new HTTPException(409, {
          message:
            "Reopen an approved upgrade against this baseline and supply its request ID and scope amendment reason.",
        });
      amendments.push(
        c.env.DB.prepare(
          "INSERT INTO scope_amendments(id,project_id,previous,next,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?)",
        ).bind(
          crypto.randomUUID(),
          ctx.project.id,
          JSON.stringify({
            manualScope: ctx.control.manualScope,
            scopeReference: ctx.project.scopeReference,
          }),
          JSON.stringify({
            manualScope: input.manualScope,
            scopeReference: input.scopeReference,
          }),
          input.reason,
          actor.id,
          Date.now(),
        ),
      );
    }
    await guardedBatch(
      c.env.DB,
      "EXISTS(SELECT 1 FROM project_controls WHERE project_id=? AND revision=?)",
      [ctx.project.id, input.revision],
      [
        ...amendments,
        c.env.DB.prepare(
          "UPDATE projects SET scope_reference=?,updated_at=? WHERE id=?",
        ).bind(input.scopeReference, Date.now(), ctx.project.id),
        c.env.DB.prepare(
          "UPDATE project_controls SET revision=revision+1,manual_scope=?,launch_at=?,test_url=?,approver_name=?,approver_email=?,approver_method=?,approver_verified_at=? WHERE project_id=?",
        ).bind(
          input.manualScope ? JSON.stringify(input.manualScope) : null,
          input.launchAt ? Date.parse(input.launchAt) : null,
          input.testUrl || null,
          input.approverName || null,
          input.approverEmail || null,
          input.approverMethod || null,
          input.approverVerified ? Date.now() : null,
          ctx.project.id,
        ),
        auditStatement(
          c.env.DB,
          actor.id,
          ctx.project.companyId,
          "project.control_updated",
          ctx.project.id,
        ),
      ],
    );
    return c.json({ message: "Project controls saved." });
  });
  app.post("/api/admin/packages/:id/versions", async (c) => {
    const actor = recentAdmin(c);
    const db = drizzle(c.env.DB);
    const existing = await db
      .select()
      .from(s.packageVersions)
      .where(eq(s.packageVersions.definitionId, c.req.param("id")))
      .orderBy(desc(s.packageVersions.version))
      .limit(1);
    if (!existing[0])
      throw new HTTPException(404, { message: "Package not found." });
    const input = z
      .object({
        expectedVersion: z.number().int().min(1),
        pricePhp: z.number().int().min(0).max(100000000),
        editableSections: z.number().int().min(1).max(100).nullable(),
      })
      .strict()
      .parse(await c.req.json());
    const latest = existing[0],
      config = latest.config as PackageConfig;
    if (config.category !== "cms" && input.editableSections !== null)
      throw new HTTPException(400, {
        message: "Only CMS packages have editable-section limits.",
      });
    await guardedBatch(
      c.env.DB,
      "(SELECT MAX(version) FROM package_versions WHERE definition_id=?)=?",
      [latest.definitionId, input.expectedVersion],
      [
        c.env.DB.prepare(
          "INSERT INTO package_versions(id,definition_id,version,config,created_at) VALUES(?,?,?,?,?)",
        ).bind(
          `${latest.definitionId}:${latest.version + 1}`,
          latest.definitionId,
          latest.version + 1,
          JSON.stringify({
            ...config,
            pricePhp: input.pricePhp,
            ...(config.category === "cms"
              ? { editableSections: input.editableSections }
              : {}),
          }),
          Date.now(),
        ),
        auditStatement(
          c.env.DB,
          actor.id,
          null,
          "package.version_created",
          latest.definitionId,
        ),
      ],
    );
    return c.json({ version: latest.version + 1 }, 201);
  });
  app.post("/api/admin/projects/:id/packages", async (c) => {
    const actor = recentAdmin(c),
      ctx = await projectContext(c, c.req.param("id"));
    const body = z
      .object({
        revision: z.number().int().min(1),
        versionIds: z.array(z.string().max(120)).min(1).max(5),
        reason: z.string().trim().min(5).max(2000),
        requestId: z.string().optional(),
      })
      .strict()
      .parse(await c.req.json());
    if (ctx.project.status === "approved")
      throw new HTTPException(409, {
        message:
          "Approve and reopen a change or upgrade request before amending the signed scope.",
      });
    let upgradeSections: string[] = [];
    if (ctx.control?.baselineVersion) {
      const req = body.requestId
        ? await drizzle(c.env.DB)
            .select()
            .from(s.inboxItems)
            .where(eq(s.inboxItems.id, body.requestId))
            .get()
        : null;
      if (
        !req ||
        req.projectId !== ctx.project.id ||
        req.kind !== "change" ||
        req.classification !== "upgrade" ||
        req.status !== "approved" ||
        req.baselineVersion !== ctx.control.baselineVersion
      )
        throw new HTTPException(409, {
          message: "An approved upgrade request is required.",
        });
      upgradeSections = req.affectedSections as string[];
    }
    const selected = [];
    for (const id of body.versionIds) {
      const version = await drizzle(c.env.DB)
        .select()
        .from(s.packageVersions)
        .where(eq(s.packageVersions.id, id))
        .get();
      if (!version)
        throw new HTTPException(400, {
          message: "Choose existing package versions.",
        });
      selected.push(version);
    }
    const configs = selected.map((v) => v.config as PackageConfig),
      bases = configs.filter((p) =>
        ["website", "portfolio"].includes(p.category),
      );
    const categories = configs.map((p) =>
      ["website", "portfolio"].includes(p.category) ? "base" : p.category,
    );
    if (bases.length !== 1 || new Set(categories).size !== categories.length)
      throw new HTTPException(400, {
        message:
          "Choose exactly one website or portfolio package and at most one package in each optional category.",
      });
    if (
      (bases[0].category === "portfolio") !==
      (ctx.project.type === "portfolio")
    )
      throw new HTTPException(400, {
        message: "Project template cannot change after creation.",
      });
    const statements = [
      c.env.DB.prepare(
        "INSERT INTO scope_amendments(id,project_id,previous,next,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        ctx.project.id,
        JSON.stringify(ctx.assigned),
        JSON.stringify(selected),
        body.reason,
        actor.id,
        Date.now(),
      ),
      c.env.DB.prepare(
        "DELETE FROM project_package_assignments WHERE project_id=?",
      ).bind(ctx.project.id),
      ...selected.map((v) =>
        c.env.DB.prepare(
          "INSERT INTO project_package_assignments(id,project_id,package_version_id,category,snapshot,assigned_at,reason) VALUES(?,?,?,?,?,?,?)",
        ).bind(
          crypto.randomUUID(),
          ctx.project.id,
          v.id,
          (v.config as PackageConfig).category,
          JSON.stringify(v.config),
          Date.now(),
          body.reason,
        ),
      ),
      c.env.DB.prepare(
        "UPDATE project_controls SET revision=revision+1,editable_sections=? WHERE project_id=?",
      ).bind(
        ctx.control?.baselineVersion
          ? JSON.stringify([
              ...new Set([
                ...((ctx.control.editableSections as string[]) ?? []),
                ...upgradeSections,
              ]),
            ])
          : null,
        ctx.project.id,
      ),
      auditStatement(
        c.env.DB,
        actor.id,
        ctx.project.companyId,
        "project.packages_amended",
        ctx.project.id,
      ),
    ];
    await guardedBatch(
      c.env.DB,
      "EXISTS(SELECT 1 FROM project_controls WHERE project_id=? AND revision=?)",
      [ctx.project.id, body.revision],
      statements,
    );
    return c.json({
      message:
        "Package versions assigned. Existing approved baselines remain unchanged.",
    });
  });
}
