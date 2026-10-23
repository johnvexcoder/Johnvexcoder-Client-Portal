import type { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./context";
import { admin, recentAdmin } from "./context";
import * as s from "../db/schema";
import { randomCredential, sha256 } from "../lib/security";
const credentialSchema = z.string().min(16).max(128);
export function registerPublicRecovery(app: Hono<AppEnv>) {
  app.post("/api/recovery/request", async (c) => {
    const body = z
      .object({ email: z.email().max(254) })
      .strict()
      .parse(await c.req.json());
    const now = Date.now();
    const key =
      "recovery:" +
      (await sha256(
        c.env.APP_ENV === "local"
          ? "loopback"
          : (c.req.header("CF-Connecting-IP") ?? "unresolved"),
      ));
    const limited = await c.env.DB.prepare(
      "INSERT INTO rate_limit(id,key,count,last_request) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_request < ? THEN 1 ELSE count+1 END,last_request=CASE WHEN last_request < ? THEN ? ELSE last_request END RETURNING count",
    )
      .bind(key, key, now, now - 3600000, now - 3600000, now)
      .first<{ count: number }>();
    if (!limited || limited.count > 5)
      throw new HTTPException(429, {
        message: "Please wait before requesting another recovery.",
      });
    const db = drizzle(c.env.DB);
    const member = await db
      .select({ userId: s.user.id, companyId: s.companies.id })
      .from(s.user)
      .innerJoin(s.memberships, eq(s.user.id, s.memberships.userId))
      .innerJoin(s.companies, eq(s.memberships.companyId, s.companies.id))
      .where(
        and(
          eq(s.user.email, body.email.toLowerCase()),
          eq(s.user.role, "client"),
          eq(s.companies.status, "active"),
          eq(s.memberships.status, "active"),
        ),
      )
      .get();
    if (member) {
      const exists = await db
        .select()
        .from(s.resetRequests)
        .where(
          and(
            eq(s.resetRequests.userId, member.userId),
            eq(s.resetRequests.status, "new"),
          ),
        )
        .get();
      if (!exists)
        await db.insert(s.resetRequests).values({
          id: crypto.randomUUID(),
          ...member,
          createdAt: new Date(),
        });
    }
    return c.json(
      {
        message:
          "If this is an active client account, John can review the request. Contact him through your agreed channel. No email has been sent.",
      },
      202,
    );
  });
  app.post("/api/recovery/complete", async (c) => {
    const nowLimit = Date.now(),
      rateKey =
        "recovery-complete:" +
        (await sha256(
          c.env.APP_ENV === "local"
            ? "loopback"
            : (c.req.header("CF-Connecting-IP") ?? "unresolved"),
        ));
    const limit = await c.env.DB.prepare(
      "INSERT INTO rate_limit(id,key,count,last_request) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_request<? THEN 1 ELSE count+1 END,last_request=CASE WHEN last_request<? THEN ? ELSE last_request END RETURNING count",
    )
      .bind(
        rateKey,
        rateKey,
        nowLimit,
        nowLimit - 60000,
        nowLimit - 60000,
        nowLimit,
      )
      .first<{ count: number }>();
    if (!limit || limit.count > 5)
      throw new HTTPException(429, {
        message: "Too many recovery attempts. Wait a minute and retry.",
      });
    const body = z
      .object({
        token: z.string().regex(/^[a-f0-9]{48}$/),
        password: credentialSchema,
      })
      .strict()
      .parse(await c.req.json());
    const hash = await sha256(body.token);
    const db = drizzle(c.env.DB);
    const token = await db
      .select()
      .from(s.credentialTokens)
      .where(eq(s.credentialTokens.tokenHash, hash))
      .get();
    if (!token || token.consumedAt || token.expiresAt.getTime() <= Date.now())
      throw new HTTPException(400, {
        message:
          "This recovery token is invalid or expired. Ask John for a new one.",
      });
    const member = await db
      .select()
      .from(s.memberships)
      .innerJoin(s.companies, eq(s.memberships.companyId, s.companies.id))
      .where(
        and(
          eq(s.memberships.userId, token.userId),
          eq(s.memberships.status, "active"),
          eq(s.companies.status, "active"),
        ),
      )
      .get();
    if (!member)
      throw new HTTPException(400, {
        message: "This recovery token is invalid or expired.",
      });
    const passwordHash = await hashPassword(body.password),
      claim = crypto.randomUUID(),
      now = Date.now();
    const active =
      "EXISTS(SELECT 1 FROM credential_tokens WHERE id=? AND claim_id=?)";
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE credential_tokens SET consumed_at=?,claim_id=? WHERE id=? AND consumed_at IS NULL AND expires_at>?",
      ).bind(now, claim, token.id, now),
      c.env.DB.prepare(
        `UPDATE account SET password=?,updated_at=? WHERE user_id=? AND provider_id='credential' AND ${active}`,
      ).bind(passwordHash, now, token.userId, token.id, claim),
      c.env.DB.prepare(
        `DELETE FROM session WHERE user_id=? AND ${active}`,
      ).bind(token.userId, token.id, claim),
      c.env.DB.prepare(
        `UPDATE access_policies SET must_rotate=0 WHERE user_id=? AND ${active}`,
      ).bind(token.userId, token.id, claim),
      c.env.DB.prepare(
        `UPDATE reset_requests SET status='completed',completed_at=? WHERE id=? AND ${active}`,
      ).bind(now, token.requestId, token.id, claim),
      c.env.DB.prepare(
        `UPDATE credential_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL AND ${active}`,
      ).bind(now, token.userId, token.id, claim),
      c.env.DB.prepare(
        `INSERT INTO audit_events(id,actor_id,company_id,action,target_id,created_at) SELECT ?,?,?, 'credential.reset_completed',?,? WHERE ${active}`,
      ).bind(
        crypto.randomUUID(),
        token.userId,
        member.companies.id,
        token.userId,
        now,
        token.id,
        claim,
      ),
    ]);
    if (result[0].meta.changes !== 1)
      throw new HTTPException(400, {
        message: "This recovery token has already been used.",
      });
    return c.json({
      message:
        "Credential changed. Previous sessions have been revoked. Sign in with your new credential.",
    });
  });
}
export function registerAccountRoutes(app: Hono<AppEnv>) {
  app.post("/api/account/rotate", async (c) => {
    const input = z
      .object({ currentPassword: credentialSchema, password: credentialSchema })
      .strict()
      .parse(await c.req.json());
    if (input.currentPassword === input.password)
      throw new HTTPException(400, { message: "Choose a new credential." });
    const actor = c.get("actor"),
      db = drizzle(c.env.DB);
    const account = await db
      .select()
      .from(s.account)
      .where(
        and(
          eq(s.account.userId, actor.id),
          eq(s.account.providerId, "credential"),
        ),
      )
      .get();
    if (
      !account?.password ||
      !(await verifyPassword({
        password: input.currentPassword,
        hash: account.password,
      }))
    )
      throw new HTTPException(400, {
        message: "The current credential is incorrect.",
      });
    const hashed = await hashPassword(input.password);
    const now = new Date();
    // Compare the old hash inside the write so concurrent rotations cannot both succeed.
    const changed = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE account SET password=?,updated_at=? WHERE id=? AND password=?",
      ).bind(hashed, now.getTime(), account.id, account.password),
      c.env.DB.prepare(
        "UPDATE access_policies SET must_rotate=0 WHERE user_id=? AND EXISTS(SELECT 1 FROM account WHERE id=? AND password=?)",
      ).bind(actor.id, account.id, hashed),
      c.env.DB.prepare(
        "DELETE FROM session WHERE user_id=? AND id<>? AND EXISTS(SELECT 1 FROM account WHERE id=? AND password=?)",
      ).bind(actor.id, actor.sessionId, account.id, hashed),
      c.env.DB.prepare(
        "INSERT INTO audit_events(id,actor_id,company_id,action,target_id,created_at) SELECT ?,?,?,'credential.rotated',?,? WHERE EXISTS(SELECT 1 FROM account WHERE id=? AND password=?)",
      ).bind(
        crypto.randomUUID(),
        actor.id,
        actor.companyId,
        actor.id,
        now.getTime(),
        account.id,
        hashed,
      ),
    ]);
    if (changed[0].meta.changes !== 1)
      throw new HTTPException(409, {
        message: "The credential changed in another session. Sign in again.",
      });
    return c.json({ message: "Credential updated." });
  });
  app.get("/api/admin/recovery", async (c) => {
    admin(c);
    const db = drizzle(c.env.DB);
    return c.json({
      requests: await db
        .select({
          id: s.resetRequests.id,
          companyId: s.companies.id,
          company: s.companies.name,
          email: s.companies.email,
          status: s.resetRequests.status,
          createdAt: s.resetRequests.createdAt,
        })
        .from(s.resetRequests)
        .innerJoin(s.companies, eq(s.resetRequests.companyId, s.companies.id))
        .orderBy(s.resetRequests.createdAt)
        .limit(100),
    });
  });
  app.post("/api/admin/recovery/:id/issue", async (c) => {
    const actor = recentAdmin(c);
    const db = drizzle(c.env.DB);
    const request = await db
      .select()
      .from(s.resetRequests)
      .where(eq(s.resetRequests.id, c.req.param("id")))
      .get();
    if (!request || !["new", "issued"].includes(request.status))
      throw new HTTPException(404, { message: "Recovery request not found." });
    const token = randomCredential(),
      now = new Date();
    await db.batch([
      db
        .update(s.credentialTokens)
        .set({ consumedAt: now })
        .where(eq(s.credentialTokens.userId, request.userId)),
      db.insert(s.credentialTokens).values({
        id: crypto.randomUUID(),
        userId: request.userId,
        requestId: request.id,
        tokenHash: await sha256(token),
        expiresAt: new Date(now.getTime() + 15 * 60_000),
        createdAt: now,
      }),
      db
        .update(s.resetRequests)
        .set({ status: "issued" })
        .where(eq(s.resetRequests.id, request.id)),
      db.insert(s.auditEvents).values({
        id: crypto.randomUUID(),
        actorId: actor.id,
        companyId: request.companyId,
        action: "credential.reset_issued",
        targetId: request.id,
        createdAt: now,
      }),
    ]);
    return c.json({
      token,
      expiresAt: now.getTime() + 15 * 60_000,
      message:
        "Reveal once. Share separately through the agreed verified channel. The portal sends no email.",
    });
  });
  app.post("/api/admin/companies/:id/access", async (c) => {
    const actor = recentAdmin(c),
      id = c.req.param("id");
    const body = z
      .object({
        action: z.enum(["suspend", "reactivate", "revoke_sessions", "archive"]),
      })
      .strict()
      .parse(await c.req.json());
    const db = drizzle(c.env.DB);
    const member = await db
      .select()
      .from(s.memberships)
      .where(eq(s.memberships.companyId, id))
      .get();
    if (!member)
      throw new HTTPException(404, { message: "Company not found." });
    const changes = [
      db.insert(s.auditEvents).values({
        id: crypto.randomUUID(),
        actorId: actor.id,
        companyId: id,
        action: "company." + body.action,
        targetId: id,
        createdAt: new Date(),
      }),
    ];
    await db.batch([
      changes[0],
      ...(body.action === "archive"
        ? [
            db
              .update(s.companies)
              .set({ status: "archived" })
              .where(eq(s.companies.id, id)),
          ]
        : body.action === "reactivate"
          ? [
              db
                .update(s.companies)
                .set({ status: "active" })
                .where(eq(s.companies.id, id)),
              db
                .update(s.memberships)
                .set({ status: "active" })
                .where(eq(s.memberships.companyId, id)),
            ]
          : body.action === "suspend"
            ? [
                db
                  .update(s.memberships)
                  .set({ status: "suspended" })
                  .where(eq(s.memberships.companyId, id)),
              ]
            : []),
      ...(body.action === "reactivate"
        ? []
        : [
            db.delete(s.session).where(eq(s.session.userId, member.userId)),
            db
              .update(s.credentialTokens)
              .set({ consumedAt: new Date() })
              .where(eq(s.credentialTokens.userId, member.userId)),
            db
              .update(s.approvalChallenges)
              .set({ consumedAt: new Date() })
              .where(
                sql`${s.approvalChallenges.projectId} IN (SELECT id FROM projects WHERE company_id=${id})`,
              ),
          ]),
    ]);
    return c.json({ message: "Company access updated." });
  });
  app.get("/api/admin/audit", async (c) => {
    admin(c);
    const offset = Math.max(0, Number(c.req.query("offset")) || 0);
    return c.json({
      events: await drizzle(c.env.DB)
        .select()
        .from(s.auditEvents)
        .orderBy(s.auditEvents.createdAt)
        .limit(100)
        .offset(offset),
    });
  });
}
