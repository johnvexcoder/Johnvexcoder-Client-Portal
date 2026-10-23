import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
const time = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull();
export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    image: text("image"),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
    role: text("role", { enum: ["admin", "client"] })
      .notNull()
      .default("client"),
    twoFactorEnabled: integer("two_factor_enabled", {
      mode: "boolean",
    }).default(false),
  },
  (t) => [
    check("user_role", sql`${t.role} in ('admin','client')`),
    uniqueIndex("one_owner")
      .on(t.role)
      .where(sql`${t.role} = 'admin'`),
  ],
);
export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: time("expires_at"),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user").on(t.userId)],
);
export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
  },
  (t) => [
    index("account_user").on(t.userId),
    uniqueIndex("account_provider").on(t.providerId, t.accountId),
  ],
);
export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: time("expires_at"),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
  },
  (t) => [index("verification_identifier").on(t.identifier)],
);
export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    failedVerificationCount: integer("failed_verification_count")
      .notNull()
      .default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("two_factor_user").on(t.userId)],
);
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});
export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: time("created_at"),
  },
  (t) => [check("company_status", sql`${t.status} in ('active','archived')`)],
);
export const memberships = sqliteTable(
  "company_memberships",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    status: text("status", { enum: ["active", "suspended"] })
      .notNull()
      .default("active"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.companyId] }),
    uniqueIndex("one_company_per_login").on(t.userId),
    index("membership_company").on(t.companyId),
  ],
);
export const packageDefinitions = sqliteTable("package_definitions", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  pricePhp: integer("price_php").notNull(),
  priceNote: text("price_note"),
});
export const packageVersions = sqliteTable(
  "package_versions",
  {
    id: text("id").primaryKey(),
    definitionId: text("definition_id")
      .notNull()
      .references(() => packageDefinitions.id),
    version: integer("version").notNull(),
    config: text("config", { mode: "json" }).notNull(),
    createdAt: time("created_at"),
  },
  (t) => [uniqueIndex("package_version_unique").on(t.definitionId, t.version)],
);
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    title: text("title").notNull(),
    type: text("type", { enum: ["business", "portfolio"] }).notNull(),
    status: text("status", {
      enum: ["draft", "pending_approval", "approved", "archived"],
    })
      .notNull()
      .default("draft"),
    scopeReference: text("scope_reference"),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
  },
  (t) => [
    index("projects_company").on(t.companyId),
    index("projects_status").on(t.status),
    check("project_type", sql`${t.type} in ('business','portfolio')`),
  ],
);
export const assignments = sqliteTable(
  "project_package_assignments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    packageVersionId: text("package_version_id")
      .notNull()
      .references(() => packageVersions.id),
    category: text("category").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    assignedAt: time("assigned_at"),
    reason: text("reason").notNull(),
  },
  (t) => [uniqueIndex("one_package_per_category").on(t.projectId, t.category)],
);
export const drafts = sqliteTable(
  "questionnaire_drafts",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    section: text("section").notNull(),
    templateVersion: text("template_version").notNull().default("1.0.0"),
    answers: text("answers", { mode: "json" }).notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: time("updated_at"),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.section] }),
    check("positive_revision", sql`${t.revision} > 0`),
  ],
);
export const idleSessions = sqliteTable("idle_sessions", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => session.id, { onDelete: "cascade" }),
  lastActivityAt: time("last_activity_at"),
});
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").references(() => user.id),
    companyId: text("company_id").references(() => companies.id),
    action: text("action").notNull(),
    targetId: text("target_id").notNull(),
    createdAt: time("created_at"),
  },
  (t) => [index("audit_company_time").on(t.companyId, t.createdAt)],
);

export const accessPolicies = sqliteTable("access_policies", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  mustRotate: integer("must_rotate", { mode: "boolean" })
    .notNull()
    .default(true),
  createdAt: time("created_at"),
});
export const resetRequests = sqliteTable(
  "reset_requests",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    status: text("status", { enum: ["new", "issued", "completed", "rejected"] })
      .notNull()
      .default("new"),
    createdAt: time("created_at"),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("reset_company_status").on(t.companyId, t.status)],
);
export const credentialTokens = sqliteTable(
  "credential_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    requestId: text("request_id").references(() => resetRequests.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: time("expires_at"),
    consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
    claimId: text("claim_id"),
    createdAt: time("created_at"),
  },
  (t) => [index("credential_token_user").on(t.userId)],
);
export const portalSettings = sqliteTable("portal_settings", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: time("updated_at"),
});
export const projectControls = sqliteTable("project_controls", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id),
  revision: integer("revision").notNull().default(1),
  baselineVersion: integer("baseline_version").notNull().default(0),
  editableSections: text("editable_sections", { mode: "json" }),
  manualScope: text("manual_scope", { mode: "json" }),
  launchAt: integer("launch_at", { mode: "timestamp_ms" }),
  testUrl: text("test_url"),
  approverName: text("approver_name"),
  approverEmail: text("approver_email"),
  approverMethod: text("approver_method"),
  approverVerifiedAt: integer("approver_verified_at", { mode: "timestamp_ms" }),
});
export const scopeAmendments = sqliteTable(
  "scope_amendments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    previous: text("previous", { mode: "json" }).notNull(),
    next: text("next", { mode: "json" }).notNull(),
    reason: text("reason").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    createdAt: time("created_at"),
  },
  (t) => [index("amendment_project").on(t.projectId)],
);
export const sectionLeases = sqliteTable(
  "section_leases",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    section: text("section").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    expiresAt: time("expires_at"),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.section] })],
);
export const approvedSubmissions = sqliteTable(
  "approved_submissions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    version: integer("version").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: time("created_at"),
  },
  (t) => [uniqueIndex("submission_project_version").on(t.projectId, t.version)],
);
export const approvalChallenges = sqliteTable("approval_challenges", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  tokenHash: text("token_hash").notNull().unique(),
  draftHash: text("draft_hash").notNull(),
  controlRevision: integer("control_revision").notNull(),
  settingsRevision: integer("settings_revision").notNull(),
  expiresAt: time("expires_at"),
  consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  createdAt: time("created_at"),
});
export const inboxItems = sqliteTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind", {
      enum: ["question", "change", "issue", "note"],
    }).notNull(),
    visibility: text("visibility", { enum: ["shared", "private"] })
      .notNull()
      .default("shared"),
    section: text("section"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("new"),
    classification: text("classification"),
    size: text("size"),
    quotePhp: integer("quote_php"),
    affectedSections: text("affected_sections", { mode: "json" }),
    baselineVersion: integer("baseline_version"),
    adminReadAt: integer("admin_read_at", { mode: "timestamp_ms" }),
    clientReadAt: integer("client_read_at", { mode: "timestamp_ms" }),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
  },
  (t) => [
    index("inbox_project_updated").on(t.projectId, t.updatedAt),
    index("inbox_status_kind").on(t.status, t.kind),
  ],
);
export const inboxReplies = sqliteTable(
  "inbox_replies",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => inboxItems.id),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    authorRole: text("author_role").notNull(),
    body: text("body").notNull(),
    createdAt: time("created_at"),
  },
  (t) => [index("reply_item_time").on(t.itemId, t.createdAt)],
);
export const pageReviews = sqliteTable(
  "page_reviews",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    version: integer("version").notNull(),
    path: text("path").notNull(),
    status: text("status", {
      enum: ["not_reviewed", "matches", "needs_correction"],
    }).notNull(),
    notes: text("notes"),
    evidenceLinks: text("evidence_links", { mode: "json" }),
    updatedAt: time("updated_at"),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.version, t.path] })],
);
export const careRequests = sqliteTable(
  "care_requests",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    minutes: integer("minutes").notNull(),
    description: text("description").notNull(),
    performedAt: time("performed_at"),
  },
  (t) => [index("care_project_time").on(t.projectId, t.performedAt)],
);
export const transactionGuards = sqliteTable(
  "transaction_guards",
  { id: text("id").primaryKey(), allowed: integer("allowed").notNull() },
  (t) => [check("transaction_precondition", sql`${t.allowed}=1`)],
);
