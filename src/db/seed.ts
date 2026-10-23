import { drizzle } from "drizzle-orm/d1";
import { catalog } from "../features/packages/catalog";
import { packageDefinitions, packageVersions } from "./schema";
export async function seedCatalog(binding: D1Database) {
  const db = drizzle(binding);
  const now = new Date();
  for (const p of catalog) {
    await db
      .insert(packageDefinitions)
      .values({
        id: p.id,
        name: p.name,
        category: p.category,
        pricePhp: p.pricePhp,
        priceNote: p.priceNote ?? null,
      })
      .onConflictDoNothing();
    await db
      .insert(packageVersions)
      .values({
        id: `${p.id}:1`,
        definitionId: p.id,
        version: 1,
        config: p,
        createdAt: now,
      })
      .onConflictDoNothing();
  }
}
