import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import type { PackageConfig } from "../features/packages/catalog";
export function AdminSummary() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void api<{ counts: Record<string, number> }>("/api/admin/summary")
      .then((v) => setCounts(v.counts))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="workflow-card">
      <h2>Across the studio</h2>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : !counts ? (
        <p>Loading totals…</p>
      ) : (
        <div className="operations-summary">
          {Object.entries({
            active_companies: "Active companies",
            collecting: "Collecting requirements",
            submitted: "Awaiting review",
            unread: "Unread conversations",
            aging: "Unresolved over 7 days",
            recovery_requests: "New recovery requests",
          }).map(([key, label]) => (
            <div key={key}>
              <strong>{counts[key] ?? 0}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
export function HelpPanel() {
  const [help, setHelp] = useState<{
      supportEmail: string;
      supportPhone: string;
      facebook: string;
      whatsapp: string;
      portfolio: string;
      online: boolean;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void api<typeof help>("/api/help")
      .then(setHelp)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="workflow-card">
      <h2>Contact John</h2>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : !help ? (
        <p>Loading support details…</p>
      ) : (
        <>
          <p className="muted">
            {help.online ? "Recently active" : "Currently offline"} ·
            Availability does not guarantee an immediate reply.
          </p>
          <p>
            For a project question, open Questions & requests within your
            project. Refer to the relevant section.
          </p>
          <div className="item-actions">
            {help.supportEmail && (
              <a href={`mailto:${help.supportEmail}`}>Email John</a>
            )}
            {help.supportPhone && <span>{help.supportPhone}</span>}
            {(["facebook", "whatsapp", "portfolio"] as const)
              .filter((k) => help[k])
              .map((k) => (
                <a
                  key={k}
                  href={help[k]}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {k}
                </a>
              ))}
          </div>
          {![
            help.supportEmail,
            help.supportPhone,
            help.facebook,
            help.whatsapp,
            help.portfolio,
          ].some(Boolean) && (
            <p className="muted small">
              Use the contact channel John shared with you. Additional support
              links have not been configured.
            </p>
          )}
        </>
      )}
    </section>
  );
}
export function PackageVersionForm({
  item,
  onSaved,
}: {
  item: { id: string; version: number; config: PackageConfig };
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/packages/${item.config.id}/versions`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: item.version,
          pricePhp: Number(f.get("price")),
          editableSections:
            item.config.category === "cms" && f.get("cap")
              ? Number(f.get("cap"))
              : null,
        }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Create a new package version</summary>
      <form onSubmit={submit}>
        <p className="muted small">
          Applies to future assignments. Existing projects retain their assigned
          version.
        </p>
        <label>
          Proposal price (PHP)
          <input
            type="number"
            name="price"
            min={0}
            max={100000000}
            defaultValue={item.config.pricePhp}
            required
          />
        </label>
        {item.config.category === "cms" && (
          <label>
            Editable-section cap
            <input
              type="number"
              name="cap"
              min={1}
              max={100}
              defaultValue={item.config.editableSections ?? ""}
            />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="secondary" disabled={busy}>
          Publish new version
        </button>
      </form>
    </details>
  );
}
