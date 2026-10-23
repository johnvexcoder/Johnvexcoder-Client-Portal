import { describe, it, expect } from "vitest";
import {
  catalog,
  resolveEntitlements,
  countRoutes,
  careStatus,
} from "../../src/features/packages/catalog";
import {
  allowedSections,
  validateFields,
  fieldSchema,
  sectionSchema,
  completion,
} from "../../src/features/questionnaire/schema";
import {
  canAccessProject,
  isIdleExpired,
  safeExternalLink,
  localOnly,
} from "../../src/lib/security";
const pkg = (id: string) => catalog.find((p) => p.id === id)!;
describe("versioned package rules", () => {
  it("WebCore never exposes inquiry or workflow requirements", () => {
    const e = resolveEntitlements(pkg("webcore"));
    expect(e.maxPages).toBe(4);
    expect(allowedSections(e).some((s) => s.id === "inquiry")).toBe(false);
  });
  it("GrowthLayer ordinary inquiry requires no CMS", () => {
    expect(
      allowedSections(resolveEntitlements(pkg("growthlayer"))).some(
        (s) => s.id === "inquiry",
      ),
    ).toBe(true);
  });
  it("ReserveFlow enables manual reservation, not real-time booking", () => {
    const e = resolveEntitlements(pkg("reserveflow"));
    expect(e.reservation).toBe(true);
    expect(e.booking).toBeUndefined();
    expect(e.maxPages).toBe(7);
  });
  it("BookingSuite and WorkflowDesk stay gated without manual scope", () => {
    const e = resolveEntitlements(pkg("bookingsuite"), pkg("workflowdesk"));
    expect(e.booking).toBe(false);
    expect(e.inquiry).toBe(false);
    expect(e.maxPages).toBeNull();
    expect(e.workflow).toBe(false);
  });
  it("explicit synthetic manual scope defines booking cap and capabilities", () => {
    const e = resolveEntitlements(pkg("bookingsuite"), pkg("workflowdesk"), {
      approved: true,
      reference: "DEMO-SCOPE-01",
      maxPages: 9,
      inquiry: true,
      reservation: false,
      booking: true,
    });
    expect(e.maxPages).toBe(9);
    expect(e.booking).toBe(true);
    expect(e.reservation).toBe(false);
    expect(e.workflow).toBe(true);
  });
  it.each([
    ["controlcore", 2],
    ["cataloglayer", 3],
    ["workflowdesk", 5],
  ])("keeps %s seats independent of undecided section caps", (id, seats) => {
    expect(pkg(String(id)).seats).toBe(seats);
    expect(pkg(String(id)).editableSections).toBeNull();
  });
  it.each([
    ["profilecore", 3],
    ["identitylayer", 5],
    ["showcaseflow", 6],
    ["signature-interface", 4],
  ])("enforces %s project cap", (id, cap) => {
    const p = pkg(String(id)),
      section = allowedSections(p).find((s) => s.id === "portfolio")!;
    expect(p.maxProjects).toBe(cap);
    expect(() =>
      validateFields(
        section,
        {
          titles: {
            status: "provided",
            value: Array(Number(cap) + 1)
              .fill("DEMO project")
              .join("\n"),
          },
        },
        p,
      ),
    ).toThrow();
  });
  it("preserves optional SEO priority URL limits", () => {
    expect(pkg("searchlayer").priorityUrls).toBe(5);
    expect(pkg("searchedge").priorityUrls).toBe(8);
    expect(pkg("technicalflow").priorityUrls).toBe(20);
  });
  it("counts routes once, excludes anchors and external navigation", () => {
    expect(
      countRoutes([
        "/",
        "/#home",
        "#contact",
        "/about",
        "/about/",
        "/services/a",
        "/privacy",
      ]),
    ).toBe(4);
    expect(() => countRoutes(["https://external.test"])).toThrow();
  });
  it("blocks pages beyond the WebCore allowance", () => {
    const p = pkg("webcore");
    expect(() =>
      validateFields(
        allowedSections(p).find((s) => s.id === "pages")!,
        {
          routes: {
            value: "/\n/about\n/contact\n/services\n/privacy",
            status: "provided",
          },
        },
        p,
      ),
    ).toThrow("4");
  });
  it("does not start care until launch; distinguishes warranty and expiry", () => {
    expect(careStatus(null, new Date("2026-10-23"))).toBe("not_started");
    expect(careStatus("2026-10-01", new Date("2026-10-23"))).toBe("warranty");
    expect(careStatus("2026-01-01", new Date("2026-10-23"))).toBe("active");
    expect(careStatus("2024-01-01", new Date("2026-10-23"))).toBe("expired");
  });
});
describe("tenant and input boundaries", () => {
  it("denies cross-company access and unknown roles", () => {
    expect(canAccessProject("client", "a", "b")).toBe(false);
    expect(canAccessProject("client", null, "b")).toBe(false);
    expect(canAccessProject("client", "a", "a")).toBe(true);
    expect(canAccessProject("admin", null, "b")).toBe(true);
    expect(canAccessProject("unknown", "a", "a")).toBe(false);
  });
  it("expires exactly at 10 minutes", () => {
    expect(isIdleExpired(0, 599999)).toBe(false);
    expect(isIdleExpired(0, 600000)).toBe(true);
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "http://example.test",
    "https://user:pass@example.test",
  ])("rejects unsafe link %s", (url) => {
    expect(() => safeExternalLink(url)).toThrow();
  });
  it("allows HTTPS media links without fetching them", () => {
    expect(safeExternalLink("https://drive.google.com/example")).toBe(
      "https://drive.google.com/example",
    );
  });
  it("provided status must contain text, unsure is explicit", () => {
    expect(
      fieldSchema.safeParse({ value: " ", status: "provided" }).success,
    ).toBe(false);
    expect(fieldSchema.safeParse({ value: "", status: "unsure" }).success).toBe(
      true,
    );
  });
  it("does not count unsure required fields as complete", () => {
    const sections = allowedSections(pkg("webcore"));
    expect(completion(sections, {})).toBe(0);
    expect(
      completion(sections, {
        identity: { name: { value: "", status: "unsure" } },
      }),
    ).toBe(0);
    expect(
      completion(sections, {
        identity: { name: { value: "DEMO", status: "provided" } },
      }),
    ).toBeGreaterThan(0);
  });
  it("rejects unrecognized field names and payload metadata", () => {
    expect(() =>
      validateFields(
        allowedSections(pkg("webcore"))[0],
        { admin: { value: "true", status: "provided" } },
        pkg("webcore"),
      ),
    ).toThrow();
    expect(
      sectionSchema.safeParse({ revision: 0, fields: {}, companyId: "other" })
        .success,
    ).toBe(false);
  });
  it("production and remote origins stay closed", () => {
    expect(localOnly("http://localhost:5173", "local")).toBe(true);
    expect(localOnly("https://portal.workers.dev", "local")).toBe(false);
    expect(localOnly("http://localhost", "production")).toBe(false);
  });
});
