import { HTTPException } from "hono/http-exception";
/** D1 batch is atomic. A failed CHECK aborts every statement, including concurrent stale operations. */
export async function guardedBatch(
  db: D1Database,
  condition: string,
  values: unknown[],
  statements: D1PreparedStatement[],
) {
  const id = crypto.randomUUID();
  try {
    return await db.batch([
      db
        .prepare(
          `INSERT INTO transaction_guards(id,allowed) SELECT ?,CASE WHEN (${condition}) THEN 1 ELSE 0 END`,
        )
        .bind(id, ...values),
      ...statements,
      db.prepare("DELETE FROM transaction_guards WHERE id=?").bind(id),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      /transaction_precondition/.test(error.message)
    )
      throw new HTTPException(409, {
        message:
          "The saved state changed or this action is no longer allowed. Reload and review before retrying.",
      });
    throw error;
  }
}
export const auditStatement = (
  db: D1Database,
  actorId: string,
  companyId: string | null,
  action: string,
  targetId: string,
) =>
  db
    .prepare(
      "INSERT INTO audit_events(id,actor_id,company_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      actorId,
      companyId,
      action,
      targetId,
      Date.now(),
    );
