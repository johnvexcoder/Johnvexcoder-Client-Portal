import { bootstrapStatements } from "../../src/lib/deployment";
import { maintenance } from "../../src/lib/maintenance";
import { defaultSettings } from "../../src/features/admin-settings";
import { activeFields } from "../../src/features/questionnaire/content-model";
import {
  type SectionDefinition,
  type FieldDefinition,
  type FieldAnswer,
} from "../../src/features/questionnaire/schema";
import { canonical, sha256, randomCredential } from "../../src/lib/security";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import app from "../../src/worker";
import { createAuth, type Env } from "../../src/features/auth/auth";
import { seedCatalog } from "../../src/db/seed";
import * as s from "../../src/db/schema";
const bindings = env as unknown as Env & { MIGRATION_SQL: string };
const db = drizzle(bindings.DB);
const origin = "http://localhost:5173";
let previousOwnerCookie = "",
  ownerCredential = "",
  ownerBackupCode = "";
let ownerCookie = "",
  clientCookie = "",
  otherCookie = "",
  projectId = "",
  clientId = "";
const credentials = new Map<string, string>();
const password = () => crypto.randomUUID() + crypto.randomUUID();
function cookieFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "",
) {
  return app.request(
    origin + path,
    {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    bindings,
  );
}
async function makeUser(email: string) {
  const credential = password();
  const result = await createAuth(bindings, true).api.signUpEmail({
    body: { name: "DEMO Integration", email, password: credential },
  });
  return { id: result.user.id, credential };
}
async function login(email: string, credential: string) {
  const response = await request("/api/auth/sign-in/email", "POST", {
    email,
    password: credential,
  });
  expect(response.status).toBe(200);
  const cookie = cookieFrom(response);
  const me = await request("/api/me", "GET", undefined, cookie);
  if (me.ok) {
    const value = (await me.json()) as { user: { mustRotate: boolean } };
    if (value.user.mustRotate) {
      expect(
        (await request("/api/projects", "GET", undefined, cookie)).status,
      ).toBe(403);
      const rotated = password();
      expect(
        (
          await request(
            "/api/account/rotate",
            "POST",
            { currentPassword: credential, password: rotated },
            cookie,
          )
        ).status,
      ).toBe(200);
      credential = rotated;
    }
  }
  credentials.set(email, credential);
  return cookie;
}
beforeAll(async () => {
  for (const migration of JSON.parse(bindings.MIGRATION_SQL) as string[]) {
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((x) => x.trim())
      .filter(Boolean)) {
      await bindings.DB.prepare(statement).run();
    }
  }
  await seedCatalog(bindings.DB);
});
describe.sequential("local workerd and D1 security integration", () => {
  // Scenarios represent independent time windows; specific rate-limit tests stay within one window.
  beforeEach(async () => {
    await db.delete(s.rateLimit);
  });
  it("benchmarks unchanged Better Auth password hashing in workerd", async () => {
    const credential = password();
    const start = performance.now();
    const hash = await hashPassword(credential);
    const mid = performance.now();
    expect(await verifyPassword({ password: credential, hash })).toBe(true);
    console.info(
      JSON.stringify({
        runtime: "local workerd",
        hashWallMs: Math.round(mid - start),
        verifyWallMs: Math.round(performance.now() - mid),
        hostedFreeCpuVerified: false,
      }),
    );
  });
  it("creates a minimal real PDF as a runtime spike, not completed product export", async () => {
    const start = performance.now();
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("DEMO runtime feasibility only", {
      x: 40,
      y: 790,
      font,
      size: 14,
    });
    const bytes = await doc.save();
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toMatch("%PDF-1.7");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    console.info(
      JSON.stringify({
        pdfSpikeWallMs: Math.round(performance.now() - start),
        bytes: bytes.length,
        unicodeAndLayoutVerified: false,
        hostedFreeCpuVerified: false,
      }),
    );
  });
  it("blocks unauthenticated data access and public signup", async () => {
    expect((await request("/api/projects")).status).toBe(401);
    expect(
      (
        await request("/api/auth/sign-up/email", "POST", {
          name: "DEMO",
          email: "public@example.test",
          password: password(),
        })
      ).status,
    ).toBe(404);
  });
  it("builds an offline owner bootstrap that is repeatable and cannot replace another owner", async () => {
    const ownerId = crypto.randomUUID(),
      accountId = crypto.randomUUID(),
      credential = password(),
      hash = await hashPassword(credential);
    const input = {
      ownerId,
      accountId,
      ownerEmail: "offline-owner@example.test",
      passwordHash: hash,
      createdAt: Date.now(),
    };
    const statements = bootstrapStatements(input);
    for (const query of statements) await bindings.DB.prepare(query).run();
    for (const query of statements) await bindings.DB.prepare(query).run();
    const account = await db
      .select()
      .from(s.account)
      .where(eq(s.account.userId, ownerId))
      .get();
    expect(
      await verifyPassword({ password: credential, hash: account!.password! }),
    ).toBe(true);
    for (const query of bootstrapStatements({
      ...input,
      ownerId: crypto.randomUUID(),
      accountId: crypto.randomUUID(),
      ownerEmail: "other-offline@example.test",
    }))
      await bindings.DB.prepare(query).run();
    expect(
      (await db.select().from(s.user).where(eq(s.user.role, "admin"))).map(
        (v) => v.id,
      ),
    ).toEqual([ownerId]);
    expect(statements.join("\n")).not.toContain(credential);
    await db.delete(s.auditEvents).where(eq(s.auditEvents.actorId, ownerId));
    await db.delete(s.user).where(eq(s.user.id, ownerId));
  });
  it("creates local owner and requires MFA before client management", async () => {
    const owner = await makeUser("owner@portal.test");
    await db
      .update(s.user)
      .set({ role: "admin" })
      .where(eq(s.user.id, owner.id));
    ownerCookie = await login("owner@portal.test", owner.credential);
    expect(
      (await request("/api/projects", "GET", undefined, ownerCookie)).status,
    ).toBe(403);
  });
  it("enrolls TOTP through Better Auth and verifies before admin access", async () => {
    // Independently calculate a real RFC 6238 code for this synthetic test account.
    const ownerAccount = await db
      .select()
      .from(s.user)
      .where(eq(s.user.email, "owner@portal.test"))
      .get();
    expect(ownerAccount?.twoFactorEnabled).toBeFalsy();
    // Establish a fresh credential through the private provisioning fixture, without disabling MFA.
    const newPassword = password();
    ownerCredential = newPassword;
    await db
      .update(s.account)
      .set({ password: await hashPassword(newPassword) })
      .where(eq(s.account.userId, ownerAccount!.id));
    previousOwnerCookie = await login("owner@portal.test", newPassword);
    const response = await request(
      "/api/auth/two-factor/enable",
      "POST",
      { password: newPassword },
      ownerCookie,
    );
    expect(response.status).toBe(200);
    const setup = (await response.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(setup.backupCodes.length).toBeGreaterThan(0);
    ownerBackupCode = setup.backupCodes[0];
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const secret = new URL(setup.totpURI).searchParams.get("secret")!;
    let bits = "";
    for (const c of secret.replace(/=+$/, ""))
      bits += alphabet.indexOf(c.toUpperCase()).toString(2).padStart(5, "0");
    const raw = Uint8Array.from(
      bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const counter = new Uint8Array(8);
    new DataView(counter.buffer).setBigUint64(
      0,
      BigInt(Math.floor(Date.now() / 30000)),
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, counter),
    );
    const offset = digest[digest.length - 1] & 15;
    const code = String(
      ((digest[offset] & 127) * 2 ** 24 +
        (digest[offset + 1] << 16) +
        (digest[offset + 2] << 8) +
        digest[offset + 3]) %
        1e6,
    ).padStart(6, "0");
    const verified = await request(
      "/api/auth/two-factor/verify-totp",
      "POST",
      { code, trustDevice: false },
      ownerCookie,
    );
    expect(verified.status).toBe(200);
    ownerCookie = cookieFrom(verified) || ownerCookie;
    expect(
      (await request("/api/projects", "GET", undefined, ownerCookie)).status,
    ).toBe(200);
  });
  it("provisions a synthetic WebCore company atomically and reveals credential once", async () => {
    const response = await request(
      "/api/admin/companies",
      "POST",
      {
        companyName: "DEMO Northstar",
        email: "team@northstar.test",
        projectTitle: "DEMO Website",
        packageVersionId: "webcore:1",
      },
      ownerCookie,
    );
    expect(response.status).toBe(201);
    const result = (await response.json()) as {
      projectId: string;
      credential: string;
    };
    projectId = result.projectId;
    expect(result.credential.length).toBe(48);
    clientCookie = await login("team@northstar.test", result.credential);
    const me = (await (
      await request("/api/me", "GET", undefined, clientCookie)
    ).json()) as { user: { id: string } };
    clientId = me.user.id;
    const rows = await db.select().from(s.auditEvents);
    expect(rows.some((r) => r.action === "company.provisioned")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(result.credential);
  });
  it("rejects client admin access and hidden feature bypass", async () => {
    expect(
      (await request("/api/packages", "GET", undefined, clientCookie)).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/projects/${projectId}/sections/inquiry`,
          "PUT",
          { revision: 0, fields: {} },
          clientCookie,
        )
      ).status,
    ).toBe(403);
  });
  it("saves and reloads D1 drafts, rejects stale writes and page cap bypass", async () => {
    const path = `/api/projects/${projectId}/sections/identity`;
    const fields = {
      name: { value: "DEMO <script>alert(1)</script>", status: "provided" },
    };
    expect(
      (await request(path, "PUT", { revision: 0, fields }, clientCookie))
        .status,
    ).toBe(200);
    expect(
      (await request(path, "PUT", { revision: 0, fields }, clientCookie))
        .status,
    ).toBe(409);
    expect(
      (await request(path, "PUT", { revision: 1, fields }, clientCookie))
        .status,
    ).toBe(200);
    expect(
      (await request(path, "PUT", { revision: 1, fields }, clientCookie))
        .status,
    ).toBe(409);
    const detail = (await (
      await request(
        `/api/projects/${projectId}`,
        "GET",
        undefined,
        clientCookie,
      )
    ).json()) as { drafts: { answers: unknown; revision: number }[] };
    expect(detail.drafts[0].revision).toBe(2);
    expect(detail.drafts[0].answers).toEqual(fields);
    expect(
      (
        await request(
          `/api/projects/${projectId}/sections/pages`,
          "PUT",
          {
            revision: 0,
            fields: {
              routes: {
                status: "provided",
                value: "/\n/about\n/services\n/contact\n/privacy",
              },
            },
          },
          clientCookie,
        )
      ).status,
    ).toBe(400);
  });
  it("denies a second company access to guessed project IDs", async () => {
    const second = await request(
      "/api/admin/companies",
      "POST",
      {
        companyName: "DEMO Other",
        email: "team@other.test",
        projectTitle: "DEMO Other Website",
        packageVersionId: "growthlayer:1",
      },
      ownerCookie,
    );
    expect(second.status).toBe(201);
    const details = (await second.json()) as { credential: string };
    otherCookie = await login("team@other.test", details.credential);
    expect(
      (
        await request(
          `/api/projects/${projectId}`,
          "GET",
          undefined,
          otherCookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/projects/${projectId}/sections/identity`,
          "PUT",
          { revision: 2, fields: {} },
          otherCookie,
        )
      ).status,
    ).toBe(404);
    const list = (await (
      await request("/api/projects", "GET", undefined, otherCookie)
    ).json()) as { projects: { id: string }[] };
    expect(list.projects.some((p) => p.id === projectId)).toBe(false);
  });
  it("rejects foreign origins and unsafe external links", async () => {
    expect(
      (
        await app.request(
          origin + "/api/activity",
          {
            method: "POST",
            headers: { Origin: "https://attacker.test", Cookie: clientCookie },
          },
          bindings,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/projects/${projectId}/sections/logo`,
          "PUT",
          {
            revision: 0,
            fields: {
              sourceLink: { value: "javascript:alert(1)", status: "provided" },
            },
          },
          clientCookie,
        )
      ).status,
    ).toBe(400);
  });
  it("exposes published portal policies publicly while keeping drafts and owner settings private", async () => {
    const initial = await request("/api/policies");
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      published: false,
      privacy: { text: "", version: "" },
      terms: { text: "", version: "" },
    });
    const draft = {
      ...defaultSettings,
      privacyNoticeText: "DEMO private draft",
      portalTermsText: "DEMO private terms draft",
    };
    await db.insert(s.portalSettings).values({
      id: "portal",
      revision: 1,
      value: draft,
      updatedAt: new Date(),
    });
    const hidden = await (await request("/api/policies")).text();
    expect(hidden).not.toContain("DEMO private");
    expect(hidden).not.toContain("cmsCaps");
    expect(hidden).not.toContain("termsApproved");
    await db.delete(s.portalSettings).where(eq(s.portalSettings.id, "portal"));
  });
  it("publishes required setup with optimistic concurrency and preserves old package versions", async () => {
    const before = await db
      .select()
      .from(s.packageVersions)
      .where(eq(s.packageVersions.id, "controlcore:1"))
      .get();
    const value = {
      ...defaultSettings,
      privacyNoticeText: "DEMO TEST privacy notice only",
      privacyNoticeVersion: "demo-1",
      portalTermsText: "DEMO TEST portal terms only",
      portalTermsVersion: "demo-1",
      policiesPublished: true,
      termsText: "DEMO TEST agreement only",
      termsVersion: "demo-1",
      verificationProtocol: "DEMO independently verified channel",
      termsApproved: true,
      archivedRetentionDays: 90,
      approvedRetentionDays: 365,
      messageRetentionDays: 90,
      backupCadenceDays: 7,
      cmsCaps: { controlcore: 3, cataloglayer: 5, workflowdesk: 8 },
    };
    expect(
      (
        await request(
          "/api/admin/settings",
          "PUT",
          { revision: 0, value },
          ownerCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/api/admin/settings",
          "PUT",
          { revision: 0, value },
          ownerCookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await db
          .select()
          .from(s.packageVersions)
          .where(eq(s.packageVersions.id, "controlcore:1"))
          .get()
      )?.config,
    ).toEqual(before?.config);
    expect(
      (
        await db
          .select()
          .from(s.packageVersions)
          .where(eq(s.packageVersions.id, "controlcore:2"))
          .get()
      )?.version,
    ).toBe(2);
    expect(
      (
        await request(
          "/api/admin/settings",
          "PUT",
          { revision: 1, value },
          clientCookie,
        )
      ).status,
    ).toBe(403);
  });
  it("returns only explicitly published portal policies without requiring login", async () => {
    const response = await request("/api/policies");
    expect(response.status).toBe(200);
    const policies = (await response.json()) as {
      published: boolean;
      privacy: { text: string };
      terms: { text: string };
    };
    expect(policies.published).toBe(true);
    expect(policies.privacy.text).toBe("DEMO TEST privacy notice only");
    expect(policies.terms.text).toBe("DEMO TEST portal terms only");
  });
  it("detects another editor and expires the section lease without overriding revisions", async () => {
    const second = await login(
      "team@northstar.test",
      credentials.get("team@northstar.test")!,
    );
    const path = `/api/projects/${projectId}/sections/identity/lease`;
    expect(
      (
        (await (await request(path, "POST", {}, clientCookie)).json()) as {
          held: boolean;
        }
      ).held,
    ).toBe(true);
    expect(
      (
        (await (await request(path, "POST", {}, second)).json()) as {
          anotherEditor: boolean;
        }
      ).anotherEditor,
    ).toBe(true);
    await db
      .update(s.sectionLeases)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(s.sectionLeases.projectId, projectId));
    expect(
      (
        (await (await request(path, "POST", {}, second)).json()) as {
          held: boolean;
        }
      ).held,
    ).toBe(true);
    expect((await request(path, "DELETE", undefined, second)).status).toBe(200);
  });
  it("allows exactly one simultaneous save and rejects the stale section", async () => {
    const path = `/api/projects/${projectId}/sections/identity`,
      fields = { name: { value: "DEMO Concurrent", status: "provided" } };
    const responses = await Promise.all([
      request(path, "PUT", { revision: 2, fields }, clientCookie),
      request(path, "PUT", { revision: 2, fields }, clientCookie),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it("keeps private notes and their replies out of client and other-company reads", async () => {
    const r = await request(
      `/api/projects/${projectId}/inbox`,
      "POST",
      {
        kind: "note",
        visibility: "private",
        subject: "DEMO private note",
        body: "DEMO owner-only content",
      },
      ownerCookie,
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(
      (await request(`/api/inbox/${id}`, "GET", undefined, clientCookie))
        .status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/inbox/${id}/replies`,
          "POST",
          { body: "DEMO probing" },
          otherCookie,
        )
      ).status,
    ).toBe(404);
    const list = (await (
      await request(
        `/api/projects/${projectId}/inbox`,
        "GET",
        undefined,
        clientCookie,
      )
    ).json()) as { items: { id: string }[] };
    expect(list.items.some((i) => i.id === id)).toBe(false);
    expect(
      (
        await request(
          `/api/projects/${projectId}/inbox`,
          "POST",
          {
            kind: "note",
            visibility: "private",
            subject: "DEMO bypass",
            body: "DEMO",
          },
          clientCookie,
        )
      ).status,
    ).toBe(403);
  });
  it("blocks incomplete submission, then captures complete structured requirements for independent review", async () => {
    expect(
      (
        await request(
          `/api/projects/${projectId}/submit`,
          "POST",
          {},
          clientCookie,
        )
      ).status,
    ).toBe(400);
    const response = await request(
      `/api/projects/${projectId}`,
      "GET",
      undefined,
      clientCookie,
    );
    const detail = (await response.json()) as {
      sections: SectionDefinition[];
      drafts: { section: string; revision: number }[];
    };
    const valueFor = (field: FieldDefinition): string =>
      field.type === "select"
        ? field.options![0]
        : field.type === "checkbox"
          ? "yes"
          : field.type === "url" || field.type === "links"
            ? "https://assets.example.test/demo"
            : field.type === "routes"
              ? "/"
              : field.type === "destination"
                ? "#contact"
                : field.key === "email"
                  ? "contact@example.test"
                  : "DEMO provided content";
    for (const section of detail.sections) {
      const fields: Record<string, FieldAnswer> = {};
      for (const field of activeFields(section, {
        mode: { status: "provided", value: "single_image" },
      }).filter((f) => f.required))
        fields[field.key] = {
          status: "provided",
          value:
            field.type === "collection"
              ? JSON.stringify([
                  {
                    id: "demo-item",
                    fields: Object.fromEntries(
                      field
                        .itemFields!.filter((f) => f.required)
                        .map((f) => [f.key, valueFor(f)]),
                    ),
                  },
                ])
              : valueFor(field),
        };
      if (section.id === "media")
        fields.permissions = { status: "provided", value: "yes" };
      if (section.id === "pages")
        fields.routes = { status: "provided", value: "/\n/about" };
      if (section.id === "footer")
        fields.legalPages = {
          status: "provided",
          value: JSON.stringify([
            {
              id: "legal-demo",
              fields: {
                title: "DEMO Privacy",
                route: "/privacy",
                content: "DEMO supplied wording",
              },
            },
          ]),
        };
      if (section.id === "services")
        fields.items = {
          status: "provided",
          value: JSON.stringify([
            {
              id: "service-demo",
              fields: {
                name: "DEMO service",
                summary: "DEMO summary",
                display: "page",
                route: "/services/demo",
                description: "DEMO detail",
              },
            },
          ]),
        };
      if (section.id === "hero")
        fields.slides = {
          status: "provided",
          value: JSON.stringify([
            {
              id: "inactive-demo",
              fields: { headline: "INACTIVE SLIDE MUST NOT EXPORT" },
            },
          ]),
        };
      const r = await request(
        `/api/projects/${projectId}/sections/${section.id}`,
        "PUT",
        {
          revision:
            detail.drafts.find((d) => d.section === section.id)?.revision ?? 0,
          fields,
        },
        clientCookie,
      );
      expect(r.status, section.id).toBe(200);
    }
    const review = (await (
      await request(
        `/api/projects/${projectId}/review`,
        "GET",
        undefined,
        ownerCookie,
      )
    ).json()) as { control: { revision: number } };
    const controls = {
      revision: review.control.revision,
      scopeReference: "DEMO scope reference",
      manualScope: null,
      launchAt: null,
      testUrl: "https://demo.example.test",
      approverName: "DEMO Approver",
      approverEmail: "approver@example.test",
      approverMethod: "DEMO independently verified channel",
      approverVerified: true,
    };
    expect(
      (
        await request(
          `/api/admin/projects/${projectId}/control`,
          "PUT",
          controls,
          ownerCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/admin/projects/${projectId}/control`,
          "PUT",
          controls,
          ownerCookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          `/api/projects/${projectId}/submit`,
          "POST",
          {},
          clientCookie,
        )
      ).status,
    ).toBe(200);
  });
  it("rejects expired and stale agreement challenges, mismatched identity and replayed approval", async () => {
    const issue = async () => {
      const r = await request(
        `/api/admin/projects/${projectId}/approval-challenge`,
        "POST",
        { acceptedUnknowns: [] },
        ownerCookie,
      );
      expect(r.status).toBe(200);
      return ((await r.json()) as { token: string }).token;
    };
    let token = await issue();
    const approval = () => ({
      token,
      name: "DEMO Approver",
      email: "approver@example.test",
      termsVersion: "demo-1",
      agreementAccepted: true,
      contentConfirmed: true,
      acceptedUnknowns: [],
    });
    await db
      .update(s.approvalChallenges)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(s.approvalChallenges.projectId, projectId));
    expect(
      (
        await request(
          `/api/projects/${projectId}/approve`,
          "POST",
          approval(),
          clientCookie,
        )
      ).status,
    ).toBe(400);
    token = await issue();
    const settings = (await (
      await request("/api/admin/settings", "GET", undefined, ownerCookie)
    ).json()) as { revision: number; value: unknown };
    expect(
      (
        await request(
          "/api/admin/settings",
          "PUT",
          { revision: settings.revision, value: settings.value },
          ownerCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/projects/${projectId}/approve`,
          "POST",
          approval(),
          clientCookie,
        )
      ).status,
    ).toBe(400);
    token = await issue();
    expect(
      (
        await request(
          `/api/projects/${projectId}/approve`,
          "POST",
          { ...approval(), name: "DEMO Wrong person" },
          clientCookie,
        )
      ).status,
    ).toBe(400);
    const outcomes = await Promise.all([
      request(
        `/api/projects/${projectId}/approve`,
        "POST",
        approval(),
        clientCookie,
      ),
      request(
        `/api/projects/${projectId}/approve`,
        "POST",
        approval(),
        clientCookie,
      ),
    ]);
    expect(outcomes.filter((r) => r.status === 201)).toHaveLength(1);
    expect(outcomes.every((r) => [201, 400, 409].includes(r.status))).toBe(
      true,
    );
    expect(
      await db
        .select()
        .from(s.approvedSubmissions)
        .where(eq(s.approvedSubmissions.projectId, projectId)),
    ).toHaveLength(1);
  });
  it("exports only the immutable entitled snapshot and denies client access to agent JSON", async () => {
    const path = `/api/admin/projects/${projectId}/versions/1/agent.json`;
    const a = await request(path, "GET", undefined, ownerCookie),
      text = await a.text();
    expect(a.status).toBe(200);
    expect(
      await (await request(path, "GET", undefined, ownerCookie)).text(),
    ).toBe(text);
    expect(text).not.toContain("DEMO owner-only content");
    expect(text).not.toContain("INACTIVE SLIDE MUST NOT EXPORT");
    expect(JSON.parse(text).routes).toEqual([
      "/",
      "/about",
      "/services/demo",
      "/privacy",
    ]);
    expect((await request(path, "GET", undefined, clientCookie)).status).toBe(
      403,
    );
    expect(
      (
        await request(
          `/api/projects/${projectId}/versions/1`,
          "GET",
          undefined,
          otherCookie,
        )
      ).status,
    ).toBe(404);
    const row = await db
      .select()
      .from(s.approvedSubmissions)
      .where(eq(s.approvedSubmissions.projectId, projectId))
      .get();
    expect(row!.contentHash).toBe(await sha256(canonical(row!.snapshot)));
    await expect(
      db
        .update(s.approvedSubmissions)
        .set({ contentHash: "invalid" })
        .where(eq(s.approvedSubmissions.id, row!.id)),
    ).rejects.toThrow();
    await expect(
      db
        .delete(s.approvedSubmissions)
        .where(eq(s.approvedSubmissions.id, row!.id)),
    ).rejects.toThrow();
  });
  it("records page checkup against derived service and legal routes and protects untouched sections on reopening", async () => {
    expect(
      (
        await request(
          `/api/projects/${projectId}/checkup`,
          "PUT",
          {
            version: 1,
            path: "/privacy",
            status: "needs_correction",
            notes: "DEMO wording correction",
            evidenceLinks: ["https://assets.example.test/evidence"],
          },
          clientCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/projects/${projectId}/checkup`,
          "PUT",
          {
            version: 1,
            path: "/unknown",
            status: "matches",
            notes: "",
            evidenceLinks: [],
          },
          clientCookie,
        )
      ).status,
    ).toBe(400);
    const r = await request(
      `/api/projects/${projectId}/inbox`,
      "POST",
      {
        kind: "change",
        visibility: "shared",
        subject: "DEMO correction",
        body: "DEMO corrected business name",
        classification: "correction",
        affectedSections: ["identity"],
      },
      clientCookie,
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(
      (await request(`/api/admin/inbox/${id}/reopen`, "POST", {}, ownerCookie))
        .status,
    ).toBe(409);
    expect(
      (
        await request(
          `/api/admin/inbox/${id}`,
          "PATCH",
          { status: "done", size: "small", quotePhp: null },
          ownerCookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          `/api/admin/inbox/${id}`,
          "PATCH",
          { status: "approved", size: "small", quotePhp: null },
          ownerCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request(`/api/admin/inbox/${id}/reopen`, "POST", {}, ownerCookie))
        .status,
    ).toBe(200);
    const detail = (await (
      await request(
        `/api/projects/${projectId}`,
        "GET",
        undefined,
        clientCookie,
      )
    ).json()) as { drafts: { section: string; revision: number }[] };
    expect(
      (
        await request(
          `/api/projects/${projectId}/sections/hero`,
          "PUT",
          {
            revision: detail.drafts.find((d) => d.section === "hero")!.revision,
            fields: {
              headline: { status: "provided", value: "DEMO forbidden" },
            },
          },
          clientCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/projects/${projectId}/sections/identity`,
          "PUT",
          {
            revision: detail.drafts.find((d) => d.section === "identity")!
              .revision,
            fields: { name: { status: "provided", value: "DEMO amended" } },
          },
          clientCookie,
        )
      ).status,
    ).toBe(200);
    const baseline = (await (
      await request(
        `/api/projects/${projectId}/versions/1`,
        "GET",
        undefined,
        clientCookie,
      )
    ).json()) as {
      snapshot: { answers: { identity: { name: { value: string } } } };
    };
    expect(baseline.snapshot.answers.identity.name.value).toBe(
      "DEMO provided content",
    );
  });
  it("creates an audited upgrade and v2 while preserving the exact v1 snapshot", async () => {
    const getDetail = async () =>
      (await (
        await request(
          `/api/projects/${projectId}`,
          "GET",
          undefined,
          ownerCookie,
        )
      ).json()) as {
        control: { revision: number };
        drafts: { section: string; revision: number }[];
      };
    const before = await (
      await request(
        `/api/projects/${projectId}/versions/1`,
        "GET",
        undefined,
        ownerCookie,
      )
    ).text();
    const created = await request(
      `/api/projects/${projectId}/inbox`,
      "POST",
      {
        kind: "change",
        visibility: "shared",
        subject: "DEMO inquiry upgrade",
        body: "DEMO agreed expanded scope",
        classification: "upgrade",
        affectedSections: ["identity", "inquiry"],
      },
      clientCookie,
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(
      (
        await request(
          `/api/admin/inbox/${id}`,
          "PATCH",
          { status: "approved", size: "small", quotePhp: 5500 },
          ownerCookie,
        )
      ).status,
    ).toBe(200);
    let detail = await getDetail();
    expect(
      (
        await request(
          `/api/admin/projects/${projectId}/packages`,
          "POST",
          {
            revision: detail.control.revision,
            versionIds: ["growthlayer:1"],
            reason: "DEMO separately approved upgrade",
            requestId: id,
          },
          ownerCookie,
        )
      ).status,
    ).toBe(200);
    detail = await getDetail();
    expect(
      (
        await request(
          `/api/projects/${projectId}/sections/identity`,
          "PUT",
          {
            revision: detail.drafts.find((d) => d.section === "identity")!
              .revision,
            fields: {
              name: { status: "provided", value: "DEMO amended v2" },
              description: {
                status: "provided",
                value: "DEMO amended introduction",
              },
            },
          },
          clientCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/projects/${projectId}/sections/inquiry`,
          "PUT",
          {
            revision: 0,
            fields: {
              fields: { status: "provided", value: "DEMO name and inquiry" },
            },
          },
          clientCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/projects/${projectId}/submit`,
          "POST",
          {},
          clientCookie,
        )
      ).status,
    ).toBe(200);
    const challenge = await request(
      `/api/admin/projects/${projectId}/approval-challenge`,
      "POST",
      { acceptedUnknowns: [] },
      ownerCookie,
    );
    expect(challenge.status).toBe(200);
    const { token } = (await challenge.json()) as { token: string };
    const approved = await request(
      `/api/projects/${projectId}/approve`,
      "POST",
      {
        token,
        name: "DEMO Approver",
        email: "approver@example.test",
        termsVersion: "demo-1",
        agreementAccepted: true,
        contentConfirmed: true,
        acceptedUnknowns: [],
      },
      clientCookie,
    );
    expect(approved.status).toBe(201);
    expect(((await approved.json()) as { version: number }).version).toBe(2);
    expect(
      await (
        await request(
          `/api/projects/${projectId}/versions/1`,
          "GET",
          undefined,
          ownerCookie,
        )
      ).text(),
    ).toBe(before);
    expect(
      (
        await db
          .select()
          .from(s.scopeAmendments)
          .where(eq(s.scopeAmendments.projectId, projectId))
      ).length,
    ).toBeGreaterThan(0);
  });
  it("requires recent owner authentication for sensitive setup", async () => {
    const me = (await (
      await request("/api/me", "GET", undefined, ownerCookie)
    ).json()) as { user: { sessionId: string } };
    const old = await db
      .select()
      .from(s.session)
      .where(eq(s.session.id, me.user.sessionId))
      .get();
    await db
      .update(s.session)
      .set({ createdAt: new Date(Date.now() - 16 * 60000) })
      .where(eq(s.session.id, me.user.sessionId));
    const settings = (await (
      await request("/api/admin/settings", "GET", undefined, ownerCookie)
    ).json()) as { revision: number; value: unknown };
    expect(
      (
        await request(
          "/api/admin/settings",
          "PUT",
          { revision: settings.revision, value: settings.value },
          ownerCookie,
        )
      ).status,
    ).toBe(403);
    await db
      .update(s.session)
      .set({ createdAt: old!.createdAt })
      .where(eq(s.session.id, me.user.sessionId));
  });
  it("recovers a client with a hashed single-use token and revokes prior sessions", async () => {
    expect(
      (
        await request("/api/recovery/request", "POST", {
          email: "unknown@example.test",
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await request("/api/recovery/request", "POST", {
          email: "team@northstar.test",
        })
      ).status,
    ).toBe(202);
    const queue = (await (
      await request("/api/admin/recovery", "GET", undefined, ownerCookie)
    ).json()) as { requests: { id: string; email: string }[] };
    const id = queue.requests.find(
      (r) => r.email === "team@northstar.test",
    )!.id;
    const issued = await request(
      `/api/admin/recovery/${id}/issue`,
      "POST",
      {},
      ownerCookie,
    );
    expect(issued.status).toBe(200);
    const { token } = (await issued.json()) as { token: string };
    const stored = await db.select().from(s.credentialTokens);
    expect(JSON.stringify(stored)).not.toContain(token);
    const credential = password();
    const body = { token, password: credential };
    expect((await request("/api/recovery/complete", "POST", body)).status).toBe(
      200,
    );
    expect((await request("/api/recovery/complete", "POST", body)).status).toBe(
      400,
    );
    expect(
      (await request("/api/me", "GET", undefined, clientCookie)).status,
    ).toBe(401);
    clientCookie = await login("team@northstar.test", credential);
    expect(JSON.stringify(await db.select().from(s.auditEvents))).not.toContain(
      token,
    );
  });
  it("enforces combined monthly care limits atomically from recorded launch", async () => {
    const projects = (await (
      await request("/api/projects", "GET", undefined, otherCookie)
    ).json()) as { projects: { id: string }[] };
    const id = projects.projects[0].id;
    const review = (await (
      await request(`/api/projects/${id}/review`, "GET", undefined, ownerCookie)
    ).json()) as { control: { revision: number } };
    const launchAt = new Date(Date.now() - 45 * 86400000).toISOString();
    expect(
      (
        await request(
          `/api/admin/projects/${id}/control`,
          "PUT",
          {
            revision: review.control.revision,
            scopeReference: "DEMO Care Scope",
            manualScope: null,
            launchAt,
            testUrl: "",
            approverName: "",
            approverEmail: "",
            approverMethod: "",
            approverVerified: false,
          },
          ownerCookie,
        )
      ).status,
    ).toBe(200);
    const body = {
      minutes: 35,
      description: "DEMO small content update",
      performedAt: new Date().toISOString(),
    };
    const responses = await Promise.all([
      request(`/api/admin/projects/${id}/care`, "POST", body, ownerCookie),
      request(`/api/admin/projects/${id}/care`, "POST", body, ownerCookie),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (
        await request(
          `/api/admin/projects/${id}/care`,
          "POST",
          { ...body, minutes: 25 },
          ownerCookie,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await request(
          `/api/admin/projects/${id}/care`,
          "POST",
          { ...body, minutes: 1 },
          ownerCookie,
        )
      ).status,
    ).toBe(409);
    const usage = (await (
      await request(`/api/projects/${id}/care`, "GET", undefined, otherCookie)
    ).json()) as { usage: { minutes: number; requests: number } };
    expect(usage.usage).toEqual({ minutes: 60, requests: 2 });
    expect(
      (
        await request(
          `/api/admin/projects/${id}/care`,
          "POST",
          body,
          clientCookie,
        )
      ).status,
    ).toBe(403);
  });
  it("revokes outstanding recovery and approval challenges with company session revocation", async () => {
    const member = await db
      .select()
      .from(s.memberships)
      .where(eq(s.memberships.userId, clientId))
      .get();
    const token = randomCredential(),
      challengeId = crypto.randomUUID();
    await db.insert(s.credentialTokens).values({
      id: crypto.randomUUID(),
      userId: clientId,
      tokenHash: await sha256(token),
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
    });
    await db.insert(s.approvalChallenges).values({
      id: challengeId,
      projectId,
      tokenHash: await sha256(randomCredential()),
      draftHash: "DEMO",
      controlRevision: 1,
      settingsRevision: 1,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
    });
    expect(
      (
        await request(
          `/api/admin/companies/${member!.companyId}/access`,
          "POST",
          { action: "revoke_sessions" },
          ownerCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request("/api/me", "GET", undefined, clientCookie)).status,
    ).toBe(401);
    expect(
      (
        await request("/api/recovery/complete", "POST", {
          token,
          password: password(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await db
          .select()
          .from(s.approvalChallenges)
          .where(eq(s.approvalChallenges.id, challengeId))
          .get()
      )?.consumedAt,
    ).not.toBeNull();
    clientCookie = await login(
      "team@northstar.test",
      credentials.get("team@northstar.test")!,
    );
  });
  it("rejects writes to an approved project", async () => {
    await db
      .update(s.projects)
      .set({ status: "approved" })
      .where(eq(s.projects.id, projectId));
    expect(
      (
        await request(
          `/api/projects/${projectId}/sections/identity`,
          "PUT",
          { revision: 2, fields: {} },
          clientCookie,
        )
      ).status,
    ).toBe(409);
  });
  it("denies suspended memberships and expired idle sessions", async () => {
    await db
      .update(s.memberships)
      .set({ status: "suspended" })
      .where(eq(s.memberships.userId, clientId));
    expect(
      (
        await request(
          `/api/projects/${projectId}`,
          "GET",
          undefined,
          clientCookie,
        )
      ).status,
    ).toBe(403);
    const me = (await (
      await request("/api/me", "GET", undefined, otherCookie)
    ).json()) as { user: { sessionId: string } };
    await db
      .update(s.idleSessions)
      .set({ lastActivityAt: new Date(Date.now() - 600001) })
      .where(eq(s.idleSessions.sessionId, me.user.sessionId));
    expect(
      (await request("/api/me", "GET", undefined, otherCookie)).status,
    ).toBe(401);
    expect(
      (await request("/api/activity", "POST", {}, otherCookie)).status,
    ).toBe(401);
  });
  it("revokes sessions created before owner MFA enrollment", async () => {
    expect(previousOwnerCookie).not.toBe("");
    expect(
      (await request("/api/me", "GET", undefined, previousOwnerCookie)).status,
    ).toBe(401);
  });
  it("requires the second factor on subsequent owner password sign-ins", async () => {
    const response = await request("/api/auth/sign-in/email", "POST", {
      email: "owner@portal.test",
      password: ownerCredential,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { twoFactorRedirect?: boolean };
    expect(body.twoFactorRedirect).toBe(true);
    expect(
      (await request("/api/me", "GET", undefined, cookieFrom(response))).status,
    ).toBe(401);
  });
  it("keeps expired sessions out of protected account endpoints", async () => {
    expect(
      (
        await request(
          "/api/auth/change-password",
          "POST",
          {
            currentPassword: "synthetic-invalid-value",
            newPassword: password(),
          },
          otherCookie,
        )
      ).status,
    ).toBe(401);
  });
  it("limits repeated password attempts without weakening hashing", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push(
        (
          await request("/api/auth/sign-in/email", "POST", {
            email: "missing@example.test",
            password: password(),
          })
        ).status,
      );
    expect(statuses[5]).toBe(429);
  });
  it("assigns optional services and enforces manual BookingSuite scope and structured portfolio limits", async () => {
    const create = async (
      email: string,
      packageVersionId: string,
      cmsVersionId?: string,
    ) => {
      const r = await request(
        "/api/admin/companies",
        "POST",
        {
          companyName: "DEMO Additional",
          email,
          projectTitle: "DEMO Scope Fixture",
          packageVersionId,
          ...(cmsVersionId ? { cmsVersionId } : {}),
          seoVersionId: "searchlayer:1",
          careVersionId: "continuity:1",
        },
        ownerCookie,
      );
      expect(r.status).toBe(201);
      return (await r.json()) as { projectId: string; credential: string };
    };
    const booking = await create(
      "booking@fixtures.test",
      "bookingsuite:1",
      "workflowdesk:2",
    );
    let detail = (await (
      await request(
        `/api/projects/${booking.projectId}`,
        "GET",
        undefined,
        ownerCookie,
      )
    ).json()) as {
      sections: { id: string }[];
      control: { revision: number };
      config: { maxPages: number; seats: number; editableSections: number };
    };
    expect(detail.sections.some((v) => v.id === "booking")).toBe(false);
    expect(detail.sections.some((v) => v.id === "seo")).toBe(true);
    expect(
      (
        await request(
          `/api/admin/projects/${booking.projectId}/control`,
          "PUT",
          {
            revision: detail.control.revision,
            scopeReference: "DEMO written booking scope",
            manualScope: {
              approved: true,
              reference: "DEMO approved custom scope",
              maxPages: 9,
              inquiry: true,
              reservation: true,
              booking: true,
            },
            launchAt: null,
            testUrl: "",
            approverName: "",
            approverEmail: "",
            approverMethod: "",
            approverVerified: false,
          },
          ownerCookie,
        )
      ).status,
    ).toBe(200);
    detail = (await (
      await request(
        `/api/projects/${booking.projectId}`,
        "GET",
        undefined,
        ownerCookie,
      )
    ).json()) as typeof detail;
    expect(detail.sections.map((v) => v.id)).toEqual(
      expect.arrayContaining([
        "inquiry",
        "reservation",
        "booking",
        "workflow",
        "cms",
        "seo",
      ]),
    );
    expect(detail.config).toMatchObject({
      maxPages: 9,
      seats: 5,
      editableSections: 8,
    });
    const signature = await create(
      "signature@fixtures.test",
      "signature-interface:1",
    );
    expect(
      (
        await request(
          `/api/projects/${signature.projectId}/sections/portfolio`,
          "PUT",
          {
            revision: 0,
            fields: {
              projects: {
                status: "provided",
                value: JSON.stringify(
                  Array.from({ length: 5 }, (_, i) => ({
                    id: "case" + i,
                    fields: { title: "DEMO", summary: "DEMO" },
                  })),
                ),
              },
            },
          },
          ownerCookie,
        )
      ).status,
    ).toBe(400);
    const results = (await (
      await request(
        "/api/projects?q=Additional&package=signature-interface&status=draft",
        "GET",
        undefined,
        ownerCookie,
      )
    ).json()) as { projects: { id: string }[] };
    expect(results.projects.map((v) => v.id)).toEqual([signature.projectId]);
  });
  it("cleans expired security records without deleting immutable content or current sessions", async () => {
    const stale = crypto.randomUUID();
    await db.insert(s.session).values({
      id: stale,
      token: password(),
      userId: clientId,
      expiresAt: new Date(Date.now() - 1),
      createdAt: new Date(Date.now() - 10000),
      updatedAt: new Date(Date.now() - 10000),
    });
    const baseline = await db.select().from(s.approvedSubmissions);
    expect((await maintenance(bindings.DB)).mode).toBe("dry_run");
    expect(
      await db.select().from(s.session).where(eq(s.session.id, stale)).get(),
    ).toBeDefined();
    expect((await maintenance(bindings.DB, true)).approvedContentDeleted).toBe(
      false,
    );
    expect(
      await db.select().from(s.session).where(eq(s.session.id, stale)).get(),
    ).toBeUndefined();
    expect(await db.select().from(s.approvedSubmissions)).toEqual(baseline);
    expect(
      (await request("/api/me", "GET", undefined, ownerCookie)).status,
    ).toBe(200);
  });
  it("uses an owner MFA backup code once and still enforces the second factor", async () => {
    const step = await request("/api/auth/sign-in/email", "POST", {
      email: "owner@portal.test",
      password: ownerCredential,
    });
    expect(step.status).toBe(200);
    const verified = await request(
      "/api/auth/two-factor/verify-backup-code",
      "POST",
      { code: ownerBackupCode, trustDevice: false },
      cookieFrom(step),
    );
    expect(verified.status).toBe(200);
    expect(
      (await request("/api/me", "GET", undefined, cookieFrom(verified))).status,
    ).toBe(200);
    const again = await request("/api/auth/sign-in/email", "POST", {
      email: "owner@portal.test",
      password: ownerCredential,
    });
    expect(
      (
        await request(
          "/api/auth/two-factor/verify-backup-code",
          "POST",
          { code: ownerBackupCode, trustDevice: false },
          cookieFrom(again),
        )
      ).ok,
    ).toBe(false);
    const audit = await db.select().from(s.auditEvents);
    expect(audit.some((v) => v.action === "auth.password_step_accepted")).toBe(
      true,
    );
    expect(JSON.stringify(audit)).not.toContain(ownerBackupCode);
  });
  it("recovers only an old unassigned synthetic provisioning account and rotates its credential", async () => {
    const orphan = await makeUser("orphan@fixtures.test");
    await db
      .update(s.user)
      .set({ createdAt: new Date(Date.now() - 3600001) })
      .where(eq(s.user.id, orphan.id));
    const body = {
      companyName: "DEMO Recovered",
      email: "orphan@fixtures.test",
      projectTitle: "DEMO Recovered project",
      packageVersionId: "webcore:1",
      recoverInterruptedSetup: true,
    };
    const response = await request(
      "/api/admin/companies",
      "POST",
      body,
      ownerCookie,
    );
    expect(response.status).toBe(201);
    const recovered = (await response.json()) as { credential: string };
    const account = await db
      .select()
      .from(s.account)
      .where(eq(s.account.userId, orphan.id))
      .get();
    expect(
      await verifyPassword({
        password: recovered.credential,
        hash: account!.password!,
      }),
    ).toBe(true);
    expect(
      await verifyPassword({
        password: orphan.credential,
        hash: account!.password!,
      }),
    ).toBe(false);
    expect(
      (
        await db
          .select()
          .from(s.memberships)
          .where(eq(s.memberships.userId, orphan.id))
          .get()
      )?.userId,
    ).toBe(orphan.id);
    expect(
      (await request("/api/admin/companies", "POST", body, ownerCookie)).status,
    ).toBe(409);
    expect(
      (await db.select().from(s.auditEvents)).some(
        (e) => e.action === "company.provisioning_recovered",
      ),
    ).toBe(true);
  });
  it("fails closed outside the local runtime", async () => {
    expect(
      (await app.request("https://portal.workers.dev/api/status", {}, bindings))
        .status,
    ).toBe(503);
  });
});
