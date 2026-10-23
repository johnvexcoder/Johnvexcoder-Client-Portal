import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "./context";
import { admin, recentAdmin, projectContext } from "./context";
import * as s from "../db/schema";
import { settingsFor } from "./management";
import { setupGaps } from "../features/admin-settings";
import {
  canonical,
  randomCredential,
  safeExternalLink,
  sha256,
} from "../lib/security";
import {
  activeFields,
  reviewIssues,
  routePaths,
  validateProjectContent,
} from "../features/questionnaire/content-model";
import type { FieldAnswer } from "../features/questionnaire/schema";
import { validateFields, sectionNames } from "../features/questionnaire/schema";
import {
  agentExport,
  frozenSchema,
  type FrozenSubmission,
} from "../features/exports";
import { auditStatement, guardedBatch } from "./transactions";
async function draftState(c: Parameters<typeof projectContext>[0], id: string) {
  const ctx = await projectContext(c, id);
  const drafts = await drizzle(c.env.DB)
    .select()
    .from(s.drafts)
    .where(eq(s.drafts.projectId, id));
  const saved = Object.fromEntries(
    drafts.map((d) => [d.section, d.answers]),
  ) as Record<string, Record<string, FieldAnswer>>;
  // Only currently entitled, visible fields can enter review or a frozen export.
  const visible = Object.fromEntries(
    ctx.sections.map((section) => [
      section.id,
      Object.fromEntries(
        activeFields(section, saved[section.id] ?? {}).map((field) => [
          field.key,
          saved[section.id]?.[field.key] ?? { value: "", status: "skipped" },
        ]),
      ),
    ]),
  ) as typeof saved;
  const issues = reviewIssues(ctx.sections, visible);
  const hash = await sha256(
    canonical({ drafts, assigned: ctx.assigned, control: ctx.control }),
  );
  return { ...ctx, drafts, saved: visible, issues, hash };
}
function validateForSignoff(state: Awaited<ReturnType<typeof draftState>>) {
  try {
    validateProjectContent(state.saved, state.config);
    for (const section of state.sections)
      validateFields(section, state.saved[section.id] ?? {}, state.config);
    if (state.config.id === "bookingsuite" && !state.control?.manualScope)
      throw new Error("Approve the written custom booking scope first.");
  } catch (error) {
    throw new HTTPException(400, { message: (error as Error).message });
  }
}
async function visibleItem(
  c: Parameters<typeof projectContext>[0],
  id: string,
) {
  const item = await drizzle(c.env.DB)
    .select()
    .from(s.inboxItems)
    .where(eq(s.inboxItems.id, id))
    .get();
  if (!item)
    throw new HTTPException(404, { message: "Conversation not found." });
  await projectContext(c, item.projectId);
  if (item.visibility === "private" && c.get("actor").role !== "admin")
    throw new HTTPException(404, { message: "Conversation not found." });
  return item;
}
export function registerWorkflowRoutes(app: Hono<AppEnv>) {
  app.post("/api/projects/:id/sections/:section/lease", async (c) => {
    const ctx = await projectContext(c, c.req.param("id"));
    const section = c.req.param("section");
    if (!ctx.sections.some((s) => s.id === section))
      throw new HTTPException(403, { message: "Section outside scope." });
    const actor = c.get("actor"),
      now = Date.now();
    const result = await c.env.DB.prepare(
      "INSERT INTO section_leases(project_id,section,session_id,expires_at) VALUES(?,?,?,?) ON CONFLICT(project_id,section) DO UPDATE SET session_id=excluded.session_id,expires_at=excluded.expires_at WHERE section_leases.expires_at<=? OR section_leases.session_id=? RETURNING expires_at",
    )
      .bind(
        ctx.project.id,
        section,
        actor.sessionId,
        now + 75000,
        now,
        actor.sessionId,
      )
      .first();
    return c.json({
      held: !!result,
      expiresAt: result ? (result as { expires_at: number }).expires_at : null,
      anotherEditor: !result,
    });
  });
  app.delete("/api/projects/:id/sections/:section/lease", async (c) => {
    const ctx = await projectContext(c, c.req.param("id"));
    await c.env.DB.prepare(
      "DELETE FROM section_leases WHERE project_id=? AND section=? AND session_id=?",
    )
      .bind(ctx.project.id, c.req.param("section"), c.get("actor").sessionId)
      .run();
    return c.json({ released: true });
  });
  app.get("/api/projects/:id/review", async (c) => {
    const state = await draftState(c, c.req.param("id"));
    const settings = await settingsFor(c.env.DB);
    const snapshots = await drizzle(c.env.DB)
      .select({
        id: s.approvedSubmissions.id,
        version: s.approvedSubmissions.version,
        contentHash: s.approvedSubmissions.contentHash,
        createdAt: s.approvedSubmissions.createdAt,
      })
      .from(s.approvedSubmissions)
      .where(eq(s.approvedSubmissions.projectId, state.project.id))
      .orderBy(desc(s.approvedSubmissions.version))
      .limit(100);
    const cms = state.assigned.find((a) => a.category === "cms")?.snapshot as
      { editableSections?: number | null } | undefined;
    return c.json({
      ...state,
      snapshots,
      agreement: {
        text: settings.value.termsText,
        version: settings.value.termsVersion,
      },
      setupGaps: [
        ...setupGaps(settings.value),
        ...(cms && cms.editableSections == null
          ? ["CMS editable-section cap for this project"]
          : []),
        ...(!state.control?.approverVerifiedAt
          ? ["Independently verified authorized approver"]
          : []),
        ...(!state.project.scopeReference ? ["Contract/scope reference"] : []),
      ],
      routes: routePaths(state.saved),
    });
  });
  app.post("/api/projects/:id/submit", async (c) => {
    const actor = c.get("actor");
    if (actor.role !== "client")
      throw new HTTPException(403, {
        message: "The client submits their requirements for review.",
      });
    const state = await draftState(c, c.req.param("id"));
    const blockers = state.issues.filter((i) => i.kind === "missing" || i.hard);
    if (blockers.length)
      return c.json(
        {
          error: "Complete the required content before submitting.",
          issues: blockers,
        },
        400,
      );
    validateProjectContent(state.saved, state.config);
    for (const section of state.sections)
      validateFields(section, state.saved[section.id] ?? {}, state.config);
    await guardedBatch(
      c.env.DB,
      "EXISTS(SELECT 1 FROM projects p JOIN project_controls pc ON pc.project_id=p.id WHERE p.id=? AND p.status='draft' AND pc.revision=?)",
      [state.project.id, state.control!.revision],
      [
        c.env.DB.prepare(
          "UPDATE projects SET status='pending_approval',updated_at=? WHERE id=?",
        ).bind(Date.now(), state.project.id),
        auditStatement(
          c.env.DB,
          actor.id,
          state.project.companyId,
          "requirements.submitted",
          state.project.id,
        ),
      ],
    );
    return c.json({
      message: "Requirements sent for owner review. They are not yet approved.",
    });
  });
  app.post("/api/admin/projects/:id/return-to-draft", async (c) => {
    const actor = admin(c);
    const state = await draftState(c, c.req.param("id"));
    const input = z
      .object({ reason: z.string().trim().min(5).max(2000) })
      .strict()
      .parse(await c.req.json());
    if (state.project.status !== "pending_approval")
      throw new HTTPException(409, {
        message: "Only a pending review can return to draft.",
      });
    await guardedBatch(
      c.env.DB,
      "EXISTS(SELECT 1 FROM projects WHERE id=? AND status='pending_approval')",
      [state.project.id],
      [
        c.env.DB.prepare(
          "UPDATE projects SET status='draft',updated_at=? WHERE id=?",
        ).bind(Date.now(), state.project.id),
        c.env.DB.prepare(
          "UPDATE project_controls SET revision=revision+1 WHERE project_id=?",
        ).bind(state.project.id),
        c.env.DB.prepare(
          "UPDATE approval_challenges SET consumed_at=? WHERE project_id=? AND consumed_at IS NULL",
        ).bind(Date.now(), state.project.id),
        c.env.DB.prepare(
          "INSERT INTO inbox_items(id,project_id,kind,visibility,subject,body,status,created_by,created_at,updated_at) VALUES(?,?,'note','shared','Requirements returned for discussion',?,'new',?,?,?)",
        ).bind(
          crypto.randomUUID(),
          state.project.id,
          input.reason,
          actor.id,
          Date.now(),
          Date.now(),
        ),
        auditStatement(
          c.env.DB,
          actor.id,
          state.project.companyId,
          "requirements.returned_to_draft",
          state.project.id,
        ),
      ],
    );
    return c.json({ message: "Draft reopened for discussion." });
  });
  app.post("/api/admin/projects/:id/approval-challenge", async (c) => {
    const actor = recentAdmin(c),
      state = await draftState(c, c.req.param("id"));
    const { acceptedUnknowns } = z
      .object({ acceptedUnknowns: z.array(z.string().max(200)).max(100) })
      .strict()
      .parse(await c.req.json());
    const settings = await settingsFor(c.env.DB);
    const cms = state.assigned.find((a) => a.category === "cms")?.snapshot as
      { editableSections?: number | null } | undefined;
    if (
      setupGaps(settings.value).length ||
      !state.project.scopeReference ||
      !state.control?.approverVerifiedAt ||
      (cms && cms.editableSections == null)
    )
      throw new HTTPException(409, {
        message:
          "Complete owner setup, project scope, CMS cap and independently verified approver before signoff.",
      });
    if (state.project.status !== "pending_approval")
      throw new HTTPException(409, {
        message: "The client must submit this draft for review first.",
      });
    if (
      state.issues.some(
        (i) =>
          i.hard || i.kind === "missing" || !acceptedUnknowns.includes(i.key),
      )
    )
      throw new HTTPException(400, {
        message:
          "Resolve missing essentials and explicitly accept each unsure answer.",
      });
    if (
      acceptedUnknowns.some((key) => !state.issues.some((i) => i.key === key))
    )
      throw new HTTPException(400, { message: "Unknown acceptance item." });
    validateForSignoff(state);
    const token = randomCredential(),
      now = Date.now(),
      payloadHash = await sha256(
        canonical({
          draftHash: state.hash,
          acceptedUnknowns: acceptedUnknowns.slice().sort(),
        }),
      );
    await guardedBatch(
      c.env.DB,
      "EXISTS(SELECT 1 FROM project_controls WHERE project_id=? AND revision=?) AND COALESCE((SELECT revision FROM portal_settings WHERE id='portal'),0)=?",
      [state.project.id, state.control.revision, settings.revision],
      [
        c.env.DB.prepare(
          "UPDATE approval_challenges SET consumed_at=? WHERE project_id=? AND consumed_at IS NULL",
        ).bind(now, state.project.id),
        c.env.DB.prepare(
          "INSERT INTO approval_challenges(id,project_id,token_hash,draft_hash,control_revision,settings_revision,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)",
        ).bind(
          crypto.randomUUID(),
          state.project.id,
          await sha256(token),
          payloadHash,
          state.control.revision,
          settings.revision,
          now + 15 * 60000,
          now,
        ),
        auditStatement(
          c.env.DB,
          actor.id,
          state.project.companyId,
          "approval.challenge_issued",
          state.project.id,
        ),
      ],
    );
    return c.json({
      token,
      expiresAt: now + 15 * 60000,
      recipient: state.control.approverEmail,
      acceptedUnknowns,
      message:
        "Deliver this token once through the independently verified channel. It is not an email or a completed approval.",
    });
  });
  app.post("/api/projects/:id/approve", async (c) => {
    const actor = c.get("actor");
    if (actor.role !== "client")
      throw new HTTPException(403, {
        message:
          "An independently authorized client approver must complete signoff.",
      });
    const body = z
      .object({
        token: z.string().regex(/^[a-f0-9]{48}$/),
        name: z.string().trim().min(1).max(200),
        email: z.email(),
        termsVersion: z.string().max(100),
        agreementAccepted: z.literal(true),
        contentConfirmed: z.literal(true),
        acceptedUnknowns: z.array(z.string().max(200)).max(100),
      })
      .strict()
      .parse(await c.req.json());
    const state = await draftState(c, c.req.param("id")),
      settings = await settingsFor(c.env.DB),
      control = state.control!;
    if (state.project.status !== "pending_approval")
      throw new HTTPException(409, {
        message: "This version is not pending approval.",
      });
    if (
      setupGaps(settings.value).length ||
      body.termsVersion !== settings.value.termsVersion ||
      !control.approverVerifiedAt ||
      body.name !== control.approverName ||
      body.email.toLowerCase() !== control.approverEmail?.toLowerCase()
    )
      throw new HTTPException(400, {
        message:
          "Approval identity or agreement version does not match the verified review.",
      });
    const tokenHash = await sha256(body.token),
      challenge = await drizzle(c.env.DB)
        .select()
        .from(s.approvalChallenges)
        .where(
          and(
            eq(s.approvalChallenges.projectId, state.project.id),
            eq(s.approvalChallenges.tokenHash, tokenHash),
          ),
        )
        .get();
    const expectedHash = await sha256(
      canonical({
        draftHash: state.hash,
        acceptedUnknowns: body.acceptedUnknowns.slice().sort(),
      }),
    );
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt.getTime() <= Date.now() ||
      challenge.draftHash !== expectedHash ||
      challenge.settingsRevision !== settings.revision ||
      challenge.controlRevision !== control.revision
    )
      throw new HTTPException(400, {
        message:
          "This approval challenge is invalid, expired or refers to an older draft.",
      });
    if (
      state.issues.some(
        (i) =>
          i.hard ||
          i.kind === "missing" ||
          !body.acceptedUnknowns.includes(i.key),
      )
    )
      throw new HTTPException(400, {
        message: "Required content or accepted unknowns changed.",
      });
    validateForSignoff(state);
    const db = drizzle(c.env.DB);
    const company = await db
      .select()
      .from(s.companies)
      .where(eq(s.companies.id, state.project.companyId))
      .get();
    const now = new Date(),
      version = control.baselineVersion + 1,
      id = crypto.randomUUID();
    const snapshot: FrozenSubmission = {
      schemaVersion: "1.0.0",
      project: {
        id: state.project.id,
        companyId: state.project.companyId,
        title: state.project.title,
        type: state.project.type,
        scopeReference: state.project.scopeReference,
      },
      company: { name: company!.name, email: company!.email },
      version,
      submittedAt: now.toISOString(),
      timezone: "Asia/Manila",
      packages: state.assigned.map((a) => ({
        versionId: a.packageVersionId,
        category: a.category,
        config: a.snapshot,
      })),
      manualScope: control.manualScope,
      answers: state.saved,
      sections: state.sections,
      approver: {
        name: body.name,
        email: body.email,
        loginEmail: actor.email,
        verificationMethod: control.approverMethod!,
        verifiedBy: "platform_owner",
        verifiedAt: control.approverVerifiedAt!.toISOString(),
      },
      agreement: {
        text: settings.value.termsText,
        version: settings.value.termsVersion,
        verificationProtocol: settings.value.verificationProtocol,
      },
      acceptedUnknowns: state.issues.filter((i) =>
        body.acceptedUnknowns.includes(i.key),
      ),
    };
    frozenSchema.parse(snapshot);
    const contentHash = await sha256(canonical(snapshot));
    await guardedBatch(
      c.env.DB,
      "EXISTS(SELECT 1 FROM approval_challenges ac JOIN project_controls pc ON pc.project_id=ac.project_id JOIN projects p ON p.id=pc.project_id WHERE ac.id=? AND ac.consumed_at IS NULL AND ac.expires_at>? AND pc.revision=? AND pc.baseline_version=? AND p.status='pending_approval') AND (SELECT revision FROM portal_settings WHERE id='portal')=?",
      [
        challenge.id,
        now.getTime(),
        control.revision,
        control.baselineVersion,
        settings.revision,
      ],
      [
        c.env.DB.prepare(
          "INSERT INTO approved_submissions(id,project_id,version,snapshot,content_hash,created_at) VALUES(?,?,?,?,?,?)",
        ).bind(
          id,
          state.project.id,
          version,
          canonical(snapshot),
          contentHash,
          now.getTime(),
        ),
        c.env.DB.prepare(
          "UPDATE approval_challenges SET consumed_at=? WHERE id=?",
        ).bind(now.getTime(), challenge.id),
        c.env.DB.prepare(
          "UPDATE projects SET status='approved',updated_at=? WHERE id=?",
        ).bind(now.getTime(), state.project.id),
        c.env.DB.prepare(
          "UPDATE project_controls SET revision=revision+1,baseline_version=?,editable_sections=NULL WHERE project_id=?",
        ).bind(version, state.project.id),
        c.env.DB.prepare("DELETE FROM section_leases WHERE project_id=?").bind(
          state.project.id,
        ),
        auditStatement(
          c.env.DB,
          actor.id,
          state.project.companyId,
          "requirements.approved",
          id,
        ),
      ],
    );
    return c.json(
      {
        id,
        version,
        contentHash,
        message: "This requirements version is approved and immutable.",
      },
      201,
    );
  });
  app.get("/api/projects/:id/versions/:version", async (c) => {
    const ctx = await projectContext(c, c.req.param("id"));
    const row = await drizzle(c.env.DB)
      .select()
      .from(s.approvedSubmissions)
      .where(
        and(
          eq(s.approvedSubmissions.projectId, ctx.project.id),
          eq(s.approvedSubmissions.version, Number(c.req.param("version"))),
        ),
      )
      .get();
    if (!row)
      throw new HTTPException(404, { message: "Approved version not found." });
    return c.json({ snapshot: row.snapshot, contentHash: row.contentHash });
  });
  app.get("/api/admin/projects/:id/versions/:version/agent.json", async (c) => {
    admin(c);
    const ctx = await projectContext(c, c.req.param("id"));
    const row = await drizzle(c.env.DB)
      .select()
      .from(s.approvedSubmissions)
      .where(
        and(
          eq(s.approvedSubmissions.projectId, ctx.project.id),
          eq(s.approvedSubmissions.version, Number(c.req.param("version"))),
        ),
      )
      .get();
    if (!row)
      throw new HTTPException(404, { message: "Approved version not found." });
    c.header(
      "Content-Disposition",
      `attachment; filename="requirements-v${row.version}.json"`,
    );
    return c.body(
      canonical(agentExport(row.snapshot as FrozenSubmission, row.contentHash)),
      200,
      { "Content-Type": "application/json; charset=utf-8" },
    );
  });
  app.get("/api/projects/:id/inbox", async (c) => {
    const ctx = await projectContext(c, c.req.param("id")),
      actor = c.get("actor"),
      db = drizzle(c.env.DB);
    const items = await db
      .select()
      .from(s.inboxItems)
      .where(
        actor.role === "admin"
          ? eq(s.inboxItems.projectId, ctx.project.id)
          : and(
              eq(s.inboxItems.projectId, ctx.project.id),
              eq(s.inboxItems.visibility, "shared"),
            ),
      )
      .orderBy(desc(s.inboxItems.updatedAt))
      .limit(100);
    return c.json({ items });
  });
  app.post("/api/projects/:id/inbox", async (c) => {
    const ctx = await projectContext(c, c.req.param("id")),
      actor = c.get("actor");
    const body = z
      .object({
        kind: z.enum(["question", "change", "issue", "note"]),
        visibility: z.enum(["shared", "private"]),
        subject: z.string().trim().min(2).max(200),
        body: z.string().trim().min(1).max(12000),
        section: z.string().max(100).optional(),
        classification: z.enum(["correction", "change", "upgrade"]).optional(),
        affectedSections: z.array(z.string().max(100)).max(30).optional(),
      })
      .strict()
      .parse(await c.req.json());
    if (
      actor.role !== "admin" &&
      (body.visibility === "private" || body.kind === "note")
    )
      throw new HTTPException(403, {
        message: "Only the owner can create private notes.",
      });
    if (
      body.kind === "change" &&
      (!body.classification ||
        !body.affectedSections?.length ||
        body.affectedSections.some((id) =>
          body.classification === "upgrade"
            ? !sectionNames.includes(id as (typeof sectionNames)[number])
            : !ctx.sections.some((s) => s.id === id),
        ))
    )
      throw new HTTPException(400, {
        message: "Choose the affected sections and request classification.",
      });
    const id = crypto.randomUUID(),
      now = new Date();
    await drizzle(c.env.DB).batch([
      drizzle(c.env.DB)
        .insert(s.inboxItems)
        .values({
          id,
          projectId: ctx.project.id,
          ...body,
          section: body.section ?? null,
          affectedSections: body.affectedSections ?? null,
          baselineVersion: ctx.control?.baselineVersion ?? 0,
          createdBy: actor.id,
          adminReadAt: actor.role === "admin" ? now : null,
          clientReadAt: actor.role === "client" ? now : null,
          createdAt: now,
          updatedAt: now,
        }),
      drizzle(c.env.DB).insert(s.auditEvents).values({
        id: crypto.randomUUID(),
        actorId: actor.id,
        companyId: ctx.project.companyId,
        action: "inbox.created",
        targetId: id,
        createdAt: now,
      }),
    ]);
    return c.json({ id }, 201);
  });
  app.get("/api/inbox/:id", async (c) => {
    const item = await visibleItem(c, c.req.param("id"));
    const actor = c.get("actor"),
      db = drizzle(c.env.DB);
    await db
      .update(s.inboxItems)
      .set(
        actor.role === "admin"
          ? { adminReadAt: new Date() }
          : { clientReadAt: new Date() },
      )
      .where(eq(s.inboxItems.id, item.id));
    return c.json({
      item,
      replies: await db
        .select()
        .from(s.inboxReplies)
        .where(eq(s.inboxReplies.itemId, item.id))
        .orderBy(s.inboxReplies.createdAt)
        .limit(200),
    });
  });
  app.post("/api/inbox/:id/replies", async (c) => {
    const item = await visibleItem(c, c.req.param("id"));
    const body = z
        .object({ body: z.string().trim().min(1).max(12000) })
        .strict()
        .parse(await c.req.json()),
      actor = c.get("actor"),
      db = drizzle(c.env.DB),
      now = new Date();
    await db.batch([
      db.insert(s.inboxReplies).values({
        id: crypto.randomUUID(),
        itemId: item.id,
        authorId: actor.id,
        authorRole: actor.role,
        body: body.body,
        createdAt: now,
      }),
      db
        .update(s.inboxItems)
        .set({
          updatedAt: now,
          ...(actor.role === "admin"
            ? { clientReadAt: null, adminReadAt: now }
            : { adminReadAt: null, clientReadAt: now }),
        })
        .where(eq(s.inboxItems.id, item.id)),
    ]);
    return c.json({ message: "Reply saved." }, 201);
  });
  app.patch("/api/admin/inbox/:id", async (c) => {
    const actor = admin(c),
      item = await visibleItem(c, c.req.param("id"));
    const body = z
      .object({
        status: z.enum([
          "new",
          "in_progress",
          "quoted",
          "approved",
          "done",
          "rejected",
        ]),
        size: z.enum(["small", "medium", "large", "custom"]).nullable(),
        quotePhp: z.number().int().min(0).max(100000000).nullable(),
        shareNote: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    const transitions: Record<string, string[]> = {
      new: ["in_progress", "quoted", "approved", "done", "rejected"],
      in_progress: ["quoted", "approved", "done", "rejected"],
      quoted: ["approved", "rejected", "in_progress"],
      approved: ["in_progress", "done"],
      done: [],
      rejected: [],
    };
    if (
      body.status !== item.status &&
      !transitions[item.status]?.includes(body.status)
    )
      throw new HTTPException(409, {
        message: "This status transition is not allowed.",
      });
    if (item.kind === "change" && body.status === "done" && !item.approvedAt)
      throw new HTTPException(409, {
        message: "A change request must be approved before completion.",
      });
    const now = Date.now();
    await guardedBatch(
      c.env.DB,
      "EXISTS(SELECT 1 FROM inbox_items WHERE id=? AND status=? AND updated_at=?)",
      [item.id, item.status, item.updatedAt.getTime()],
      [
        c.env.DB.prepare(
          "UPDATE inbox_items SET status=?,size=?,quote_php=?,approved_at=?,visibility=?,updated_at=?,client_read_at=NULL WHERE id=?",
        ).bind(
          body.status,
          body.size,
          body.quotePhp,
          body.status === "approved"
            ? now
            : (item.approvedAt?.getTime() ?? null),
          body.shareNote ? "shared" : item.visibility,
          now,
          item.id,
        ),
        auditStatement(
          c.env.DB,
          actor.id,
          null,
          "inbox.status_" + body.status,
          item.id,
        ),
      ],
    );
    return c.json({
      message: "Request status saved. A quotation does not charge a payment.",
    });
  });
  app.post("/api/admin/inbox/:id/reopen", async (c) => {
    const actor = admin(c),
      item = await visibleItem(c, c.req.param("id"));
    const ctx = await projectContext(c, item.projectId);
    if (
      item.kind !== "change" ||
      item.status !== "approved" ||
      !item.approvedAt ||
      ctx.project.status !== "approved" ||
      item.baselineVersion !== ctx.control?.baselineVersion
    )
      throw new HTTPException(409, {
        message:
          "Only an approved request against the current approved baseline can reopen sections.",
      });
    const sections = item.affectedSections as string[];
    await guardedBatch(
      c.env.DB,
      "EXISTS(SELECT 1 FROM projects p JOIN project_controls pc ON pc.project_id=p.id WHERE p.id=? AND p.status='approved' AND pc.revision=?)",
      [ctx.project.id, ctx.control.revision],
      [
        c.env.DB.prepare(
          "UPDATE projects SET status='draft',updated_at=? WHERE id=?",
        ).bind(Date.now(), ctx.project.id),
        c.env.DB.prepare(
          "UPDATE project_controls SET revision=revision+1,editable_sections=? WHERE project_id=?",
        ).bind(JSON.stringify(sections), ctx.project.id),
        auditStatement(
          c.env.DB,
          actor.id,
          ctx.project.companyId,
          "requirements.sections_reopened",
          item.id,
        ),
      ],
    );
    return c.json({
      message:
        "Only the approved affected sections are editable. Earlier approved versions remain unchanged.",
    });
  });
  app.get("/api/projects/:id/checkup", async (c) => {
    const ctx = await projectContext(c, c.req.param("id"));
    const version = ctx.control?.baselineVersion ?? 0;
    const baseline = version
      ? await drizzle(c.env.DB)
          .select()
          .from(s.approvedSubmissions)
          .where(
            and(
              eq(s.approvedSubmissions.projectId, ctx.project.id),
              eq(s.approvedSubmissions.version, version),
            ),
          )
          .get()
      : null;
    return c.json({
      testUrl: ctx.control?.testUrl ?? null,
      version,
      baseline: baseline?.snapshot ?? null,
      reviews: await drizzle(c.env.DB)
        .select()
        .from(s.pageReviews)
        .where(
          and(
            eq(s.pageReviews.projectId, ctx.project.id),
            eq(s.pageReviews.version, version),
          ),
        ),
    });
  });
  app.put("/api/projects/:id/checkup", async (c) => {
    const ctx = await projectContext(c, c.req.param("id"));
    const body = z
      .object({
        version: z.number().int().positive(),
        path: z.string().max(1000),
        status: z.enum(["not_reviewed", "matches", "needs_correction"]),
        notes: z.string().max(6000),
        evidenceLinks: z.array(z.string().max(2048)).max(20),
      })
      .strict()
      .parse(await c.req.json());
    body.evidenceLinks.forEach(safeExternalLink);
    if (body.version !== ctx.control?.baselineVersion)
      throw new HTTPException(409, {
        message: "Choose the current approved baseline.",
      });
    const row = await drizzle(c.env.DB)
      .select()
      .from(s.approvedSubmissions)
      .where(
        and(
          eq(s.approvedSubmissions.projectId, ctx.project.id),
          eq(s.approvedSubmissions.version, body.version),
        ),
      )
      .get();
    if (
      !row ||
      !routePaths((row.snapshot as FrozenSubmission).answers).includes(
        body.path,
      )
    )
      throw new HTTPException(400, {
        message: "This route is outside the approved baseline.",
      });
    const now = Date.now(),
      statements: D1PreparedStatement[] = [
        c.env.DB.prepare(
          "INSERT INTO page_reviews(project_id,version,path,status,notes,evidence_links,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,version,path) DO UPDATE SET status=excluded.status,notes=excluded.notes,evidence_links=excluded.evidence_links,updated_at=excluded.updated_at",
        ).bind(
          ctx.project.id,
          body.version,
          body.path,
          body.status,
          body.notes,
          JSON.stringify(body.evidenceLinks),
          now,
        ),
      ];
    if (body.status === "needs_correction")
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO inbox_items(id,project_id,kind,visibility,subject,body,status,baseline_version,created_by,created_at,updated_at) VALUES(?,?,'issue','shared',?,?,'new',?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at,admin_read_at=NULL",
        ).bind(
          "checkup:" +
            (await sha256(
              ctx.project.id + ":" + body.version + ":" + body.path,
            )),
          ctx.project.id,
          "Website check: " + body.path,
          body.notes + "\n" + body.evidenceLinks.join("\n"),
          body.version,
          c.get("actor").id,
          now,
          now,
        ),
      );
    await guardedBatch(
      c.env.DB,
      "EXISTS(SELECT 1 FROM project_controls WHERE project_id=? AND baseline_version=? AND revision=?)",
      [ctx.project.id, body.version, ctx.control!.revision],
      statements,
    );
    return c.json({
      message: "Page review saved against the approved version.",
    });
  });
}
