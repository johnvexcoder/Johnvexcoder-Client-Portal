const offset = 8 * 60 * 60 * 1000;
export function manilaMonth(timestamp: number) {
  const local = new Date(timestamp + offset),
    year = local.getUTCFullYear(),
    month = local.getUTCMonth();
  return {
    label: `${year}-${String(month + 1).padStart(2, "0")} (Asia/Manila)`,
    start: Date.UTC(year, month, 1) - offset,
    end: Date.UTC(year, month + 1, 1) - offset,
  };
}
export function careWindow(
  launch: number | null,
  now: number,
  included: boolean,
) {
  if (!included || launch === null)
    return {
      status: included ? "not_started" : "not_included",
      expiresAt: null,
      warrantyEnd: null,
    };
  const start = new Date(launch),
    end = new Date(launch);
  end.setUTCFullYear(start.getUTCFullYear() + 1);
  if (end.getUTCMonth() !== start.getUTCMonth()) end.setUTCDate(0);
  const expiresAt = end.getTime(),
    warrantyEnd = launch + 30 * 86400000;
  return {
    status:
      now < launch
        ? "not_started"
        : now >= expiresAt
          ? "expired"
          : now < warrantyEnd
            ? "warranty"
            : "active",
    expiresAt,
    warrantyEnd,
  };
}
