import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
interface CareData {
  status: string;
  included: boolean;
  paidTags: string[];
  launchAt: string | null;
  expiresAt: number | null;
  warrantyEnd: number | null;
  month: string;
  usage: { requests: number; minutes: number };
  limits: { requests: number; minutes: number };
  entries: {
    id: string;
    minutes: number;
    description: string;
    performedAt: number;
  }[];
}
const date = (value: string | number) =>
  new Date(value).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
export function CarePanel({ id, admin }: { id: string; admin: boolean }) {
  const [data, setData] = useState<CareData | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async () => setData(await api<CareData>(`/api/projects/${id}/care`)),
    [id],
  );
  useEffect(() => {
    void api<CareData>(`/api/projects/${id}/care`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const r = await api<{ message: string }>(
        `/api/admin/projects/${id}/care`,
        {
          method: "POST",
          body: JSON.stringify({
            minutes: Number(f.get("minutes")),
            description: f.get("description"),
            performedAt: new Date(
              String(f.get("day")) + "T12:00:00+08:00",
            ).toISOString(),
          }),
        },
      );
      setNotice(r.message);
      form.reset();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">WEBSITE CARE</span>
          <h1>Support after launch.</h1>
          <p className="muted">
            Coverage starts on the recorded website launch date.
          </p>
        </div>
      </div>
      {error && (
        <p className="error-panel" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-panel" role="status">
          {notice}
        </p>
      )}
      {!data ? (
        <p>Loading care records…</p>
      ) : (
        <>
          <section className="workflow-card">
            <h2>{data.status.replaceAll("_", " ")}</h2>
            <p>
              {data.launchAt
                ? `Launched ${date(data.launchAt)}`
                : "Launch date not recorded."}
              {data.expiresAt
                ? ` · Complimentary coverage ends ${date(data.expiresAt)}.`
                : ""}
            </p>
            {data.included && (
              <>
                <p>
                  First 30 days: launch defect warranty. Then up to two support
                  requests and 60 combined minutes per calendar month, without
                  rollover.
                </p>
                <p>
                  <strong>{data.month}</strong> · {data.usage.requests}/2
                  requests · {data.usage.minutes}/60 minutes recorded after
                  warranty.
                </p>
              </>
            )}
            {data.paidTags.length > 0 && (
              <p>
                Additional service tags: {data.paidTags.join(", ")}. Refer to
                the separate service agreement for their limits.
              </p>
            )}
          </section>
          {admin && data.included && data.launchAt && (
            <form className="workflow-card" onSubmit={submit}>
              <h2>Record completed care work</h2>
              <label>
                Work date (Asia/Manila)
                <input name="day" type="date" required />
              </label>
              <label>
                Minutes used
                <input name="minutes" type="number" min={1} max={60} required />
              </label>
              <label>
                Work description
                <textarea
                  name="description"
                  minLength={3}
                  maxLength={2000}
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                Record care work
              </button>
            </form>
          )}
          <section className="workflow-card">
            <h2>Care history</h2>
            {data.entries.length === 0 ? (
              <p className="muted">No work recorded.</p>
            ) : (
              data.entries.map((entry) => (
                <article key={entry.id}>
                  <strong>
                    {date(entry.performedAt)} · {entry.minutes} minutes
                  </strong>
                  <p>{entry.description}</p>
                </article>
              ))
            )}
          </section>
        </>
      )}
    </section>
  );
}
