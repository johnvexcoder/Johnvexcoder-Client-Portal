import { test, expect } from "@playwright/test";
import { getPlatformProxy } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { randomBytes, createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createAuth, type Env } from "../../src/features/auth/auth";
import { seedCatalog } from "../../src/db/seed";
import * as s from "../../src/db/schema";
let ownerId = "",
  companyId = "",
  projectId = "",
  clientId = "";
const email = `owner-${Date.now()}@e2e.test`;
const password = randomBytes(24).toString("hex");
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret)
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const raw = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", raw).update(counter).digest();
  const i = digest.at(-1)! & 15;
  return String((digest.readUInt32BE(i) & 0x7fffffff) % 1e6).padStart(6, "0");
}
async function proxy() {
  return getPlatformProxy<Env>({
    configPath: "wrangler.e2e.jsonc",
    persist: { path: ".wrangler/e2e/v3" },
  });
}
test.beforeAll(async () => {
  const p = await proxy();
  try {
    const db = drizzle(p.env.DB);
    if (await db.select().from(s.user).where(eq(s.user.role, "admin")).get())
      throw new Error(
        "Owner exists in isolated E2E database. Inspect interrupted test state before retry.",
      );
    const result = await createAuth(p.env, true).api.signUpEmail({
      body: { email, password, name: "DEMO Browser Owner" },
    });
    ownerId = result.user.id;
    await db
      .update(s.user)
      .set({ role: "admin" })
      .where(eq(s.user.id, ownerId));
    await db.delete(s.session).where(eq(s.session.userId, ownerId));
    await seedCatalog(p.env.DB);
  } finally {
    await p.dispose();
  }
});
test.afterAll(async () => {
  if (!ownerId) return;
  const p = await proxy();
  try {
    const db = drizzle(p.env.DB);
    if (projectId) {
      await db.delete(s.drafts).where(eq(s.drafts.projectId, projectId));
      await db
        .delete(s.assignments)
        .where(eq(s.assignments.projectId, projectId));
      await db
        .delete(s.sectionLeases)
        .where(eq(s.sectionLeases.projectId, projectId));
      await db
        .delete(s.projectControls)
        .where(eq(s.projectControls.projectId, projectId));
      await db.delete(s.projects).where(eq(s.projects.id, projectId));
    }
    if (companyId) {
      await db
        .delete(s.auditEvents)
        .where(eq(s.auditEvents.companyId, companyId));
      await db
        .delete(s.memberships)
        .where(eq(s.memberships.companyId, companyId));
      await db.delete(s.companies).where(eq(s.companies.id, companyId));
    }
    if (clientId) await db.delete(s.user).where(eq(s.user.id, clientId));
    await db.delete(s.auditEvents).where(eq(s.auditEvents.actorId, ownerId));
    await db.delete(s.user).where(eq(s.user.id, ownerId));
  } finally {
    await p.dispose();
  }
});
test("owner MFA → provision → client autosave → fresh session → phone and keyboard", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir("work", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to your workspace" }),
  ).toBeVisible();
  await page.screenshot({
    path: "work/qa-sign-in-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Company email").fill(email);
  await page.getByLabel("Access credential").fill(password);
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.getByLabel("Confirm your owner password").fill(password);
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await page.getByText("Manual setup key").click();
  const secret = (
    await page.locator(".secret-text").first().innerText()
  ).trim();
  await page.getByLabel("Authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify & open workspace" }).click();
  await expect(
    page.getByRole("heading", {
      name: "A little clarity. A lot of possibility.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New client", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "work/qa-dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "New client", exact: true }).click();
  await page
    .getByLabel("Company name", { exact: true })
    .fill("DEMO Browser Studio");
  await page
    .getByLabel("Company email", { exact: true })
    .fill("client@browser-e2e.test");
  await page.getByLabel("Project title").fill("DEMO Browser Website");
  await page.getByRole("button", { name: "Create client workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Their workspace is ready." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reveal credential" }).click();
  const credential = (
    await page.locator(".credential-box code").innerText()
  ).trim();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /DEMO Browser Studio/ }),
  ).toBeVisible();
  const p = await proxy();
  try {
    const db = drizzle(p.env.DB);
    const company = await db
      .select()
      .from(s.companies)
      .where(eq(s.companies.email, "client@browser-e2e.test"))
      .get();
    companyId = company!.id;
    const project = await db
      .select()
      .from(s.projects)
      .where(eq(s.projects.companyId, companyId))
      .get();
    projectId = project!.id;
    const member = await db
      .select()
      .from(s.memberships)
      .where(eq(s.memberships.companyId, companyId))
      .get();
    clientId = member!.userId;
  } finally {
    await p.dispose();
  }
  const rotatedCredential = randomBytes(24).toString("hex");
  const client = await browser.newContext({ baseURL: "http://localhost:5174" });
  const clientPage = await client.newPage();
  await clientPage.goto("/");
  await clientPage.getByLabel("Company email").fill("client@browser-e2e.test");
  await clientPage.getByLabel("Access credential").fill(credential);
  await clientPage.getByRole("button", { name: "Enter workspace" }).click();
  await clientPage.getByLabel("Temporary credential").fill(credential);
  await clientPage
    .getByLabel("New credential", { exact: true })
    .fill(rotatedCredential);
  await clientPage.getByLabel("Confirm new credential").fill(rotatedCredential);
  await clientPage
    .getByRole("button", { name: "Update & open workspace" })
    .click();
  await clientPage.getByRole("button", { name: /DEMO Browser Studio/ }).click();
  await clientPage.getByLabel("Who’s editing today?").fill("DEMO Editor");
  await expect(
    clientPage.getByRole("button", { name: /Inquiry form/ }),
  ).toHaveCount(0);
  await clientPage
    .getByLabel("Business name", { exact: false })
    .fill("DEMO <script>window.xss=true</script>");
  await expect(
    clientPage.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await clientPage
    .getByLabel("Business introduction", { exact: false })
    .fill("A synthetic browser-tested introduction.");
  await expect(
    clientPage.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await clientPage
    .getByLabel("Tagline", { exact: true })
    .fill("DEMO navigation flush");
  await clientPage
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(
    clientPage.getByRole("heading", { name: "Your website starts here." }),
  ).toBeVisible();
  await clientPage.getByRole("button", { name: /DEMO Browser Studio/ }).click();
  await expect(clientPage.getByLabel("Tagline", { exact: true })).toHaveValue(
    "DEMO navigation flush",
  );
  await clientPage.screenshot({
    path: "work/qa-questionnaire-desktop.png",
    fullPage: true,
  });
  await clientPage.setViewportSize({ width: 360, height: 800 });
  await clientPage.screenshot({
    path: "work/qa-questionnaire-phone.png",
    fullPage: true,
  });
  expect(
    await clientPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await clientPage
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await client.close();
  const fresh = await browser.newContext({
    baseURL: "http://localhost:5174",
    viewport: { width: 360, height: 800 },
  });
  const resumed = await fresh.newPage();
  await resumed.goto("/");
  await resumed.getByLabel("Company email").fill("client@browser-e2e.test");
  await resumed.getByLabel("Access credential").fill(rotatedCredential);
  await resumed.getByRole("button", { name: "Enter workspace" }).click();
  await resumed.getByRole("button", { name: /DEMO Browser Studio/ }).click();
  await expect(
    resumed.getByLabel("Business name", { exact: false }),
  ).toHaveValue("DEMO <script>window.xss=true</script>");
  await expect(resumed.getByLabel("Who’s editing today?")).toHaveValue("");
  expect(await resumed.evaluate(() => "xss" in window)).toBe(false);
  await resumed.keyboard.press("Tab");
  expect(
    await resumed.evaluate(() => document.activeElement?.tagName),
  ).not.toBe("BODY");
  await resumed.screenshot({
    path: "work/qa-resumed-phone.png",
    fullPage: true,
  });
  await fresh.close();
  expect(errors).toEqual([]);
});
