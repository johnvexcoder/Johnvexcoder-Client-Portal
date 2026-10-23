export const IDLE_WARNING_MS = 9 * 60_000;
export const IDLE_EXPIRY_MS = 10 * 60_000;
export function isIdleExpired(lastActivity: number, now: number): boolean {
  return now - lastActivity >= IDLE_EXPIRY_MS;
}
export function canAccessProject(
  role: string,
  companyId: string | null,
  projectCompanyId: string,
): boolean {
  return (
    role === "admin" ||
    (role === "client" && !!companyId && companyId === projectCompanyId)
  );
}
export function safeExternalLink(value: string): string {
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Use an HTTPS share link without login details.");
  return url.href;
}
export function localOnly(url: string, environment: string): boolean {
  const hostname = new URL(url).hostname;
  return (
    environment === "local" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
  );
}
export function randomCredential(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
