import { z } from "zod";
import {
  extendDefinitions,
  validateContentField,
  activeFields,
  fieldComplete,
} from "./content-model";
import { countRoutes, type PackageConfig } from "../packages/catalog";
import { safeExternalLink } from "../../lib/security";
export const sectionNames = [
  "identity",
  "hero",
  "home",
  "services",
  "about",
  "contact",
  "footer",
  "theme",
  "logo",
  "media",
  "pages",
  "profile",
  "portfolio",
  "experience",
  "testimonials",
  "inquiry",
  "reservation",
  "booking",
  "workflow",
  "cms",
  "seo",
] as const;
export type SectionName = (typeof sectionNames)[number];
export const fieldSchema = z
  .object({
    value: z.string().max(50000),
    status: z.enum(["provided", "skipped", "unsure", "not_applicable"]),
  })
  .strict()
  .refine(
    (f) => f.status !== "provided" || f.value.trim().length > 0,
    "Provide an answer or choose a different status.",
  );
export const sectionSchema = z
  .object({
    revision: z.number().int().min(0),
    fields: z
      .record(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,49}$/), fieldSchema)
      .refine((f) => Object.keys(f).length <= 60, "Too many fields."),
  })
  .strict();
export type FieldAnswer = z.infer<typeof fieldSchema>;
export interface FieldDefinition {
  key: string;
  label: string;
  help: string;
  required?: boolean;
  type?:
    | "text"
    | "url"
    | "textarea"
    | "routes"
    | "destination"
    | "select"
    | "collection"
    | "checkbox"
    | "color"
    | "links"
    | "multi";
  options?: string[];
  itemFields?: FieldDefinition[];
  maxItems?: number;
  visibleWhen?: { key: string; values: string[] };
}
export interface SectionDefinition {
  id: SectionName;
  title: string;
  description: string;
  fields: FieldDefinition[];
}
const text = (
  key: string,
  label: string,
  help: string,
  required = false,
  type: FieldDefinition["type"] = "textarea",
): FieldDefinition => ({ key, label, help, required, type });
export const definitions: SectionDefinition[] = [
  {
    id: "identity",
    title: "Company identity",
    description: "Start with the details that make your business yours.",
    fields: [
      text(
        "name",
        "Business name",
        "Use the name you want visitors to see.",
        true,
      ),
      text("tagline", "Tagline", "A short line about what you do."),
      text(
        "description",
        "Business introduction",
        "Explain your business in two or three sentences.",
        true,
      ),
    ],
  },
  {
    id: "profile",
    title: "Your introduction",
    description: "Help visitors understand who you are and what you do.",
    fields: [
      text("name", "Display name", "Your professional name.", true),
      text(
        "headline",
        "Headline",
        "For example: an independent designer focused on thoughtful digital experiences.",
        true,
      ),
      text(
        "bio",
        "Short biography",
        "Share your background in your own words.",
      ),
    ],
  },
  {
    id: "hero",
    title: "First impression",
    description: "Plan the first thing a visitor sees on your homepage.",
    fields: [
      text(
        "headline",
        "Main headline",
        "One clear idea to lead the page.",
        true,
      ),
      text("support", "Supporting text", "Add context to your headline."),
      text(
        "mediaLink",
        "Hero image share link",
        "Link to the original file; do not upload here.",
        false,
        "url",
      ),
    ],
  },
  {
    id: "home",
    title: "Homepage content",
    description: "Introduce your work and the reasons people choose you.",
    fields: [
      text(
        "intro",
        "Welcome introduction",
        "Describe what makes your work useful.",
        true,
      ),
      text(
        "highlights",
        "Highlights",
        "List three or four key strengths, in your preferred order.",
      ),
    ],
  },
  {
    id: "services",
    title: "Services & products",
    description:
      "Outline what you offer. Structured service cards arrive in the next milestone.",
    fields: [
      text("heading", "Section heading", "For example: How we can help."),
      text(
        "summary",
        "Service overview",
        "List your services and what each one includes.",
        true,
      ),
    ],
  },
  {
    id: "about",
    title: "Your story",
    description: "Share the background and values behind your business.",
    fields: [
      text(
        "story",
        "Company story",
        "Share facts you want on the website.",
        true,
      ),
      text(
        "values",
        "Mission & values",
        "Leave unsure if you would like to discuss these.",
      ),
    ],
  },
  {
    id: "contact",
    title: "Contact details",
    description: "Choose how future website visitors can reach you.",
    fields: [
      text(
        "email",
        "Contact email",
        "Business contact information for your website.",
        true,
      ),
      text(
        "phone",
        "Phone & opening hours",
        "Include country code and your preferred contact hours.",
      ),
      text(
        "address",
        "Business address",
        "Only information you want displayed publicly.",
      ),
    ],
  },
  {
    id: "footer",
    title: "Footer & legal",
    description: "Provide footer wording and references for legal content.",
    fields: [
      text("blurb", "Footer introduction", "A short line about your business."),
      text(
        "legal",
        "Legal wording or review notes",
        "Use client-supplied or professionally reviewed wording.",
      ),
    ],
  },
  {
    id: "theme",
    title: "Look & feel",
    description:
      "Share a direction. This reference is not your final website design.",
    fields: [
      text(
        "direction",
        "Style preferences",
        "Describe a mood, colors or fonts you like.",
      ),
      text(
        "inspiration",
        "Inspiration link",
        "A website whose style you appreciate.",
        false,
        "url",
      ),
    ],
  },
  {
    id: "logo",
    title: "Your logo",
    description: "Share the original asset. Your original will stay untouched.",
    fields: [
      text(
        "sourceLink",
        "Original logo share link",
        "Use SVG, AI, EPS or an original raster file.",
        false,
        "url",
      ),
      text(
        "instructions",
        "Logo instructions",
        "Filename, format, background removal, recoloring permissions and restrictions.",
      ),
    ],
  },
  {
    id: "media",
    title: "Media links",
    description: "Keep original images and videos in your own shared folders.",
    fields: [
      text(
        "folderLink",
        "Master media folder",
        "Suggested folders: hero, logo, about, services and gallery.",
        false,
        "url",
      ),
      text(
        "permissions",
        "Access confirmation",
        "Confirm that John can open your links without requesting access.",
      ),
    ],
  },
  {
    id: "pages",
    title: "Website pages",
    description:
      "Each website path counts once. Homepage anchors do not create a new page.",
    fields: [
      text(
        "routes",
        "Page paths",
        "One local path per line, for example /, /about, /contact. Include detail and legal pages.",
        true,
        "routes",
      ),
    ],
  },
  {
    id: "portfolio",
    title: "Selected projects",
    description:
      "Project titles and notes. Structured case studies arrive in the next milestone.",
    fields: [
      text(
        "titles",
        "Project titles",
        "One project title per line; your purchased limit is enforced.",
        true,
      ),
      text(
        "notes",
        "Project notes",
        "Your role, descriptions, source links and outcomes you can substantiate.",
      ),
    ],
  },
  {
    id: "experience",
    title: "Experience",
    description: "List relevant professional experience.",
    fields: [
      text(
        "history",
        "Experience & background",
        "Include roles, organizations and dates you want to publish.",
      ),
    ],
  },
  {
    id: "testimonials",
    title: "Testimonials",
    description: "Only share quotes you have permission to publish.",
    fields: [
      text(
        "quotes",
        "Approved testimonials",
        "Include attribution and permission details.",
      ),
    ],
  },
  {
    id: "inquiry",
    title: "Inquiry form",
    description:
      "Requirements for the form on your future website. This portal does not send visitor emails.",
    fields: [
      text(
        "fields",
        "Questions to ask visitors",
        "List ordinary inquiry, quotation or service-request fields.",
        true,
      ),
      text(
        "recipients",
        "Recipient details",
        "Specify where future website submissions should go.",
      ),
    ],
  },
  {
    id: "reservation",
    title: "Reservation requests",
    description:
      "Requests require manual confirmation; this does not promise real-time availability.",
    fields: [
      text(
        "details",
        "Reservation information",
        "List requested service, preferred dates and customer details.",
        true,
      ),
    ],
  },
  {
    id: "booking",
    title: "Custom booking scope",
    description: "Only the explicitly approved manual scope applies.",
    fields: [
      text(
        "requirements",
        "Approved booking requirements",
        "Reference John’s written project-specific scope.",
        true,
      ),
    ],
  },
  {
    id: "workflow",
    title: "CMS request workflow",
    description:
      "Future delivered-site workflows require separately configured email infrastructure.",
    fields: [
      text(
        "statuses",
        "Statuses & recipients",
        "Describe request stages, team copies and acknowledgements.",
        true,
      ),
    ],
  },
];
extendDefinitions(definitions);
export function allowedSections(config: PackageConfig): SectionDefinition[] {
  const base =
    config.category === "portfolio"
      ? [
          "profile",
          "hero",
          "portfolio",
          ...(config.id === "profilecore"
            ? []
            : ["experience", "testimonials"]),
          "contact",
          "footer",
          "theme",
          "logo",
          "media",
          "pages",
        ]
      : [
          "identity",
          "hero",
          "home",
          "services",
          "about",
          "contact",
          "footer",
          "theme",
          "logo",
          "media",
          "pages",
        ];
  if (config.inquiry) base.push("inquiry");
  if (config.reservation) base.push("reservation");
  if (config.booking) base.push("booking");
  if (config.workflow) base.push("workflow");
  if (config.seats) base.push("cms");
  if (config.priorityUrls) base.push("seo");
  return base.map((id) => {
    const section = definitions.find((s) => s.id === id)!;
    if (id !== "cms") return section;
    return {
      ...section,
      fields: section.fields
        .filter((f) => config.catalog || !f.key.startsWith("catalog"))
        .map((f) =>
          f.type === "multi"
            ? { ...f, options: f.options?.filter((key) => base.includes(key)) }
            : f,
        ),
    };
  });
}
export function validateFields(
  section: SectionDefinition,
  fields: Record<string, FieldAnswer>,
  config: PackageConfig,
): void {
  for (const [key, answer] of Object.entries(fields)) {
    const field = section.fields.find((f) => f.key === key);
    if (!field) throw new Error("Unknown field.");
    validateContentField(field, answer, config, section.id);
    if (answer.status !== "provided") continue;
    if (field.type === "url") safeExternalLink(answer.value);
    if (field.type === "routes") {
      const count = countRoutes(answer.value.split("\n"));
      if (config.maxPages !== null && count > config.maxPages)
        throw new Error(
          `Your package includes up to ${config.maxPages} website pages.`,
        );
      if (config.id === "bookingsuite" && config.maxPages === null)
        throw new Error(
          "John must approve a page cap in your manual scope first.",
        );
    }
    if (
      section.id === "portfolio" &&
      key === "titles" &&
      config.maxProjects !== undefined &&
      answer.value.split("\n").filter((s) => s.trim()).length >
        config.maxProjects
    )
      throw new Error(
        `Your package includes up to ${config.maxProjects} projects.`,
      );
  }
}
export function completion(
  sections: SectionDefinition[],
  saved: Record<string, Record<string, FieldAnswer>>,
): number {
  const required = sections.flatMap((s) =>
    activeFields(s, saved[s.id] ?? {})
      .filter((f) => f.required)
      .map((f) => ({ field: f, answer: saved[s.id]?.[f.key] })),
  );
  return required.length
    ? Math.round(
        (required.filter((v) => fieldComplete(v.field, v.answer)).length /
          required.length) *
          100,
      )
    : 0;
}
