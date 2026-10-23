import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "./context";
import { admin, projectContext } from "./context";
import type { PackageConfig } from "../features/packages/catalog";
import { careWindow, manilaMonth } from "../features/care";
import { guardedBatch, auditStatement } from "./transactions";

export function registerCareRoutes(app: Hono<AppEnv>) {
  app.get("/api/projects/:id/care", async (c) => {
    const ctx = await projectContext(c, c.req.param("id"));
    const packages = ctx.assigned.map((a) => a.snapshot as PackageConfig);
    const included = packages.some((p) => p.careMonths === 12),
      paidTags = packages
        .filter((p) => p.category === "care" && p.careMonths !== 12)
        .map((p) => p.name);
    const launch = ctx.control?.launchAt?.getTime() ?? null,
      now = Date.now(),
      month = manilaMonth(now);
    const window = careWindow(launch, now, included);
    const usage = await c.env.DB.prepare(
      "SELECT COUNT(*) AS requests,COALESCE(SUM(minutes),0) AS minutes FROM care_requests WHERE project_id=? AND performed_at>=? AND performed_at<?",
    )
      .bind(
        ctx.project.id,
        Math.max(month.start, window.warrantyEnd ?? month.start),
        month.end,
      )
      .first<{ requests: number; minutes: number }>();
    const entries = await c.env.DB.prepare(
      "SELECT id,minutes,description,performed_at AS performedAt FROM care_requests WHERE project_id=? ORDER BY performed_at DESC LIMIT 100",
    )
      .bind(ctx.project.id)
      .all();
    return c.json({
      launchAt: ctx.control?.launchAt ?? null,
      included,
      paidTags,
      ...window,
      month: month.label,
      usage,
      limits: { requests: 2, minutes: 60 },
      entries: entries.results,
    });
  });
  app.post("/api/admin/projects/:id/care", async (c) => {
    const actor = admin(c),
      ctx = await projectContext(c, c.req.param("id"));
    const input = z
      .object({
        minutes: z.number().int().min(1).max(60),
        description: z.string().trim().min(3).max(2000),
        performedAt: z.iso.datetime(),
      })
      .strict()
      .parse(await c.req.json());
    const performed = Date.parse(input.performedAt),
      launch = ctx.control?.launchAt?.getTime() ?? null;
    const included = ctx.assigned.some(
      (a) => (a.snapshot as PackageConfig).careMonths === 12,
    );
    const window = careWindow(launch, performed, included),
      month = manilaMonth(performed);
    if (
      performed > Date.now() ||
      !["warranty", "active"].includes(window.status)
    )
      throw new HTTPException(409, {
        message:
          "Record work within the actual complimentary coverage period. Paid care tags do not establish agreed limits.",
      });
    const limited = window.status === "active",
      id = crypto.randomUUID();
    await guardedBatch(
      c.env.DB,
      "EXISTS(SELECT 1 FROM project_controls WHERE project_id=? AND revision=?) AND (?=0 OR ((SELECT COUNT(*) FROM care_requests WHERE project_id=? AND performed_at>=? AND performed_at<?)<2 AND (SELECT COALESCE(SUM(minutes),0) FROM care_requests WHERE project_id=? AND performed_at>=? AND performed_at<?)+?<=60))",
      [
        ctx.project.id,
        ctx.control!.revision,
        limited ? 1 : 0,
        ctx.project.id,
        Math.max(month.start, window.warrantyEnd!),
        month.end,
        ctx.project.id,
        Math.max(month.start, window.warrantyEnd!),
        month.end,
        input.minutes,
      ],
      [
        c.env.DB.prepare(
          "INSERT INTO care_requests(id,project_id,minutes,description,performed_at) VALUES(?,?,?,?,?)",
        ).bind(id, ctx.project.id, input.minutes, input.description, performed),
        auditStatement(
          c.env.DB,
          actor.id,
          ctx.project.companyId,
          "care.work_recorded",
          id,
        ),
      ],
    );
    return c.json(
      {
        message:
          "Care work recorded. Calendar-month allowances do not roll over.",
      },
      201,
    );
  });
}
