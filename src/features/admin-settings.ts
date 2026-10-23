import { z } from "zod";
import { safeExternalLink } from "../lib/security";
export const settingsSchema = z
  .object({
    welcomeTemplate: z
      .string()
      .min(10)
      .max(6000)
      .refine(
        (v) => !/{{\s*(password|token|credential|secret)/i.test(v),
        "Keep credentials out of welcome drafts.",
      ),
    supportEmail: z.union([z.literal(""), z.email()]),
    supportPhone: z.string().max(80),
    facebook: z.string().max(2048),
    whatsapp: z.string().max(2048),
    portfolio: z.string().max(2048),
    appearOffline: z.boolean(),
    privacyNoticeText: z.string().max(20000),
    privacyNoticeVersion: z.string().trim().max(100),
    portalTermsText: z.string().max(20000),
    portalTermsVersion: z.string().trim().max(100),
    policiesPublished: z.boolean(),
    termsText: z.string().max(12000),
    termsVersion: z.string().max(100),
    verificationProtocol: z.string().max(3000),
    termsApproved: z.boolean(),
    approvedRetentionDays: z.number().int().min(1).max(36500).nullable(),
    messageRetentionDays: z.number().int().min(1).max(36500).nullable(),
    archivedRetentionDays: z.number().int().min(1).max(36500).nullable(),
    backupCadenceDays: z.number().int().min(1).max(7).nullable(),
    cmsCaps: z
      .object({
        controlcore: z.number().int().min(1).max(100).nullable(),
        cataloglayer: z.number().int().min(1).max(100).nullable(),
        workflowdesk: z.number().int().min(1).max(100).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const key of ["facebook", "whatsapp", "portfolio"] as const) {
      try {
        safeExternalLink(v[key]);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Use an HTTPS support link.",
        });
      }
    }
    if (
      v.policiesPublished &&
      (!v.privacyNoticeText.trim() ||
        !v.privacyNoticeVersion ||
        !v.portalTermsText.trim() ||
        !v.portalTermsVersion)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Both portal policies need owner-reviewed text and a version before publication.",
      });
    if (
      v.termsApproved &&
      (!v.termsText.trim() ||
        !v.termsVersion.trim() ||
        !v.verificationProtocol.trim())
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Approval text, terms version and independent verification procedure are required.",
      });
  });
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  welcomeTemplate:
    "Hello {{company}}, your website planning workspace is ready at {{portalUrl}}. Sign in using {{email}}. John will share the access credential separately.",
  supportEmail: "",
  supportPhone: "",
  facebook: "",
  whatsapp: "",
  portfolio: "",
  appearOffline: false,
  privacyNoticeText: "",
  privacyNoticeVersion: "",
  portalTermsText: "",
  portalTermsVersion: "",
  policiesPublished: false,
  termsText: "",
  termsVersion: "",
  verificationProtocol: "",
  termsApproved: false,
  archivedRetentionDays: null,
  approvedRetentionDays: null,
  messageRetentionDays: null,
  backupCadenceDays: null,
  cmsCaps: { controlcore: null, cataloglayer: null, workflowdesk: null },
};
export function setupGaps(settings: Settings) {
  return [
    !settings.policiesPublished
      ? "Published Privacy Notice and portal Terms of Use"
      : null,
    !settings.termsApproved ? "Owner-approved agreement wording" : null,
    !settings.verificationProtocol.trim()
      ? "Independent approver verification procedure"
      : null,
    settings.approvedRetentionDays == null
      ? "Approved-content retention period"
      : null,
    settings.messageRetentionDays == null
      ? "Client-message retention period"
      : null,
    settings.archivedRetentionDays == null
      ? "Archived-data retention period"
      : null,
    settings.backupCadenceDays === null ? "Backup cadence" : null,
  ].filter(Boolean) as string[];
}
