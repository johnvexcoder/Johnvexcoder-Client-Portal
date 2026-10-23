export async function maintenance(
  db: D1Database,
  apply = false,
  now = Date.now(),
) {
  const rules: [string, string, number[]][] = [
    [
      "sessions",
      "DELETE FROM session WHERE expires_at<=? OR id IN(SELECT session_id FROM idle_sessions WHERE last_activity_at<=?)",
      [now, now - 600000],
    ],
    ["leases", "DELETE FROM section_leases WHERE expires_at<=?", [now]],
    [
      "rate_limits",
      "DELETE FROM rate_limit WHERE last_request<?",
      [now - 86400000],
    ],
    [
      "verification",
      "DELETE FROM verification WHERE expires_at<?",
      [now - 86400000],
    ],
    [
      "credential_tokens",
      "DELETE FROM credential_tokens WHERE expires_at<?",
      [now - 7 * 86400000],
    ],
    [
      "approval_challenges",
      "DELETE FROM approval_challenges WHERE expires_at<?",
      [now - 7 * 86400000],
    ],
  ];
  const counts: Record<string, number> = {};
  for (const [key, query, args] of rules) {
    const count = await db
      .prepare(query.replace(/^DELETE FROM/, "SELECT COUNT(*) AS count FROM"))
      .bind(...args)
      .first<{ count: number }>();
    counts[key] = count?.count ?? 0;
  }
  if (apply)
    await db.batch(
      rules.map(([, query, args]) => db.prepare(query).bind(...args)),
    );
  return {
    mode: apply ? "applied" : "dry_run",
    eligible: counts,
    approvedContentDeleted: false,
    clientMessagesDeleted: false,
  };
}
