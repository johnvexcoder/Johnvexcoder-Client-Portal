export type PackageCategory = "website" | "portfolio" | "cms" | "seo" | "care";
export interface PackageConfig {
  id: string;
  name: string;
  category: PackageCategory;
  pricePhp: number;
  priceNote?: string;
  maxPages: number | null;
  minPages?: number;
  maxProjects?: number;
  seats?: number;
  editableSections?: number | null;
  priorityUrls?: number;
  inquiry?: boolean;
  reservation?: boolean;
  booking?: boolean;
  workflow?: boolean;
  catalog?: boolean;
  careMonths?: number;
}
export const catalog: readonly PackageConfig[] = [
  {
    id: "webcore",
    name: "WebCore",
    category: "website",
    pricePhp: 10000,
    maxPages: 4,
  },
  {
    id: "growthlayer",
    name: "GrowthLayer",
    category: "website",
    pricePhp: 15500,
    maxPages: 7,
    minPages: 5,
    inquiry: true,
    careMonths: 12,
  },
  {
    id: "reserveflow",
    name: "ReserveFlow",
    category: "website",
    pricePhp: 20000,
    maxPages: 7,
    minPages: 5,
    inquiry: true,
    reservation: true,
    careMonths: 12,
  },
  {
    id: "bookingsuite",
    name: "BookingSuite",
    category: "website",
    pricePhp: 40000,
    priceNote: "Starts at; written manual scope required",
    maxPages: null,
    careMonths: 12,
  },
  {
    id: "profilecore",
    name: "ProfileCore",
    category: "portfolio",
    pricePhp: 3500,
    maxPages: 1,
    maxProjects: 3,
  },
  {
    id: "identitylayer",
    name: "IdentityLayer",
    category: "portfolio",
    pricePhp: 6000,
    maxPages: null,
    maxProjects: 5,
  },
  {
    id: "showcaseflow",
    name: "ShowcaseFlow",
    category: "portfolio",
    pricePhp: 10000,
    maxPages: null,
    maxProjects: 6,
  },
  {
    id: "signature-interface",
    name: "Signature Interface",
    category: "portfolio",
    pricePhp: 16500,
    maxPages: null,
    maxProjects: 4,
    priceNote: "Full-screen featured case studies",
  },
  {
    id: "controlcore",
    name: "ControlCore",
    category: "cms",
    pricePhp: 8500,
    maxPages: null,
    seats: 2,
    editableSections: null,
  },
  {
    id: "cataloglayer",
    name: "CatalogLayer",
    category: "cms",
    pricePhp: 15500,
    maxPages: null,
    seats: 3,
    editableSections: null,
    catalog: true,
  },
  {
    id: "workflowdesk",
    name: "WorkflowDesk",
    category: "cms",
    pricePhp: 28500,
    priceNote: "Starts at",
    maxPages: null,
    seats: 5,
    editableSections: null,
    catalog: true,
    workflow: true,
  },
  {
    id: "searchlayer",
    name: "SearchLayer",
    category: "seo",
    pricePhp: 3000,
    priceNote: "Monthly / ₱30,000 yearly",
    maxPages: null,
    priorityUrls: 5,
  },
  {
    id: "searchedge",
    name: "SearchEdge",
    category: "seo",
    pricePhp: 5000,
    priceNote: "Monthly / ₱50,000 yearly",
    maxPages: null,
    priorityUrls: 8,
  },
  {
    id: "technicalflow",
    name: "TechnicalFlow",
    category: "seo",
    pricePhp: 9000,
    priceNote: "Monthly / ₱90,000 yearly",
    maxPages: null,
    priorityUrls: 20,
  },
  {
    id: "lightweight",
    name: "Lightweight Website Care",
    category: "care",
    pricePhp: 0,
    priceNote: "Complimentary 12 months from launch; ₱5,000 reference value",
    maxPages: null,
    careMonths: 12,
  },
  {
    id: "continuity",
    name: "Continuity",
    category: "care",
    pricePhp: 1000,
    priceNote: "Monthly / ₱10,000 yearly",
    maxPages: null,
  },
  {
    id: "steward",
    name: "Steward",
    category: "care",
    pricePhp: 1500,
    priceNote: "Monthly / ₱15,000 yearly",
    maxPages: null,
  },
  {
    id: "priority-desk",
    name: "Priority Desk",
    category: "care",
    pricePhp: 2500,
    priceNote: "₱2,500–₱3,500 monthly",
    maxPages: null,
  },
];
export interface ManualScope {
  approved: boolean;
  reference: string;
  maxPages: number;
  inquiry: boolean;
  reservation: boolean;
  booking: boolean;
}
export function resolveEntitlements(
  base: PackageConfig,
  cms?: PackageConfig,
  manual?: ManualScope,
): PackageConfig {
  if (!["website", "portfolio"].includes(base.category))
    throw new Error("Choose one website or portfolio package.");
  if (cms && cms.category !== "cms") throw new Error("Invalid CMS package.");
  if (base.id === "bookingsuite") {
    if (
      !manual?.approved ||
      !manual.reference.trim() ||
      !Number.isInteger(manual.maxPages) ||
      manual.maxPages < 1
    )
      return {
        ...base,
        inquiry: false,
        reservation: false,
        booking: false,
        workflow: false,
      };
    return {
      ...base,
      maxPages: manual.maxPages,
      inquiry: manual.inquiry,
      reservation: manual.reservation,
      booking: manual.booking,
      workflow: cms?.workflow ?? false,
    };
  }
  return { ...base, workflow: cms?.workflow ?? false };
}
export function countRoutes(links: string[]): number {
  const routes = new Set<string>();
  for (const link of links) {
    const value = link.trim();
    if (!value || value.startsWith("#")) continue;
    if (
      !value.startsWith("/") ||
      value.startsWith("//") ||
      value.includes("\\")
    )
      throw new Error("Use local paths for website pages.");
    const parsed = new URL(value, "https://route.test");
    routes.add(parsed.pathname.replace(/\/+$/, "") || "/");
  }
  return routes.size;
}
export function careStatus(
  launch: string | null,
  now: Date,
): "not_started" | "warranty" | "active" | "expired" {
  if (!launch) return "not_started";
  const start = new Date(launch);
  if (!Number.isFinite(start.getTime())) throw new Error("Invalid launch date");
  if (now < start) return "not_started";
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return now >= end
    ? "expired"
    : now.getTime() - start.getTime() < 30 * 86400000
      ? "warranty"
      : "active";
}
