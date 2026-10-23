import type { FieldAnswer, FieldDefinition, SectionDefinition } from "./schema";
import type { PackageConfig } from "../packages/catalog";
import { countRoutes } from "../packages/catalog";
import { safeExternalLink } from "../../lib/security";
export interface ContentItem {
  id: string;
  fields: Record<string, string>;
}
export interface ReviewIssue {
  key: string;
  section: string;
  label: string;
  kind: "missing" | "unsure";
  hard: boolean;
}
const f = (
  key: string,
  label: string,
  type: FieldDefinition["type"] = "textarea",
  help = "",
  required = false,
): FieldDefinition => ({ key, label, type, help, required });
const option = (
  key: string,
  label: string,
  options: string[],
  help = "",
  required = false,
): FieldDefinition => ({ ...f(key, label, "select", help, required), options });
const list = (
  key: string,
  label: string,
  itemFields: FieldDefinition[],
  maxItems = 30,
  required = false,
): FieldDefinition => ({
  ...f(
    key,
    label,
    "collection",
    "Add items in the order you want them on the website.",
    required,
  ),
  itemFields,
  maxItems,
});
const link = f(
  "sourceLink",
  "Original asset link",
  "url",
  "Share the raw original file, with access granted to John.",
);
const media = [
  link,
  f("filename", "Expected filename", "text"),
  f("label", "Display label", "text"),
  f("usage", "Where this asset is used", "text"),
];
const cta = [
  f("ctaLabel", "Button label", "text"),
  f("ctaDestination", "Button destination", "destination"),
];
export function extendDefinitions(sections: SectionDefinition[]) {
  const section = (id: string) => sections.find((s) => s.id === id)!;
  const append = (id: string, fields: FieldDefinition[]) =>
    section(id).fields.push(...fields);
  append("identity", [
    f("registeredName", "Registered business name", "text"),
    f("contactPerson", "Project contact person", "text"),
    list(
      "navigation",
      "Navigation links",
      [
        f("label", "Label", "text", "", true),
        f(
          "destination",
          "Page path or anchor",
          "destination",
          "For example /about or #contact.",
          true,
        ),
      ],
      30,
    ),
  ]);
  const hero = section("hero");
  hero.fields.unshift(
    option(
      "mode",
      "Hero format",
      ["single_image", "slideshow", "background_video"],
      "Choose one image, up to three slides, or one background video.",
      true,
    ),
  );
  hero.fields.find((v) => v.key === "mediaLink")!.required = true;
  hero.fields.find((v) => v.key === "mediaLink")!.visibleWhen = {
    key: "mode",
    values: ["single_image", "background_video"],
  };
  hero.fields.push(
    ...media
      .filter((v) => v.key !== "sourceLink")
      .map((v) => ({
        ...v,
        required: v.key === "filename",
        visibleWhen: {
          key: "mode",
          values: ["single_image", "background_video"],
        },
      })),
    ...cta,
    {
      ...list(
        "slides",
        "Hero slides",
        [
          ...media.map((m) => ({
            ...m,
            required: ["sourceLink", "filename"].includes(m.key),
          })),
          f("headline", "Headline", "text", "", true),
          f("support", "Supporting text"),
          ...cta,
        ],
        3,
        true,
      ),
      visibleWhen: { key: "mode", values: ["slideshow"] },
    },
  );
  section("home").fields = section("home").fields.filter(
    (v) => v.key !== "highlights",
  );
  append("home", [
    f("mediaLink", "Introduction image link", "url"),
    list(
      "highlights",
      "Homepage highlights",
      [
        f("label", "Highlight title", "text", "", true),
        f("details", "Details"),
      ],
      4,
    ),
    ...cta,
  ]);
  section("services").description =
    "Add services or products, choose card-only or a separate detail page, and arrange their order.";
  append("services", [
    list(
      "items",
      "Services and products",
      [
        f("name", "Service or product name", "text", "", true),
        f("summary", "Short description", "textarea", "", true),
        option("display", "Display as", ["card", "page"]),
        f(
          "route",
          "Detail page path",
          "routes",
          "Required when this item has its own page.",
        ),
        f("description", "Full description"),
        f("price", "Price or Contact for Quote", "text"),
        ...media,
        option("featured", "Featured service", ["no", "yes"]),
        f("benefits", "Benefits"),
        f("gallery", "Gallery share links", "links"),
        f("faq", "Questions and answers"),
        ...cta,
      ],
      40,
    ),
  ]);
  append("about", [
    f("history", "History"),
    f("mission", "Mission"),
    f("mainPhoto", "Main company photo", "url"),
    list(
      "team",
      "Team members",
      [
        f("name", "Name", "text", "", true),
        f("role", "Role", "text"),
        f("bio", "Biography"),
        f("photo", "Photo share link", "url"),
      ],
      30,
    ),
    list(
      "credibility",
      "Licenses, awards and evidence",
      [
        f("title", "Title", "text", "", true),
        f("details", "Details"),
        f("evidence", "Evidence link", "url"),
      ],
      30,
    ),
  ]);
  append("contact", [
    f("hours", "Business hours", "text"),
    f("mapUrl", "Google Maps link", "url"),
    option("mapDisplay", "Map preference", ["link", "embedded", "none"]),
    list(
      "social",
      "Social profiles",
      [
        f("label", "Platform", "text", "", true),
        f("url", "Profile link", "url", "", true),
      ],
      15,
    ),
    f("whatsapp", "WhatsApp link", "url"),
    f("messenger", "Messenger link", "url"),
    ...cta,
  ]);
  append("footer", [
    f("copyright", "Copyright wording", "text"),
    list(
      "quickLinks",
      "Footer links",
      [
        f("label", "Label", "text", "", true),
        f("destination", "Destination", "destination", "", true),
      ],
      20,
    ),
    list(
      "legalPages",
      "Client-supplied legal pages",
      [
        f("title", "Page title", "text", "", true),
        f("route", "Page path", "routes", "", true),
        f("content", "Client-supplied or professionally reviewed wording"),
        f("reference", "Source document link", "url"),
      ],
      10,
    ),
  ]);
  append("theme", [
    option("colorMode", "Color direction", [
      "from_logo",
      "manual",
      "developer_choice",
    ]),
    f("mainColor", "Main color", "color"),
    f("accentColor", "Accent color", "color"),
    f("backgroundColor", "Background color", "color"),
    f("fonts", "Font preferences", "text"),
    f("keywords", "Style keywords", "text"),
    f("guidelines", "Brand guidelines link", "url"),
    f("disliked", "Examples to avoid", "links"),
  ]);
  append("logo", [
    f("filename", "Expected logo filename", "text"),
    option("format", "Original format", [
      "SVG",
      "AI",
      "EPS",
      "PNG",
      "JPG",
      "PDF",
      "other",
    ]),
    option("background", "Background treatment", [
      "preserve",
      "remove",
      "unsure",
    ]),
    option("recolor", "Recoloring permission", ["no", "yes", "ask_first"]),
    f("restrictions", "Brand restrictions"),
    f(
      "optimizations",
      "Requested web optimizations",
      "textarea",
      "Original assets stay untouched. Vector artwork may stay vector; WebP is for raster derivatives.",
    ),
  ]);
  append("media", [
    list(
      "assets",
      "Asset links",
      [
        ...media.map((m) => ({
          ...m,
          required: ["sourceLink", "filename", "usage"].includes(m.key),
        })),
        f("folder", "Folder reference", "text"),
      ],
      60,
    ),
  ]);
  section("media").fields.find((v) => v.key === "permissions")!.type =
    "checkbox";
  append("profile", [
    f("role", "Professional role", "text"),
    f("portrait", "Portrait link", "url"),
    f("resume", "Resume share link", "url"),
  ]);
  section("portfolio").description =
    "Add the projects or full-screen case studies included in your package.";
  section("portfolio").fields.find((v) => v.key === "titles")!.required = false;
  append("portfolio", [
    list(
      "projects",
      "Projects or case studies",
      [
        f("title", "Project title", "text", "", true),
        f("role", "Your role", "text"),
        f("summary", "Short description", "textarea", "", true),
        f("description", "Case study narrative"),
        f("stack", "Tools and technologies", "text"),
        f("liveUrl", "Live website", "url"),
        f("sourceUrl", "Source or further reading", "url"),
        ...media,
        f("gallery", "Additional image links", "links"),
        f("outcomes", "Outcomes you can substantiate"),
        f("layout", "Preferred case study structure"),
      ],
      6,
      true,
    ),
  ]);
  append("experience", [
    list(
      "roles",
      "Experience entries",
      [
        f("role", "Role", "text", "", true),
        f("organization", "Organization", "text"),
        f("dates", "Dates", "text"),
        f("description", "Description"),
      ],
      30,
    ),
  ]);
  append("testimonials", [
    list(
      "items",
      "Testimonials",
      [
        f("quote", "Exact quote", "textarea", "", true),
        f("attribution", "Attribution", "text", "", true),
        option(
          "permission",
          "Permission to publish",
          ["no", "yes"],
          "Use only quotes you have permission to publish.",
          true,
        ),
      ],
      20,
    ),
  ]);
  append("inquiry", [
    option("purpose", "Form purpose", [
      "inquiry",
      "quotation",
      "service_request",
    ]),
    list(
      "questions",
      "Visitor form fields",
      [
        f("label", "Question label", "text", "", true),
        option("type", "Field type", [
          "short_text",
          "long_text",
          "email",
          "phone",
          "select",
          "checkbox",
          "date",
        ]),
        f("options", "Select options, one per line"),
        option("required", "Required field", ["yes", "no"]),
      ],
      30,
    ),
    f("process", "What happens after a request is received"),
  ]);
  append("reservation", [
    f("services", "Reservable services"),
    f("dates", "Preferred date rules"),
    f("customerDetails", "Customer details to request"),
    f(
      "confirmation",
      "Manual confirmation instructions",
      "textarea",
      "A request is not a confirmed booking.",
      true,
    ),
  ]);
  append("booking", [
    f("availability", "Availability and calendar rules"),
    f("inventory", "Inventory requirements"),
    f("payments", "Payment requirements and responsibilities"),
    f("notifications", "Notifications in the approved manual scope"),
    f("integrations", "Approved integrations and owner access requirements"),
  ]);
  append("workflow", [
    f("acknowledgement", "Sender acknowledgement requirements"),
    f("teamCopies", "Team notification recipients"),
    f("references", "Reference number requirements"),
    f("attachments", "Future delivered-site attachment requirements"),
    f("history", "Request activity/history requirements"),
  ]);
  sections.push(
    {
      id: "cms",
      title: "CMS editable sections",
      description:
        "Choose the parts staff should edit on the delivered website. These are not portal account seats.",
      fields: [
        f("catalogCategories", "Product/service categories and specifications"),
        f("catalogPublishing", "Draft and published content rules"),
        f("catalogFilters", "Catalog search and filter requirements"),
        f("catalogPricing", "Price display and Contact for Quote rules"),
        {
          ...f(
            "sections",
            "Editable sections",
            "multi",
            "Only sections allowed by your assigned CMS package can be selected.",
          ),
          options: [
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
            "portfolio",
            "experience",
            "testimonials",
          ],
        },
      ],
    },
    {
      id: "seo",
      title: "SEO priority URLs",
      description:
        "Optional priority pages covered by your ongoing SEO assignment.",
      fields: [
        f(
          "urls",
          "Priority URLs",
          "links",
          "One HTTPS URL per line; your assigned service cap applies.",
        ),
      ],
    },
  );
}
export function activeFields(
  section: SectionDefinition,
  fields: Record<string, FieldAnswer>,
): FieldDefinition[] {
  return section.fields.filter(
    (f) =>
      !f.visibleWhen ||
      f.visibleWhen.values.includes(
        fields[f.visibleWhen.key]?.value || "single_image",
      ),
  );
}
export function parseItems(value: string): ContentItem[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (v) =>
        !v ||
        typeof v !== "object" ||
        typeof v.id !== "string" ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(v.id) ||
        !v.fields ||
        typeof v.fields !== "object" ||
        Array.isArray(v.fields) ||
        Object.values(v.fields).some((v) => typeof v !== "string"),
    )
  )
    throw new Error("Invalid structured items.");
  const items = parsed as ContentItem[];
  if (
    items.some((v) => Object.keys(v).some((k) => !["id", "fields"].includes(k)))
  )
    throw new Error("Unsupported item metadata.");
  if (new Set(items.map((v) => v.id)).size !== items.length)
    throw new Error("Each item needs its own stable ID.");
  return items;
}
export function destination(value: string) {
  if (!value) return;
  if (value.startsWith("#")) {
    if (!/^#[a-zA-Z][\w-]*$/.test(value))
      throw new Error("Use a valid section anchor.");
  } else if (value.startsWith("/")) countRoutes([value]);
  else safeExternalLink(value);
}
function validateScalar(field: FieldDefinition, value: string) {
  if (value.length > 12000) throw new Error("An item is too long.");
  if (!value.trim()) return;
  if (field.type === "url") safeExternalLink(value);
  if (field.type === "destination") destination(value);
  if (field.type === "routes") countRoutes(value.split("\n"));
  if (field.type === "links") {
    const links = value
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean);
    if (links.length > 60) throw new Error("Too many links.");
    links.forEach(safeExternalLink);
  }
  if (
    field.key === "email" &&
    value.split(/[\n,;]+/).some((v) => !/^\S+@\S+\.\S+$/.test(v.trim()))
  )
    throw new Error("Use valid contact email addresses.");
  if (field.type === "color" && !/^#[a-f\d]{6}$/i.test(value))
    throw new Error("Use a six-digit hex color, such as #142B4B.");
  if (field.type === "select" && !field.options?.includes(value))
    throw new Error("Choose one of the listed options.");
  if (field.type === "checkbox" && !["yes", "no"].includes(value))
    throw new Error("Use the confirmation checkbox.");
}
export function validateContentField(
  field: FieldDefinition,
  answer: FieldAnswer,
  config: PackageConfig,
  sectionId: string,
) {
  if (answer.status !== "provided") return;
  if (field.type === "collection") {
    const items = parseItems(answer.value);
    const cap =
      sectionId === "portfolio" && field.key === "projects"
        ? (config.maxProjects ?? 0)
        : (field.maxItems ?? 30);
    if (items.length > cap)
      throw new Error(
        `Your package allows up to ${cap} ${field.label.toLowerCase()}.`,
      );
    for (const item of items) {
      for (const [key, value] of Object.entries(item.fields)) {
        const def = field.itemFields?.find((f) => f.key === key);
        if (!def) throw new Error("An item contains an unsupported field.");
        validateScalar(def, value);
        if (
          key === "route" &&
          value.split("\n").filter((v) => v.trim()).length > 1
        )
          throw new Error("Each item has a single detail-page path.");
      }
      if (
        sectionId === "testimonials" &&
        item.fields.permission &&
        item.fields.permission !== "yes"
      )
        throw new Error(
          "Only include testimonials with permission to publish.",
        );
    }
  } else if (field.type === "multi") {
    const selected: unknown = JSON.parse(answer.value);
    if (
      !Array.isArray(selected) ||
      selected.some(
        (v) => typeof v !== "string" || !field.options?.includes(v),
      ) ||
      new Set(selected).size !== selected.length
    )
      throw new Error("Choose from the listed editable sections.");
    if (
      config.editableSections !== null &&
      config.editableSections !== undefined &&
      selected.length > config.editableSections
    )
      throw new Error(
        `Your CMS includes ${config.editableSections} editable sections.`,
      );
  } else {
    validateScalar(field, answer.value);
    if (
      sectionId === "seo" &&
      field.key === "urls" &&
      answer.value.split("\n").filter((v) => v.trim()).length >
        (config.priorityUrls ?? 0)
    )
      throw new Error(
        `Your SEO service includes up to ${config.priorityUrls ?? 0} priority URLs.`,
      );
  }
}
export function routePaths(
  saved: Record<string, Record<string, FieldAnswer>>,
): string[] {
  const values =
    saved.pages?.routes?.status === "provided"
      ? saved.pages.routes.value.split("\n")
      : [];
  for (const [section, key] of [
    ["services", "items"],
    ["footer", "legalPages"],
  ] as const) {
    const field = saved[section]?.[key];
    if (field?.status !== "provided") continue;
    for (const item of parseItems(field.value)) {
      if (section === "services" && item.fields.display !== "page") continue;
      if (item.fields.route) values.push(item.fields.route);
    }
  }
  const routes = new Set<string>();
  for (const v of values) {
    if (!v.trim() || v.trim().startsWith("#")) continue;
    countRoutes([v]);
    routes.add(
      new URL(v, "https://route.test").pathname.replace(/\/+$/, "") || "/",
    );
  }
  return [...routes];
}
export function validateProjectContent(
  saved: Record<string, Record<string, FieldAnswer>>,
  config: PackageConfig,
) {
  if (new TextEncoder().encode(JSON.stringify(saved)).byteLength > 512000)
    throw new Error(
      "This brief exceeds the 500 KB content limit. Use external document references for lengthy source material.",
    );
  const count = routePaths(saved).length;
  if (config.maxPages !== null && count > config.maxPages)
    throw new Error(
      `Your package includes up to ${config.maxPages} website pages; this draft contains ${count}.`,
    );
}
export function fieldComplete(
  field: FieldDefinition,
  answer: FieldAnswer | undefined,
): boolean {
  if (!answer || answer.status !== "provided" || !answer.value.trim())
    return false;
  if (field.type === "checkbox") return answer.value === "yes";
  if (field.type === "collection") {
    try {
      const items = parseItems(answer.value);
      return (
        items.length > 0 &&
        items.every(
          (item) =>
            (field.itemFields ?? [])
              .filter((f) => f.required)
              .every((f) => item.fields[f.key]?.trim()) &&
            (item.fields.display !== "page" || !!item.fields.route),
        )
      );
    } catch {
      return false;
    }
  }
  return true;
}
export function reviewIssues(
  sections: SectionDefinition[],
  saved: Record<string, Record<string, FieldAnswer>>,
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const s of sections) {
    const fields = saved[s.id] ?? {};
    for (const f of activeFields(s, fields)) {
      const a = fields[f.key];
      if (a?.status === "unsure")
        issues.push({
          key: `${s.id}.${f.key}`,
          section: s.id,
          label: f.label,
          kind: "unsure",
          hard: ["name", "email", "routes"].includes(f.key),
        });
      else if (f.required && !fieldComplete(f, a))
        issues.push({
          key: `${s.id}.${f.key}`,
          section: s.id,
          label: f.label,
          kind: "missing",
          hard: true,
        });
      else if (a?.status === "provided" && f.type === "collection") {
        for (const item of parseItems(a.value))
          for (const itemField of f.itemFields ?? [])
            if (itemField.required && !item.fields[itemField.key]?.trim())
              issues.push({
                key: `${s.id}.${f.key}.${item.id}.${itemField.key}`,
                section: s.id,
                label: `${f.label}: ${itemField.label}`,
                kind: "missing",
                hard: true,
              });
      }
    }
  }
  const mediaSections = [
    "hero",
    "home",
    "services",
    "about",
    "logo",
    "media",
    "profile",
    "portfolio",
  ];
  const sharedMedia = mediaSections.some((id) =>
    Object.entries(saved[id] ?? {}).some(
      ([key, a]) =>
        a.status === "provided" &&
        /https:\/\//.test(a.value) &&
        !["liveUrl", "sourceUrl"].includes(key),
    ),
  );
  if (sharedMedia && saved.media?.permissions?.value !== "yes")
    issues.push({
      key: "media.permissions",
      section: "media",
      label: "Confirm access to shared original media",
      kind: "missing",
      hard: true,
    });
  for (const section of sections)
    for (const f of activeFields(section, saved[section.id] ?? {})) {
      const a = saved[section.id]?.[f.key];
      if (f.type !== "collection" || a?.status !== "provided") continue;
      const items = parseItems(a.value);
      if (
        section.id === "home" &&
        f.key === "highlights" &&
        items.length > 0 &&
        items.length < 3
      )
        issues.push({
          key: "home.highlights",
          section: "home",
          label: "Provide three or four homepage highlights",
          kind: "missing",
          hard: true,
        });
      for (const item of items)
        if (item.fields.display === "page")
          for (const key of ["route", "description"])
            if (!item.fields[key]?.trim())
              issues.push({
                key: `${section.id}.${f.key}.${item.id}.${key}`,
                section: section.id,
                label: "Detail-page path and full description",
                kind: "missing",
                hard: true,
              });
    }
  return issues;
}
