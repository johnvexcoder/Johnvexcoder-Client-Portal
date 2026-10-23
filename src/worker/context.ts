import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { Env } from "../features/auth/auth";
import * as s from "../db/schema";
import { canAccessProject } from "../lib/security";
import {
  resolveEntitlements,
  type PackageConfig,
  type ManualScope,
} from "../features/packages/catalog";
import { allowedSections } from "../features/questionnaire/schema";
export type Actor = {
  id: string;
  email: string;
  role: string;
  companyId: string | null;
  sessionId: string;
  twoFactorEnabled: boolean;
  lastActivityAt: number;
  authenticatedAt: number;
  mustRotate: boolean;
};
export type AppEnv = { Bindings: Env; Variables: { actor: Actor } };
export function admin(c: Context<AppEnv>) {
  const actor = c.get("actor");
  if (actor.role !== "admin")
    throw new HTTPException(403, { message: "Administrator access required." });
  if (!actor.twoFactorEnabled)
    throw new HTTPException(403, {
      message: "Set up and verify your authenticator before managing clients.",
    });
  return actor;
}
export async function projectContext(c: Context<AppEnv>, id: string) {
  const db = drizzle(c.env.DB);
  const project = await db
    .select()
    .from(s.projects)
    .where(eq(s.projects.id, id))
    .get();
  const actor = c.get("actor");
  if (
    !project ||
    !canAccessProject(actor.role, actor.companyId, project.companyId)
  )
    throw new HTTPException(404, { message: "Project not found." });
  if (actor.role === "admin") admin(c);
  const assigned = await db
    .select()
    .from(s.assignments)
    .where(eq(s.assignments.projectId, id));
  const base = assigned.find(
    (a) => a.category === "website" || a.category === "portfolio",
  );
  if (!base)
    throw new HTTPException(409, {
      message: "This project needs a package assignment.",
    });
  const control = await db
    .select()
    .from(s.projectControls)
    .where(eq(s.projectControls.projectId, id))
    .get();
  const config = resolveEntitlements(
    base.snapshot as PackageConfig,
    assigned.find((a) => a.category === "cms")?.snapshot as
      PackageConfig | undefined,
    control?.manualScope as ManualScope | undefined,
  );
  const seo = assigned.find((a) => a.category === "seo")?.snapshot as
    PackageConfig | undefined;
  const cms = assigned.find((a) => a.category === "cms")?.snapshot as
    PackageConfig | undefined;
  const effective = {
    ...config,
    priorityUrls: seo?.priorityUrls,
    editableSections: cms?.editableSections,
    seats: cms?.seats,
    catalog: cms?.catalog,
  };
  return {
    project,
    assigned,
    config: effective,
    control,
    sections: allowedSections(effective),
  };
}

export function recentAdmin(c: Context<AppEnv>) {
  const actor = admin(c);
  if (Date.now() - actor.authenticatedAt > 15 * 60_000)
    throw new HTTPException(403, {
      message:
        "Sign out and sign in with your authenticator again before this sensitive action.",
    });
  return actor;
}
