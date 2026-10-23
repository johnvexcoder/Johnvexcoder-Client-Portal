import { deploymentInput, deploymentConfig } from "../../src/lib/deployment";
import { describe, it, expect } from "vitest";
import { careWindow, manilaMonth } from "../../src/features/care";
import {
  activeFields,
  parseItems,
  routePaths,
  validateProjectContent,
} from "../../src/features/questionnaire/content-model";
import {
  definitions,
  validateFields,
} from "../../src/features/questionnaire/schema";
import { catalog } from "../../src/features/packages/catalog";
import {
  settingsSchema,
  defaultSettings,
  setupGaps,
} from "../../src/features/admin-settings";
import { canonical } from "../../src/lib/security";
describe("care calendar boundaries", () => {
  it("uses Manila calendar months at midnight, not UTC month boundaries", () => {
    const before = manilaMonth(Date.parse("2026-10-31T15:59:59Z")),
      after = manilaMonth(Date.parse("2026-10-31T16:00:00Z"));
    expect(before.end).toBe(after.start);
    expect(after.label).toBe("2026-11 (Asia/Manila)");
  });
  it("handles missing launch, warranty, exact expiry and leap-day anniversary", () => {
    const launch = Date.parse("2024-02-29T04:00:00Z");
    expect(careWindow(null, launch, true).status).toBe("not_started");
    expect(careWindow(launch, launch, false).status).toBe("not_included");
    expect(careWindow(launch, launch + 30 * 86400000 - 1, true).status).toBe(
      "warranty",
    );
    expect(careWindow(launch, launch + 30 * 86400000, true).status).toBe(
      "active",
    );
    const end = Date.parse("2025-02-28T04:00:00Z");
    expect(careWindow(launch, end, true).status).toBe("expired");
  });
});
describe("structured questionnaire and setup", () => {
  it("counts deduplicated service and legal routes, ignoring section anchors", () => {
    const provided = (value: string) => ({
      status: "provided" as const,
      value,
    });
    const answers = {
      pages: { routes: provided("/\n/about/\n#contact") },
      services: {
        items: provided(
          JSON.stringify([
            { id: "a", fields: { display: "page", route: "/service" } },
          ]),
        ),
      },
      footer: {
        legalPages: provided(
          JSON.stringify([{ id: "b", fields: { route: "/about" } }]),
        ),
      },
    };
    expect(routePaths(answers)).toEqual(["/", "/about", "/service"]);
    expect(() =>
      validateProjectContent(answers, { ...catalog[0], maxPages: 2 }),
    ).toThrow();
  });
  it("rejects duplicate item IDs and structured portfolio cap bypass", () => {
    expect(() =>
      parseItems('[{"id":"same","fields":{}},{"id":"same","fields":{}}]'),
    ).toThrow();
    const section = definitions.find((s) => s.id === "portfolio")!;
    expect(() =>
      validateFields(
        section,
        {
          projects: {
            status: "provided",
            value: JSON.stringify(
              Array.from({ length: 4 }, (_, i) => ({
                id: "p" + i,
                fields: { title: "DEMO", summary: "DEMO" },
              })),
            ),
          },
        },
        catalog.find((p) => p.id === "profilecore")!,
      ),
    ).toThrow();
  });
  it("exposes only the selected hero mode and validates CMS and SEO caps", () => {
    expect(
      activeFields(
        definitions.find((s) => s.id === "hero")!,
        { mode: { status: "provided", value: "slideshow" } },
      ).some((f) => f.key === "mediaLink"),
    ).toBe(false);
    const cms = definitions.find((s) => s.id === "cms")!,
      field = cms.fields.find((f) => f.type === "multi")!;
    expect(() =>
      validateFields(
        cms,
        {
          [field.key]: {
            status: "provided",
            value: JSON.stringify(field.options!.slice(0, 2)),
          },
        },
        { ...catalog[0], editableSections: 1 },
      ),
    ).toThrow();
    expect(() =>
      validateFields(
        definitions.find((s) => s.id === "seo")!,
        {
          urls: {
            status: "provided",
            value: "https://example.test/a\nhttps://example.test/b",
          },
        },
        { ...catalog[0], priorityUrls: 1 },
      ),
    ).toThrow();
  });
  it("keeps undecided owner setup explicit and excludes credential placeholders", () => {
    expect(setupGaps(defaultSettings)).toHaveLength(7);
    expect(
      settingsSchema.safeParse({ ...defaultSettings, policiesPublished: true })
        .success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({
        ...defaultSettings,
        welcomeTemplate: "Your credential is {{credential}}",
      }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...defaultSettings, termsApproved: true })
        .success,
    ).toBe(false);
  });
  it("canonicalizes timestamps and keys without dropping array order", () => {
    expect(
      canonical({ z: undefined, b: new Date("2026-01-01Z"), a: [2, 1] }),
    ).toBe('{"a":[2,1],"b":"2026-01-01T00:00:00.000Z"}');
  });
});

it("validates deployment origin and placeholder IDs without enabling production APIs", () => {
  const valid = {
    workerName: "portal-example",
    databaseId: "d3d217ae-64f9-4cdb-a7e0-35eb0865e818",
    portalUrl: "https://portal.example.test",
    ownerEmail: "owner@example.test",
  };
  expect(
    deploymentInput.safeParse({
      ...valid,
      databaseId: "00000000-0000-0000-0000-000000000000",
    }).success,
  ).toBe(false);
  expect(
    deploymentInput.safeParse({
      ...valid,
      portalUrl: "http://portal.example.test",
    }).success,
  ).toBe(false);
  expect(
    deploymentInput.safeParse({
      ...valid,
      portalUrl: "https://portal.example.test/path",
    }).success,
  ).toBe(false);
  expect(deploymentConfig(deploymentInput.parse(valid)).vars).toEqual({
    APP_ENV: "production",
    BETTER_AUTH_URL: "https://portal.example.test",
  });
});
